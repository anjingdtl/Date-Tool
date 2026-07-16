import { z } from "zod";
import { DashboardItemPlanSchema } from "./analysis-plan";
import { AnalysisPlanPatchSchema } from "./plan-patch";

/**
 * LLM 终审 Schema（SPEC 15.3）。
 *
 * 终审只能 approve / revise / needs_user_input，且不得修改任何
 * TaskExecutionResult；提出的新计算必须放入 planPatch.addTasks 走相同校验。
 */

export const ReviewFindingLevelSchema = z.enum([
  "info",
  "positive",
  "warning",
  "possible_error",
]);

export const ReviewFindingSchema = z.object({
  id: z.string().min(1),
  level: ReviewFindingLevelSchema,
  title: z.string().min(1),
  statement: z.string().min(1),
  evidenceIds: z.array(z.string()),
  taskIds: z.array(z.string()),
});

export const ChartReviewActionSchema = z.enum([
  "keep",
  "remove",
  "replace",
  "reorder",
  "rename",
]);

export const ChartReviewDecisionSchema = z.object({
  itemId: z.string().min(1),
  action: ChartReviewActionSchema,
  reason: z.string().min(1),
  replacement: DashboardItemPlanSchema.partial().optional(),
});

export const AnalysisReviewSchema = z.object({
  version: z.literal("v1"),
  status: z.enum(["approved", "revise", "needs_user_input"]),
  executiveSummary: z.string().min(1),
  narrative: z.string().min(1),
  findings: z.array(ReviewFindingSchema),
  chartDecisions: z.array(ChartReviewDecisionSchema),
  planPatch: AnalysisPlanPatchSchema.optional(),
  questionsForUser: z.array(z.string()),
  assumptions: z.array(z.string()),
  createdAt: z.string(),
});

export type AnalysisReviewParsed = z.infer<typeof AnalysisReviewSchema>;

/** 校验 LLM 终审结构 */
export function validateAnalysisReview(
  raw: unknown,
): { ok: true; data: AnalysisReviewParsed } | { ok: false; error: string } {
  const r = AnalysisReviewSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => i.message).join("; ") };
}
