import { z } from "zod";
import {
  AnalysisTaskSchema,
  DashboardItemPlanSchema,
  DashboardSectionPlanSchema,
} from "./analysis-plan";
import {
  DatasetKindSchema,
  TableShapeSchema,
  FieldUnderstandingSchema,
  FieldRelationshipSchema,
  DerivedMetricSuggestionSchema,
} from "./understanding";

/**
 * 用户自然语言微调 Patch Schema（SPEC 16.2）。
 *
 * 用户修改必须转换为此结构化 Patch 并校验后执行，禁止 LLM 直接返回修改后的数值。
 */

export const UnderstandingPatchSchema = z.object({
  datasetKind: DatasetKindSchema.optional(),
  tableShape: TableShapeSchema.optional(),
  businessDescription: z.string().optional(),
  grainDescription: z.string().optional(),
  rowMeaning: z.string().optional(),
  selectedSheets: z.array(z.string().min(1)).optional(),
  fields: z
    .array(
      z.object({
        field: z.string().min(1),
        changes: FieldUnderstandingSchema.omit({ field: true }).partial().strict(),
      }),
    )
    .optional(),
  relationshipsToAdd: z.array(FieldRelationshipSchema).optional(),
  relationshipsToRemove: z.array(z.string()).optional(),
  derivedMetricsToAdd: z.array(DerivedMetricSuggestionSchema).optional(),
  derivedMetricsToRemove: z.array(z.string()).optional(),
});

export const TaskUpdateSchema = z.object({
  taskId: z.string().min(1),
  changes: AnalysisTaskSchema.partial(),
});

export const DashboardChangesSchema = z.object({
  removeItems: z.array(z.string()),
  updateItems: z.array(
    z.object({
      itemId: z.string().min(1),
      changes: DashboardItemPlanSchema.partial(),
    }),
  ),
  reorderItems: z.array(z.string()).optional(),
  sectionChanges: z.array(DashboardSectionPlanSchema).optional(),
});

export const AnalysisPlanPatchSchema = z.object({
  version: z.literal("v1"),
  baseRevisionId: z.string().min(1),
  intentSummary: z.string().min(1),
  understandingPatch: UnderstandingPatchSchema.optional(),
  removeTasks: z.array(z.string()),
  updateTasks: z.array(TaskUpdateSchema),
  addTasks: z.array(AnalysisTaskSchema),
  dashboardChanges: DashboardChangesSchema,
  userHardConstraints: z.array(z.string()),
  explanation: z.string(),
});

export type AnalysisPlanPatchParsed = z.infer<typeof AnalysisPlanPatchSchema>;

/** 校验用户 Patch 结构 */
export function validateAnalysisPlanPatch(
  raw: unknown,
): { ok: true; data: AnalysisPlanPatchParsed } | { ok: false; error: string } {
  const r = AnalysisPlanPatchSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => i.message).join("; ") };
}
