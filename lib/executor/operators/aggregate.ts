/**
 * lib/executor/operators/aggregate.ts
 *
 * aggregate 操作符（SPEC 13.5）：0~3 维度 × 1~5 指标 × 7 种聚合 + filter/sort/limit。
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

export const aggregateTool: ToolDefinition = {
  operator: "aggregate",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const issues = validateFieldsExist(
      [...task.dimensions, ...task.metrics],
      available,
    );
    if (task.dimensions.length > 3)
      issues.push({
        code: "TOO_MANY_DIMS",
        message: "aggregate 最多 3 个维度",
        level: "error",
      });
    if (task.metrics.length === 0)
      issues.push({
        code: "NO_METRIC",
        message: "aggregate 至少 1 个指标",
        level: "error",
      });
    if (task.metrics.length > 5)
      issues.push({
        code: "TOO_MANY_METRICS",
        message: "aggregate 最多 5 个指标",
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
    const filtered = applyFilters(ctx.dataset.rows, task.filters);

    const groups = new Map<
      string,
      { keyParts: string[]; vals: Record<string, number[]> }
    >();
    for (const r of filtered) {
      const keyParts = dims.map((d) => String(r[d] ?? ""));
      const key = keyParts.join("");
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

    let outRows = [...groups.values()].map((g) => {
      const row: Record<string, unknown> = {};
      dims.forEach((d, i) => {
        row[d] = g.keyParts[i];
      });
      for (const m of metrics) {
        row[m] = aggregateValues(g.vals[m] ?? [], agg);
      }
      return row;
    });
    const fullSize = outRows.length;
    outRows = applySort(outRows, task.sort);
    if (task.limit) outRows = outRows.slice(0, task.limit);

    const columns: ResultColumn[] = [
      ...dims.map((d) => ({
        name: d,
        type: (ctx.dataset.columns.find((c) => c.name === d)?.type ??
          "string") as ResultColumn["type"],
      })),
      ...metrics.map((m) => ({ name: m, type: "number" as const })),
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "aggregate",
      status: "success",
      columns,
      rows: outRows,
      summary: {
        rowCount: outRows.length,
        nullCount: 0,
        truncated: task.limit != null && fullSize > outRows.length,
      },
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
        operator: "aggregate",
        title: `${aggLabel(agg)}：${metrics.join("、")}${
          dims.length ? `（按 ${dims.join("、")}）` : ""
        }`,
        description: `对 ${metrics.join("、")} 做 ${aggLabel(agg)} 聚合${
          dims.length ? `，分组维度 ${dims.join("、")}` : ""
        }，共 ${outRows.length} 组。`,
        fields: [...dims, ...metrics],
        method: "aggregate",
        parameters: {
          dimensions: dims,
          metrics,
          aggregation: agg,
          filterCount: task.filters.length,
          limit: task.limit ?? null,
        },
        result: { rowCount: outRows.length, sample: outRows.slice(0, 10) },
        sampleSize: filtered.length,
        resultHash,
      }),
    ];
    return base;
  },
};
