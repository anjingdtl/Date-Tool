/**
 * lib/executor/operators/ranking.ts
 *
 * ranking 操作符（SPEC 13.5）：按主指标聚合后排序，取 Top/Bottom，加 rank 列。
 */
import type {
  AnalysisTask,
  ResultColumn,
  TaskExecutionResult,
  ToolDefinition,
} from "@/lib/types";
import {
  aggregateValues,
  applyFilters,
  applySort,
  asNumber,
  makeTaskEvidence,
  validateFieldsExist,
  type TaskAgg,
} from "./_shared";
import { hashResult } from "../result-hash";

export const rankingTool: ToolDefinition = {
  operator: "ranking",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const issues = validateFieldsExist(
      [...task.dimensions, ...task.metrics],
      available,
    );
    if (task.dimensions.length === 0)
      issues.push({
        code: "NO_DIM",
        message: "ranking 至少 1 个排序维度",
        level: "error",
      });
    if (task.metrics.length === 0)
      issues.push({
        code: "NO_METRIC",
        message: "ranking 至少 1 个指标",
        level: "error",
      });
    if (!task.aggregation)
      issues.push({
        code: "NO_AGGREGATION",
        message: "ranking 必须明确聚合方式",
        level: "error",
      });
    if (!task.sort || !task.metrics.includes(task.sort.field))
      issues.push({
        code: "NO_METRIC_SORT",
        message: "ranking 必须明确使用某个指标排序",
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
    const primaryMetric = metrics[0];
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

    const sort = task.sort ?? { field: primaryMetric, direction: "desc" as const };
    let outRows = [...groups.values()].map((g) => {
      const row: Record<string, unknown> = {};
      dims.forEach((d, i) => {
        row[d] = g.keyParts[i];
      });
      for (const m of metrics) row[m] = aggregateValues(g.vals[m] ?? [], agg);
      return row;
    });
    outRows = applySort(outRows, sort);
    const limit = task.limit ?? 10;
    outRows = outRows.slice(0, limit);
    outRows.forEach((r, i) => {
      r.rank = i + 1;
    });

    const columns: ResultColumn[] = [
      { name: "rank", type: "number" },
      ...dims.map((d) => ({
        name: d,
        type: (ctx.dataset.columns.find((c) => c.name === d)?.type ??
          "string") as ResultColumn["type"],
      })),
      ...metrics.map((m) => ({ name: m, type: "number" as const })),
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "ranking",
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
        operator: "ranking",
        title: `排名：${primaryMetric}（按 ${dims.join("、")}）`,
        description: `按 ${dims.join("、")} 分组对 ${primaryMetric} 聚合后排序，取 Top ${outRows.length}。`,
        fields: [...dims, primaryMetric],
        method: "ranking",
        parameters: { dimensions: dims, metric: primaryMetric, aggregation: agg, limit },
        result: { rowCount: outRows.length, top: outRows.slice(0, 5) },
        sampleSize: filtered.length,
        resultHash,
      }),
    ];
    return base;
  },
};
