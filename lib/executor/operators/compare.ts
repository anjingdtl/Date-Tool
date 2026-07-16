/**
 * lib/executor/operators/compare.ts
 *
 * compare 操作符（SPEC 13.5）：分组对比；支持目标/实际的
 * absolute / difference / rate 对比（前两个指标视作 actual / target）。
 */
import type {
  AnalysisTask,
  ResultColumn,
  TaskExecutionResult,
  ToolDefinition,
} from "@/lib/types";
import {
  aggregateValues,
  aggLabel,
  applyFilters,
  applySort,
  asNumber,
  makeTaskEvidence,
  validateFieldsExist,
  type TaskAgg,
} from "./_shared";
import { hashResult } from "../result-hash";

export const compareTool: ToolDefinition = {
  operator: "compare",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const issues = validateFieldsExist(
      [...task.dimensions, ...task.metrics],
      available,
    );
    if (task.dimensions.length === 0)
      issues.push({
        code: "NO_DIM",
        message: "compare 至少 1 个对比维度",
        level: "error",
      });
    if (task.metrics.length === 0)
      issues.push({
        code: "NO_METRIC",
        message: "compare 至少 1 个指标",
        level: "error",
      });
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const colNames = new Set(ctx.dataset.columns.map((c) => c.name));
    const dims = task.dimensions.filter((d) => colNames.has(d));
    const metrics = task.metrics.filter((m) => colNames.has(m));
    const agg = (task.aggregation ?? "sum") as TaskAgg;
    const mode = task.compareMode;
    const filtered = applyFilters(ctx.dataset.rows, task.filters);

    const groups = new Map<
      string,
      { keyParts: string[]; vals: Record<string, number[]> }
    >();
    for (const r of filtered) {
      const keyParts = dims.map((d) => String(r[d] ?? ""));
      const key = keyParts.join("");
      let g = groups.get(key);
      if (!g) {
        g = { keyParts, vals: {} };
        groups.set(key, g);
      }
      for (const m of metrics) {
        const n = asNumber(r[m]);
        if (n === null) continue;
        if (!g.vals[m]) g.vals[m] = [];
        g.vals[m].push(n);
      }
    }

    const hasTarget = mode && metrics.length >= 2;
    const actual = metrics[0];
    const target = metrics[1];
    let outRows = [...groups.values()].map((g) => {
      const row: Record<string, unknown> = {};
      dims.forEach((d, i) => {
        row[d] = g.keyParts[i];
      });
      for (const m of metrics) row[m] = aggregateValues(g.vals[m] ?? [], agg);
      if (hasTarget && typeof row[actual] === "number" && typeof row[target] === "number") {
        const a = row[actual] as number;
        const t = row[target] as number;
        if (mode === "difference") row[`${actual}_减_${target}`] = a - t;
        else if (mode === "rate")
          row[`${actual}_比_${target}`] = t === 0 ? null : a / t;
      }
      return row;
    });
    outRows = applySort(outRows, task.sort);
    if (task.limit) outRows = outRows.slice(0, task.limit);

    const extraCols: ResultColumn[] = hasTarget
      ? mode === "difference"
        ? [{ name: `${actual}_减_${target}`, type: "number" }]
        : mode === "rate"
          ? [{ name: `${actual}_比_${target}`, type: "number", format: "percentage" }]
          : []
      : [];
    const columns: ResultColumn[] = [
      ...dims.map((d) => ({
        name: d,
        type: (ctx.dataset.columns.find((c) => c.name === d)?.type ??
          "string") as ResultColumn["type"],
      })),
      ...metrics.map((m) => ({ name: m, type: "number" as const })),
      ...extraCols,
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "compare",
      status: "success",
      columns,
      rows: outRows,
      summary: { rowCount: outRows.length, nullCount: 0, truncated: false },
      warnings: [],
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
        operator: "compare",
        title: `分组对比：${metrics.join(" vs ")}（按 ${dims.join("、")}）`,
        description: `按 ${dims.join("、")} 分组对 ${metrics.join("、")} 做 ${aggLabel(agg)} 对比${
          hasTarget ? `，模式 ${mode}` : ""
        }。`,
        fields: [...dims, ...metrics],
        method: "group_compare",
        parameters: { dimensions: dims, metrics, aggregation: agg, compareMode: mode ?? null },
        result: { rowCount: outRows.length, sample: outRows.slice(0, 10) },
        sampleSize: filtered.length,
        resultHash,
      }),
    ];
    return base;
  },
};
