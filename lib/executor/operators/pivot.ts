/**
 * lib/executor/operators/pivot.ts
 *
 * pivot 操作符（SPEC 13.5）：最多 2 行维度 × 1 列维度 × ≤3 指标，输出矩阵。
 * 约定：dimensions[0..1] 为行维度，dimensions[2] 为列维度。
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
  asNumber,
  makeTaskEvidence,
  validateFieldsExist,
  type TaskAgg,
} from "./_shared";
import { hashResult } from "../result-hash";

const SEP = "";

export const pivotTool: ToolDefinition = {
  operator: "pivot",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const issues = validateFieldsExist(
      [...task.dimensions, ...task.metrics],
      available,
    );
    if (task.dimensions.length < 2)
      issues.push({
        code: "PIVOT_NEEDS_DIMS",
        message: "pivot 至少 2 个维度（行 + 列）",
        level: "error",
      });
    if (task.dimensions.length > 3)
      issues.push({
        code: "PIVOT_TOO_MANY_DIMS",
        message: "pivot 最多 3 维度（2 行 + 1 列）",
        level: "error",
      });
    if (task.metrics.length === 0)
      issues.push({
        code: "NO_METRIC",
        message: "pivot 至少 1 个指标",
        level: "error",
      });
    if (task.metrics.length > 3)
      issues.push({
        code: "PIVOT_TOO_MANY_METRICS",
        message: "pivot 最多 3 指标",
        level: "error",
      });
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const dims = task.dimensions;
    // 约定：最后一个维度为列维度，其余为行维度（≤2 行 + 1 列，SPEC 13.5）
    const colDim = dims[dims.length - 1];
    const rowDims = dims.slice(0, Math.max(1, dims.length - 1));
    const metrics = task.metrics;
    const agg = (task.aggregation ?? "sum") as TaskAgg;
    const filtered = applyFilters(ctx.dataset.rows, task.filters);

    const rowKeys = new Set<string>();
    const colKeys = new Set<string>();
    const cells = new Map<string, Record<string, number[]>>();

    for (const r of filtered) {
      const rowParts = rowDims.map((d) => String(r[d] ?? ""));
      const rowKey = rowParts.join(SEP);
      const colKey = String(r[colDim] ?? "");
      rowKeys.add(rowKey);
      colKeys.add(colKey);
      const cellKey = rowKey + SEP + colKey;
      let cell = cells.get(cellKey);
      if (!cell) {
        cell = {};
        cells.set(cellKey, cell);
      }
      for (const m of metrics) {
        const n = asNumber(r[m]);
        if (n === null) continue;
        if (!cell[m]) cell[m] = [];
        cell[m].push(n);
      }
    }

    const sortedRowKeys = [...rowKeys].sort();
    const sortedColKeys = [...colKeys].sort();

    const outRows = sortedRowKeys.map((rk) => {
      const parts = rk.split(SEP);
      const row: Record<string, unknown> = {};
      rowDims.forEach((d, i) => {
        row[d] = parts[i];
      });
      for (const ck of sortedColKeys) {
        const cell = cells.get(rk + SEP + ck);
        for (const m of metrics) {
          row[`${m}[${ck}]`] = cell?.[m] ? aggregateValues(cell[m], agg) : null;
        }
      }
      return row;
    });

    const columns: ResultColumn[] = [
      ...rowDims.map((d) => ({ name: d, type: "string" as const })),
      ...sortedColKeys.flatMap((ck) =>
        metrics.map((m) => ({ name: `${m}[${ck}]`, type: "number" as const })),
      ),
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "pivot",
      status: "success",
      columns,
      rows: outRows,
      summary: {
        rowCount: outRows.length,
        nullCount: 0,
        truncated: sortedColKeys.length > 20,
      },
      warnings:
        sortedColKeys.length > 20
          ? [`列维度取值 ${sortedColKeys.length} 较多，已输出全部但建议收窄`]
          : [],
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
        operator: "pivot",
        title: `透视：${metrics.join("、")}（${rowDims.join("×")} × ${colDim}）`,
        description: `以 ${rowDims.join("、")} 为行、${colDim} 为列对 ${metrics.join("、")} 做 ${agg} 透视，共 ${outRows.length} 行 × ${sortedColKeys.length} 列。`,
        fields: [...rowDims, colDim, ...metrics],
        method: "pivot",
        parameters: {
          rowDimensions: rowDims,
          columnDimension: colDim,
          metrics,
          aggregation: agg,
        },
        result: {
          rowCount: outRows.length,
          columnCount: sortedColKeys.length,
          sample: outRows.slice(0, 10),
        },
        sampleSize: filtered.length,
        resultHash,
      }),
    ];
    return base;
  },
};
