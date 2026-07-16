/**
 * lib/executor/operators/ratio.ts
 *
 * ratio 操作符（SPEC 13.5）：执行安全公式 AST（如完成率 = 实际/目标）。
 * 有维度时按维度分组取均值；无维度时逐行 + scalar 均值。除零返回 null 并 warning。
 */
import type {
  AnalysisTask,
  ResultColumn,
  TaskExecutionResult,
  ToolDefinition,
} from "@/lib/types";
import {
  applyFilters,
  makeTaskEvidence,
  validateFieldsExist,
} from "./_shared";
import { evalFormula, validateFormulaAST } from "../formula-engine";
import { hashResult } from "../result-hash";

export const ratioTool: ToolDefinition = {
  operator: "ratio",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const issues = validateFieldsExist(task.metrics, available);
    if (!task.formula) {
      issues.push({ code: "NO_FORMULA", message: "ratio 需要 formula", level: "error" });
    } else {
      const fcheck = validateFormulaAST(task.formula.expression, available);
      for (const fi of fcheck.issues) {
        issues.push({ code: fi.code, message: fi.message, level: "error" });
      }
    }
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const expr = task.formula!.expression;
    const outputField = task.formula!.outputField;
    const filtered = applyFilters(ctx.dataset.rows, task.filters);

    let nullCount = 0;
    const computed = filtered.map((r) => {
      const v = evalFormula(expr, r);
      if (v === null) nullCount++;
      return { row: r, value: v };
    });

    let outRows: Record<string, unknown>[];
    let scalar: number | string | null = null;
    const dims = task.dimensions;

    if (dims.length > 0) {
      const groups = new Map<string, { parts: string[]; vals: number[] }>();
      for (const { row, value } of computed) {
        if (value === null) continue;
        const parts = dims.map((d) => String(row[d] ?? ""));
        const key = parts.join("");
        let g = groups.get(key);
        if (!g) {
          g = { parts, vals: [] };
          groups.set(key, g);
        }
        g.vals.push(value);
      }
      outRows = [...groups.values()].map((g) => {
        const row: Record<string, unknown> = {};
        dims.forEach((d, i) => {
          row[d] = g.parts[i];
        });
        row[outputField] =
          g.vals.reduce((a, b) => a + b, 0) / g.vals.length;
        return row;
      });
      const all = outRows.map((r) => r[outputField] as number);
      scalar = all.length > 0 ? all.reduce((a, b) => a + b, 0) / all.length : null;
    } else {
      outRows = computed
        .filter((c) => c.value !== null)
        .slice(0, task.limit ?? 100)
        .map((c) => ({ ...c.row, [outputField]: c.value }));
      const vals = computed
        .map((c) => c.value)
        .filter((v): v is number => v !== null);
      scalar = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }

    const warnings: string[] = [];
    if (nullCount > 0)
      warnings.push(`${outputField} 有 ${nullCount} 个空值（缺失字段或除零）`);

    const columns: ResultColumn[] = [
      ...dims.map((d) => ({
        name: d,
        type: (ctx.dataset.columns.find((c) => c.name === d)?.type ??
          "string") as ResultColumn["type"],
      })),
      {
        name: outputField,
        type: "number",
        format: task.formula!.format,
      },
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "ratio",
      status: "success",
      columns,
      rows: outRows,
      scalar,
      summary: { rowCount: outRows.length, nullCount, truncated: false },
      warnings,
      evidence: [],
      inputHash: "",
      resultHash: "",
      durationMs: Date.now() - start,
    };
    const resultHash = hashResult(base);
    base.resultHash = resultHash;
    base.evidence = [
      makeTaskEvidence({
        taskId: task.id,
        operator: "ratio",
        title: `比率：${outputField}`,
        description: `使用安全公式计算「${outputField}」${
          dims.length ? `，按 ${dims.join("、")} 分组取均值` : ""
        }，整体均值 ${scalar ?? "N/A"}。`,
        fields: [...dims, ...task.metrics],
        method: "ratio",
        parameters: {
          outputField,
          metrics: task.metrics,
          dimensions: dims,
          nullCount,
        },
        result: { scalar, rowCount: outRows.length, sample: outRows.slice(0, 10) },
        sampleSize: filtered.length,
        resultHash,
      }),
    ];
    return base;
  },
};
