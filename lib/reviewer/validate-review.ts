/**
 * lib/reviewer/validate-review.ts
 *
 * 终审结果校验（SPEC 15.4 / 22.6）：
 * - findings.evidenceIds 必须引用已存在的 Evidence（不编造）；
 * - findings.taskIds 引用存在的任务（warning）；
 * - chartDecisions.itemId 引用存在的图表（warning）；
 * - 终审不修改任何 TaskExecutionResult（结构上 review 不含结果修改）。
 */
import type {
  AnalysisPlan,
  AnalysisReview,
  PlanExecutionResult,
} from "@/lib/types";

export interface ReviewValidationIssue {
  code: string;
  message: string;
  level: "warning" | "error";
}

export interface ReviewValidationContext {
  plan: AnalysisPlan;
  execution: PlanExecutionResult;
}

export function validateReview(
  review: AnalysisReview,
  ctx: ReviewValidationContext,
): { ok: boolean; issues: ReviewValidationIssue[] } {
  const issues: ReviewValidationIssue[] = [];

  const evidenceIds = new Set<string>();
  for (const id of Object.keys(ctx.execution.results)) {
    for (const e of ctx.execution.results[id].evidence) evidenceIds.add(e.id);
  }
  const taskIds = new Set(ctx.plan.tasks.map((t) => t.id));
  const itemIds = new Set(ctx.plan.dashboard.items.map((i) => i.id));

  for (const f of review.findings) {
    if (/\d/.test(f.statement) && f.evidenceIds.length === 0) {
      issues.push({
        code: "NUMERIC_FINDING_WITHOUT_EVIDENCE",
        message: `finding「${f.id}」包含数值结论但没有 Evidence`,
        level: "error",
      });
    }
    for (const eid of f.evidenceIds) {
      if (!evidenceIds.has(eid))
        issues.push({
          code: "DANGLING_EVIDENCE",
          message: `finding「${f.id}」引用不存在的 evidence「${eid}」`,
          level: "error",
        });
    }
    for (const tid of f.taskIds) {
      if (!taskIds.has(tid))
        issues.push({
          code: "DANGLING_TASK",
          message: `finding「${f.id}」引用不存在的任务「${tid}」`,
          level: "warning",
        });
    }
  }

  for (const d of review.chartDecisions) {
    if (!itemIds.has(d.itemId))
      issues.push({
        code: "DANGLING_CHART",
        message: `图表决策引用不存在的图表「${d.itemId}」`,
        level: "warning",
      });
  }

  return { ok: !issues.some((i) => i.level === "error"), issues };
}
