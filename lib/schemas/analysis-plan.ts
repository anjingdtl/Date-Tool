import { z } from "zod";
import { FormulaExpressionSchema } from "./formula";
import { FieldFormatSchema } from "./dataset";

/**
 * 分析计划层 Zod Schema（SPEC 12）。
 *
 * 类型契约见 lib/types.ts；本文件校验 LLM 规划输出与用户 Patch 中的任务结构。
 * 复用 dataset.ts 的 FieldFormatSchema，避免重复定义。
 */

export const AnalysisOperatorSchema = z.enum([
  "profile",
  "aggregate",
  "timeseries",
  "compare",
  "distribution",
  "ranking",
  "ratio",
  "growth",
  "correlation",
  "anomaly",
  "pivot",
]);

export const TaskFilterOperatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
]);

export const TaskFilterSchema = z.object({
  field: z.string().min(1),
  operator: TaskFilterOperatorSchema,
  value: z.unknown(),
});

export const TaskSortSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
});

export const TaskFormulaSchema = z.object({
  outputField: z.string().min(1),
  expression: FormulaExpressionSchema,
  format: FieldFormatSchema.optional(),
});

export const TaskTimeConfigSchema = z.object({
  field: z.string().min(1),
  grain: z.enum(["day", "week", "month", "quarter", "year"]),
});

export const TaskAggregationSchema = z.enum([
  "sum",
  "avg",
  "count",
  "min",
  "max",
  "median",
  "last",
]);

export const ExpectedOutputSchema = z.enum([
  "scalar",
  "series",
  "category_table",
  "matrix",
  "records",
]);

export const AnalysisTaskSchema = z.object({
  id: z.string().min(1),
  operator: AnalysisOperatorSchema,
  title: z.string().min(1),
  purpose: z.string().min(1),
  dimensions: z.array(z.string()),
  metrics: z.array(z.string()),
  filters: z.array(TaskFilterSchema),
  aggregation: TaskAggregationSchema.optional(),
  time: TaskTimeConfigSchema.optional(),
  formula: TaskFormulaSchema.optional(),
  compareMode: z.enum(["absolute", "difference", "rate"]).optional(),
  anomalyMethod: z.enum(["iqr", "zscore"]).optional(),
  sort: TaskSortSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  dependsOn: z.array(z.string()),
  expectedOutput: ExpectedOutputSchema,
  priority: z.number().int(),
});

export const PlannedChartTypeSchema = z.enum([
  "line",
  "bar",
  "pie",
  "area",
  "stacked_bar",
  "scatter",
  "heatmap",
  "table",
  "kpi",
]);

export const DashboardItemPlanSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  type: PlannedChartTypeSchema,
  title: z.string().min(1),
  description: z.string(),
  rationale: z.string(),
  priority: z.number().int(),
  width: z.enum(["full", "half", "third"]),
  visible: z.boolean(),
});

export const DashboardSectionPlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  itemIds: z.array(z.string()),
  order: z.number().int(),
});

export const DashboardPlanSchema = z.object({
  items: z.array(DashboardItemPlanSchema),
  sections: z.array(DashboardSectionPlanSchema),
});

export const AnalysisPlanSchema = z.object({
  version: z.literal("v1"),
  id: z.string().min(1),
  datasetId: z.string().min(1),
  understandingId: z.string().min(1),
  objectives: z.array(z.string()),
  assumptions: z.array(z.string()),
  tasks: z.array(AnalysisTaskSchema),
  dashboard: DashboardPlanSchema,
  questionsForUser: z.array(z.string()),
  createdAt: z.string(),
});

export type AnalysisPlanParsed = z.infer<typeof AnalysisPlanSchema>;
export type AnalysisTaskParsed = z.infer<typeof AnalysisTaskSchema>;

/** 校验分析计划结构 */
export function validateAnalysisPlan(
  raw: unknown,
): { ok: true; data: AnalysisPlanParsed } | { ok: false; error: string } {
  const r = AnalysisPlanSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => i.message).join("; ") };
}
