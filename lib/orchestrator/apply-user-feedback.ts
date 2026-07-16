import { randomUUID } from "crypto";
import { analyzePatchImpact, type PatchImpact } from "@/lib/conversation/impact-analysis";
import { applyPlanPatch } from "@/lib/conversation/apply-plan-patch";
import { interpretUserFeedback } from "@/lib/conversation/interpret-user-feedback";
import { nextRevisionSequence } from "@/lib/conversation/revision-history";
import { executePlan } from "@/lib/executor/execute-plan";
import { validateAnalysisPlan } from "@/lib/planner/validate-analysis-plan";
import { reviewExecution } from "@/lib/reviewer/review-execution";
import { validateDatasetUnderstanding } from "@/lib/schemas/understanding";
import {
  listRevisions,
  saveRevision,
  saveSession,
  saveUnderstanding,
} from "@/lib/store";
import type {
  AnalysisPlan,
  AnalysisRevision,
  AnalysisSession,
  DatasetUnderstanding,
  FinalAnalysisResult,
  PlanExecutionResult,
  StoredDataset,
  ToolExecutionContext,
} from "@/lib/types";
import type { OrchestratorHooks } from "./events";
import {
  DEFAULT_CONCURRENCY,
  MAX_REVIEW_ADDED_TASKS,
  MAX_REVIEW_ROUNDS,
  MAX_REVISIONS_PER_SESSION,
} from "./limits";
import { finalizeAnalysisResult } from "./run-analysis-session";

function id(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

function withPlanIdentity(plan: AnalysisPlan): AnalysisPlan {
  return { ...plan, id: id("plan"), createdAt: new Date().toISOString() };
}

export interface ApplyUserFeedbackInput {
  dataset: StoredDataset;
  session: AnalysisSession;
  baseRevision: AnalysisRevision;
  message: string;
  requestId: string;
  hooks: OrchestratorHooks;
}

export interface ApplyUserFeedbackResult {
  session: AnalysisSession;
  activeRevision: AnalysisRevision;
  finalResult: FinalAnalysisResult;
  impact: PatchImpact;
}

export async function applyUserFeedback(
  input: ApplyUserFeedbackInput,
): Promise<ApplyUserFeedbackResult> {
  const { dataset, baseRevision, requestId, hooks } = input;
  if (input.session.activeRevisionId !== baseRevision.id) {
    throw new Error("当前 Revision 已变化，请刷新后重试");
  }
  if (!baseRevision.execution) throw new Error("当前 Revision 没有可复用的执行结果");

  hooks.onStage?.("interpreting_feedback", "正在理解修改要求");
  const interpreted = await interpretUserFeedback(baseRevision, input.message, requestId);
  if (!interpreted.ok || !interpreted.patch) {
    throw new Error(interpreted.error ?? "无法理解修改要求");
  }
  const patch = interpreted.patch;
  const applied = applyPlanPatch(
    baseRevision.plan,
    baseRevision.understandingSnapshot,
    patch,
  );
  const understandingValidation = validateDatasetUnderstanding(applied.understanding);
  if (!understandingValidation.ok) {
    throw new Error(`字段语义修改非法：${understandingValidation.error}`);
  }
  let understanding = understandingValidation.data as DatasetUnderstanding;
  let plan = withPlanIdentity(applied.plan);
  const validation = validateAnalysisPlan(plan, {
    dataset,
    understanding,
    userHardConstraints: patch.userHardConstraints,
  });
  if (!validation.ok) {
    throw new Error(
      `修改后的计划校验失败：${validation.issues
        .filter((issue) => issue.level === "error")
        .map((issue) => issue.message)
        .join("；")}`,
    );
  }

  const impact = analyzePatchImpact(baseRevision.plan, plan, patch);
  hooks.onStage?.(
    "feedback_impact",
    impact.presentationOnly
      ? "本次仅调整展示，无需重新计算"
      : `将重新计算 ${impact.affectedTaskIds.length} 个受影响任务`,
  );
  hooks.onPlan?.(plan);

  const existing = await listRevisions(dataset.id, input.session.id);
  if (existing.length >= MAX_REVISIONS_PER_SESSION) {
    throw new Error(`Revision 数量已达到上限 ${MAX_REVISIONS_PER_SESSION}`);
  }
  let sequence = nextRevisionSequence(existing);
  const newRevisions: AnalysisRevision[] = [];
  const makeRevision = (
    source: AnalysisRevision["source"],
    parentRevisionId: string,
    revisionPlan: AnalysisPlan,
    snapshot: DatasetUnderstanding,
  ): AnalysisRevision => ({
    id: id("rev"),
    sessionId: input.session.id,
    parentRevisionId,
    sequence: sequence++,
    status: "executing",
    source,
    userInstruction: source === "user" ? input.message : undefined,
    understandingSnapshot: snapshot,
    plan: revisionPlan,
    execution: null,
    review: null,
    finalResult: null,
    createdAt: new Date().toISOString(),
  });

  let revision = makeRevision("user", baseRevision.id, plan, understanding);
  newRevisions.push(revision);
  let priorExecution: PlanExecutionResult = baseRevision.execution;
  let affected = new Set(impact.affectedTaskIds);
  let review: import("@/lib/types").AnalysisReview | null = null;
  let reviewOk = false;
  let unresolvedReview = false;
  let lastExecution: PlanExecutionResult | null = null;
  const truncationNote =
    dataset.quality && dataset.quality.storedRowCount < dataset.quality.originalRowCount
      ? `数据已截断：原始 ${dataset.quality.originalRowCount} 行，载入 ${dataset.quality.storedRowCount} 行，结论基于已载入数据。`
      : undefined;

  for (let round = 0; round <= MAX_REVIEW_ROUNDS; round++) {
    hooks.onStage?.("executing", `正在执行修改后的分析（第 ${round + 1} 轮）`);
    const context: ToolExecutionContext = {
      dataset,
      understanding,
      priorResults: { ...priorExecution.results },
      requestId,
    };
    const execution = await executePlan(revision.plan, context, {
      maxConcurrency: DEFAULT_CONCURRENCY,
      taskIdsToExecute: affected,
      reuseResults: priorExecution.results,
      onTaskStarted: (task) => hooks.onTaskStarted?.(task),
      onTaskCompleted: (task, result) => hooks.onTaskCompleted?.(task, result),
      onTaskFailed: (task, result) => hooks.onTaskFailed?.(task, result),
    });
    revision.execution = execution;
    lastExecution = execution;

    hooks.onStage?.("reviewing", "AI 正在终审修改后的结果");
    const reviewed = await reviewExecution({
      understanding,
      plan: revision.plan,
      execution,
      userConstraints: patch.userHardConstraints,
      truncationNote,
      requestId,
    });
    reviewOk = reviewed.ok;
    review = reviewed.review;
    if (review) {
      revision.review = review;
      hooks.onReview?.(review);
    }
    if (reviewOk && review?.status === "approved") break;
    if (reviewOk && review?.status === "needs_user_input") {
      hooks.onQuestion?.(review.questionsForUser);
      break;
    }
    if (round === MAX_REVIEW_ROUNDS) {
      unresolvedReview = review?.status === "revise";
      break;
    }
    if (!review?.planPatch) {
      unresolvedReview = review?.status === "revise";
      break;
    }
    const boundedPatch = {
      ...review.planPatch,
      addTasks: review.planPatch.addTasks.slice(0, MAX_REVIEW_ADDED_TASKS),
    };
    const next = applyPlanPatch(revision.plan, understanding, boundedPatch);
    const nextPlan = withPlanIdentity(next.plan);
    const nextValidation = validateAnalysisPlan(nextPlan, { dataset, understanding: next.understanding });
    if (!nextValidation.ok) {
      unresolvedReview = true;
      break;
    }
    const reviewImpact = analyzePatchImpact(revision.plan, nextPlan, boundedPatch);
    if (existing.length + newRevisions.length >= MAX_REVISIONS_PER_SESSION) {
      unresolvedReview = true;
      break;
    }
    revision.status = "reviewing";
    priorExecution = execution;
    affected = new Set(reviewImpact.affectedTaskIds);
    understanding = next.understanding;
    plan = nextPlan;
    revision = makeRevision("review", revision.id, plan, understanding);
    newRevisions.push(revision);
  }

  if (!lastExecution) throw new Error("修改后未产生执行结果");
  const session: AnalysisSession = {
    ...input.session,
    status: review?.status === "needs_user_input" ? "needs_user_input" : "completed",
    activeRevisionId: revision.id,
    revisionIds: [...input.session.revisionIds, ...newRevisions.map((item) => item.id)],
    updatedAt: new Date().toISOString(),
  };
  const finalResult = finalizeAnalysisResult({
    dataset,
    plan: revision.plan,
    execution: lastExecution,
    review,
    reviewOk,
    session,
    revision,
    understanding,
    truncationNote,
    unresolvedReview,
  });
  revision.finalResult = finalResult;
  revision.status = session.status === "needs_user_input" ? "needs_user_input" : "approved";

  // 失败路径在此之前不会写入；先保存新 Revision，最后切换 activeRevisionId。
  for (const item of newRevisions) await saveRevision(dataset.id, session.id, item);
  if (understanding !== baseRevision.understandingSnapshot) {
    await saveUnderstanding(dataset.id, understanding);
  }
  await saveSession(dataset.id, session);
  hooks.onRevision?.(revision);
  hooks.onFinal?.(finalResult);
  return { session, activeRevision: revision, finalResult, impact };
}
