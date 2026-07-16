import { z } from "zod";
import { FormulaExpressionSchema } from "./formula";

/**
 * 数据理解层 Zod Schema（SPEC 10.2）。
 *
 * 类型契约见 lib/types.ts 的 DatasetUnderstanding 等；本文件提供运行时校验，
 * 用于校验 LLM 输出与用户确认输入。业务语义权威来源是 DatasetUnderstanding。
 */

export const DatasetKindSchema = z.enum([
  "time_series",
  "transaction",
  "event_log",
  "cross_section",
  "survey",
  "inventory",
  "kpi_wide",
  "kpi_long",
  "matrix",
  "mixed",
  "unknown",
]);

export const TableShapeSchema = z.enum([
  "tidy_rows",
  "wide_metrics",
  "long_metrics",
  "cross_table",
  "multi_header",
  "summary_with_subtotals",
  "multi_sheet",
  "unknown",
]);

export const SemanticFieldRoleSchema = z.enum([
  "time",
  "dimension",
  "metric",
  "status",
  "identifier",
  "text",
  "ignored",
]);

export const MeasureBehaviorSchema = z.enum([
  "flow",
  "stock",
  "rate",
  "duration",
  "score",
  "currency",
  "count",
  "unknown",
]);

export const SemanticSubRoleSchema = z.enum([
  "actual",
  "target",
  "numerator",
  "denominator",
  "category_code",
  "category_label",
  "time_part",
  "unit",
  "none",
]);

export const SemanticAggregationSchema = z.enum([
  "sum",
  "avg",
  "count",
  "min",
  "max",
  "median",
  "last",
  "none",
]);

export const FieldRelationshipKindSchema = z.enum([
  "actual_target",
  "numerator_denominator",
  "hierarchy",
  "code_label",
  "time_parts",
  "unit_binding",
  "same_measure_different_period",
  "other",
]);

export const FieldUnderstandingSchema = z.object({
  field: z.string().min(1),
  semanticName: z.string().min(1),
  role: SemanticFieldRoleSchema,
  measureBehavior: MeasureBehaviorSchema,
  subRole: SemanticSubRoleSchema,
  businessMeaning: z.string(),
  recommendedAggregation: SemanticAggregationSchema,
  naturalOrder: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const FieldRelationshipSchema = z.object({
  id: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1),
  relation: FieldRelationshipKindSchema,
  description: z.string(),
  confidence: z.number().min(0).max(1),
});

export const DerivedMetricSuggestionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  formula: FormulaExpressionSchema,
  description: z.string(),
  unit: z.string().optional(),
  confidence: z.number().min(0).max(1),
  requiresUserConfirmation: z.boolean(),
});

export const UnderstandingAmbiguityChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  patch: z.array(FieldUnderstandingSchema.partial()),
});

export const UnderstandingAmbiguitySchema = z.object({
  id: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1),
  question: z.string().min(1),
  choices: z.array(UnderstandingAmbiguityChoiceSchema).optional(),
  blocking: z.boolean(),
});

export const UnderstandingStateValueSchema = z.enum([
  "needs_user_input",
  "ready_for_confirmation",
  "confirmed",
  "fallback",
]);

export const DatasetUnderstandingSchema = z.object({
  version: z.literal("v1"),
  id: z.string().min(1),
  datasetId: z.string().min(1),
  datasetKind: DatasetKindSchema,
  tableShape: TableShapeSchema,
  businessDomain: z.string(),
  businessDescription: z.string(),
  grainDescription: z.string(),
  rowMeaning: z.string(),
  selectedSheets: z.array(z.string()),
  fields: z.array(FieldUnderstandingSchema),
  relationships: z.array(FieldRelationshipSchema),
  derivedMetrics: z.array(DerivedMetricSuggestionSchema),
  recommendedObjectives: z.array(z.string()),
  ambiguities: z.array(UnderstandingAmbiguitySchema),
  confidence: z.number().min(0).max(1),
  status: UnderstandingStateValueSchema,
  createdAt: z.string(),
  confirmedAt: z.string().optional(),
});

export type DatasetUnderstandingParsed = z.infer<typeof DatasetUnderstandingSchema>;

/** 校验数据集理解结构 */
export function validateDatasetUnderstanding(
  raw: unknown,
):
  | { ok: true; data: DatasetUnderstandingParsed }
  | { ok: false; error: string } {
  const r = DatasetUnderstandingSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => i.message).join("; ") };
}
