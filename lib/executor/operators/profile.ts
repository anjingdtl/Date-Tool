/**
 * lib/executor/operators/profile.ts
 *
 * profile 操作符（SPEC 13.5）：字段统计与基础摘要。
 * 数值字段输出 min/max/mean/median；分类字段输出 distinctCount。
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
import { computeNumericStats } from "@/lib/analysis/statistics";
import { computeCategoryStats } from "@/lib/analysis/profile";
import { hashResult } from "../result-hash";

export const profileTool: ToolDefinition = {
  operator: "profile",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const fields =
      task.metrics.length > 0
        ? task.metrics
        : task.dimensions.length > 0
          ? task.dimensions
          : ctx.dataset.columns.map((c) => c.name);
    const issues = validateFieldsExist(fields, available);
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const filtered = applyFilters(ctx.dataset.rows, task.filters);
    const cols = ctx.dataset.columns;
    const fields =
      task.metrics.length > 0
        ? task.metrics
        : task.dimensions.length > 0
          ? task.dimensions
          : cols.map((c) => c.name);

    const outRows = fields.map((f) => {
      const col = cols.find((c) => c.name === f);
      const type = col?.type ?? "string";
      if (type === "number") {
        const s = computeNumericStats(filtered, f);
        return {
          field: f,
          type,
          count: s.count,
          distinctCount: 0,
          nullRate: s.nullRate,
          min: s.min,
          max: s.max,
          mean: s.avg,
          median: s.median,
        };
      }
      const c = computeCategoryStats(filtered, f, 5, 0);
      return {
        field: f,
        type,
        count: c.total - c.nullCount,
        distinctCount: c.distinctCount,
        nullRate: c.total > 0 ? c.nullCount / c.total : 0,
        min: null,
        max: null,
        mean: null,
        median: null,
      };
    });

    const columns: ResultColumn[] = [
      { name: "field", type: "string" },
      { name: "type", type: "string" },
      { name: "count", type: "number" },
      { name: "distinctCount", type: "number" },
      { name: "nullRate", type: "number", format: "percentage" },
      { name: "min", type: "number" },
      { name: "max", type: "number" },
      { name: "mean", type: "number" },
      { name: "median", type: "number" },
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "profile",
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
        operator: "profile",
        title: `字段画像（${outRows.length} 个字段）`,
        description: `对 ${outRows.length} 个字段计算基础统计与分布摘要。`,
        fields,
        method: "summary",
        parameters: { fields },
        result: { rowCount: outRows.length, sample: outRows },
        sampleSize: filtered.length,
        resultHash,
      }),
    ];
    return base;
  },
};
