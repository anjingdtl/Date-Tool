/**
 * lib/orchestrator/run-analysis-session.ts
 *
 * 编排主链路（SPEC 7 / 14.2）：
 *   plan → execute → review → (revise → re-execute)×≤2 → finalize → persist。
 *
 * - 单任务失败不中止；依赖失败 skipped；
 * - revise 用 applyReviewPatch 形成新 Revision，新增任务上限 MAX_REVIEW_ADDED_TASKS；
 * - review 不可用 → reviewStatus=unavailable，用确定性结果 + review.narrative 兜底；
 * - needs_user_input 暂停（保留已算结果）。
 */
import { createAnalysisPlan } from "@/lib/planner/create-analysis-plan";
import { validateAnalysisPlan } from "@/lib/planner/validate-analysis-plan";
import { executePlan } from "@/lib/executor/execute-plan";
import { compileDashboard } from "@/lib/executor/compile-chart";
import { reviewExecution } from "@/lib/reviewer/review-execution";
import { applyReviewPatch } from "@/lib/reviewer/apply-review-patch";
import { listSessions, saveSession, saveRevision } from "@/lib/store";
import { logger } from "@/lib/logger";
import {
  MAX_REVIEW_ROUNDS,
  MAX_REVIEW_ADDED_TASKS,
  DEFAULT_CONCURRENCY,
  MAX_SESSIONS_PER_DATASET,
} from "./limits";
import type { OrchestratorHooks } from "./events";
import type {
  AnalysisEvidence,
  AnalysisPlan,
  AnalysisRevision,
  AnalysisSession,
  ChartSpec,
  ComputedInsight,
  DatasetUnderstanding,
  EChartsOption,
  FinalAnalysisResult,
  PlanExecutionResult,
  PlanSummary,
  ReviewStatus,
  StoredDataset,
  ToolExecutionContext,
} from "@/lib/types";

export interface RunSessionInput {
  dataset: StoredDataset;
  understanding: DatasetUnderstanding;
  userGoal?: string;
  userHardConstraints?: string[];
  requestId: string;
  hooks: OrchestratorHooks;
}

export interface RunSessionResult {
  session: AnalysisSession;
  activeRevision: AnalysisRevision;
  finalResult: FinalAnalysisResult;
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${rand}`;
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function applyChartDecisions(
  plan: AnalysisPlan,
  review: import("@/lib/types").AnalysisReview | null,
): AnalysisPlan {
  if (!review || review.chartDecisions.length === 0) return plan;
  const decisions = new Map(review.chartDecisions.map((decision) => [decision.itemId, decision]));
  const items = plan.dashboard.items
    .filter((item) => decisions.get(item.id)?.action !== "remove")
    .map((item) => {
      const decision = decisions.get(item.id);
      if (!decision || decision.action === "keep") return { ...item };
      if (decision.action === "rename" || decision.action === "replace") {
        return { ...item, ...decision.replacement };
      }
      if (decision.action === "reorder" && decision.replacement?.priority !== undefined) {
        return { ...item, priority: decision.replacement.priority };
      }
      return { ...item };
    });
  return {
    ...plan,
    dashboard: { ...plan.dashboard, items },
  };
}

function localReviewFallbackNarrative(
  plan: AnalysisPlan,
  execution: PlanExecutionResult,
  truncationNote?: string,
): string {
  const results = Object.values(execution.results);
  const succeeded = results.filter((result) =>
    result.status === "success" || result.status === "partial",
  ).length;
  const failed = results.length - succeeded;
  return [
    `本地确定性引擎已按计划完成 ${succeeded}/${plan.tasks.length} 个分析任务。`,
    failed > 0
      ? `${failed} 个任务失败或因依赖未满足而跳过，相关图表与结论已自动排除。`
      : "所有计划任务均已产生可追溯的确定性结果。",
    truncationNote,
    "LLM 终审当前不可用，因此这里只展示本地计算结果与 Evidence，不补充未经验证的数值结论。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function finalizeAnalysisResult(args: {
  dataset: StoredDataset;
  plan: AnalysisPlan;
  execution: PlanExecutionResult;
  review: import("@/lib/types").AnalysisReview | null;
  reviewOk: boolean;
  session: AnalysisSession;
  revision: AnalysisRevision;
  understanding: DatasetUnderstanding;
  truncationNote?: string;
  unresolvedReview?: boolean;
}): FinalAnalysisResult {
  const { dataset: _dataset, plan, execution, review, reviewOk, session, revision, understanding, truncationNote, unresolvedReview } = args;
  void _dataset;
  const effectivePlan = applyChartDecisions(plan, review);
  const { charts, issues } = compileDashboard(effectivePlan, execution);
  const evidence: AnalysisEvidence[] = [];
  for (const id of execution.taskOrder) {
    evidence.push(...execution.results[id].evidence);
  }
  const taskResults = Object.values(execution.results);
  const succeeded = taskResults.filter(
    (r) => r.status === "success" || r.status === "partial",
  ).length;
  const failed = taskResults.filter(
    (r) => r.status === "failed" || r.status === "skipped",
  ).length;

  const warnings: string[] = [...issues];
  if (truncationNote) warnings.push(truncationNote);
  for (const r of taskResults) warnings.push(...r.warnings);
  if (!reviewOk) warnings.push("LLM 终审不可用，结果基于确定性计算。");
  if (unresolvedReview || review?.status === "revise") {
    warnings.push("终审仍有未解决的修订建议，已保留当前有效计算结果。");
  }

  const hasReviewWarnings = review
    ? review.findings.some(
        (f) => f.level === "warning" || f.level === "possible_error",
      )
    : false;
  const reviewStatus: ReviewStatus = !reviewOk || !review
    ? "unavailable"
    : review.status === "needs_user_input"
      ? "needs_user_input"
      : hasReviewWarnings || failed > 0 || unresolvedReview || review.status === "revise"
        ? "approved_with_warnings"
        : "approved";

  const planSummary: PlanSummary = {
    objectiveCount: plan.objectives.length,
    taskCount: plan.tasks.length,
    succeededTaskCount: succeeded,
    failedTaskCount: failed,
  };

  const computedInsights: ComputedInsight[] = (review?.findings ?? [])
    .filter((f) => Boolean(f.evidenceIds[0]))
    .map((f) => ({
      id: f.id,
      level: f.level === "possible_error" ? "warning" : f.level === "positive" ? "positive" : "info",
      title: f.title,
      statement: f.statement,
      evidenceId: f.evidenceIds[0] ?? "",
      fields: [],
    }));
  const insights = (review?.findings ?? []).map(
    (f) => `[${f.level}] ${f.title} — ${f.statement}`,
  );

  const chartsSpec: ChartSpec[] = charts.map((c) => c.spec);
  const options: EChartsOption[] = charts.map((c) => c.option);

  return {
    provider: "local+llm",
    summary: review?.executiveSummary ?? `已完成 ${plan.tasks.length} 个分析任务。`,
    insights,
    charts: chartsSpec,
    options,
    narrative:
      reviewOk && review
        ? review.narrative
        : localReviewFallbackNarrative(plan, execution, truncationNote),
    createdAt: new Date().toISOString(),
    evidence,
    computedInsights,
    warnings,
    version: "v0.3.0",
    analysisMode: "llm_orchestrated",
    sessionId: session.id,
    revisionId: revision.id,
    understandingId: understanding.id,
    reviewStatus,
    planSummary,
    findings: review?.findings,
    questionsForUser: review?.questionsForUser,
  };
}

export async function runAnalysisSession(
  input: RunSessionInput,
): Promise<RunSessionResult> {
  const { dataset, understanding, requestId, hooks } = input;
  const existingSessions = await listSessions(dataset.id);
  if (existingSessions.length >= MAX_SESSIONS_PER_DATASET) {
    throw new Error(`Session 数量已达到上限 ${MAX_SESSIONS_PER_DATASET}`);
  }
  const context: ToolExecutionContext = {
    dataset,
    understanding,
    priorResults: {},
    requestId,
  };
  const truncationNote =
    dataset.quality && dataset.quality.storedRowCount < dataset.quality.originalRowCount
      ? `数据已截断：原始 ${dataset.quality.originalRowCount} 行，载入 ${dataset.quality.storedRowCount} 行，结论基于已载入数据。`
      : undefined;

  // 1. 制订计划
  hooks.onStage?.("planning", "正在制订分析计划");
  const planResult = await createAnalysisPlan(understanding, dataset, requestId, {
    userGoal: input.userGoal,
    userHardConstraints: input.userHardConstraints,
  });
  if (!planResult.ok || !planResult.plan) {
    throw new Error(planResult.error ?? "分析计划生成失败");
  }
  let plan = planResult.plan;
  hooks.onPlan?.(plan);

  // 2. session + 初始 revision
  const sessionId = newId("sess");
  const now0 = new Date().toISOString();
  const session: AnalysisSession = {
    id: sessionId,
    datasetId: dataset.id,
    status: "executing",
    activeRevisionId: "",
    revisionIds: [],
    createdAt: now0,
    updatedAt: now0,
  };
  logger.info("session_started", {
    requestId,
    datasetId: dataset.id,
    sessionId,
  });
  let sequence = 0;
  const revisions: AnalysisRevision[] = [];
  const makeRevision = (over: {
    plan: AnalysisPlan;
    source: AnalysisRevision["source"];
    parentRevisionId?: string;
  }): AnalysisRevision => {
    sequence++;
    return {
      id: newId("rev"),
      sessionId,
      sequence,
      status: "executing",
      source: over.source,
      parentRevisionId: over.parentRevisionId,
      understandingSnapshot: understanding,
      plan: over.plan,
      execution: null,
      review: null,
      finalResult: null,
      createdAt: new Date().toISOString(),
    };
  };

  let revision = makeRevision({ plan, source: "initial" });
  revisions.push(revision);
  logger.info("revision_started", {
    requestId,
    datasetId: dataset.id,
    sessionId,
    revisionId: revision.id,
    source: revision.source,
  });

  // 3. review 循环
  let review: import("@/lib/types").AnalysisReview | null = null;
  let reviewOk = false;
  let lastExecution: PlanExecutionResult | null = null;
  let unresolvedReview = false;

  for (let round = 0; round <= MAX_REVIEW_ROUNDS; round++) {
    hooks.onStage?.("executing", `正在执行分析任务（第 ${round + 1} 轮）`);
    const execution = await executePlan(revision.plan, context, {
      maxConcurrency: DEFAULT_CONCURRENCY,
      onTaskStarted: (t) => {
        logger.info("task_started", {
          requestId,
          datasetId: dataset.id,
          sessionId,
          revisionId: revision.id,
          taskId: t.id,
          operator: t.operator,
        });
        hooks.onTaskStarted?.(t);
      },
      onTaskCompleted: (t, r) => {
        logger.info("task_completed", {
          requestId,
          datasetId: dataset.id,
          sessionId,
          revisionId: revision.id,
          taskId: t.id,
          operator: t.operator,
          durationMs: r.durationMs,
          status: r.status,
        });
        hooks.onTaskCompleted?.(t, r);
      },
      onTaskFailed: (t, r) => {
        logger.warn("task_failed", {
          requestId,
          datasetId: dataset.id,
          sessionId,
          revisionId: revision.id,
          taskId: t.id,
          operator: t.operator,
          durationMs: r.durationMs,
          status: r.status,
        });
        hooks.onTaskFailed?.(t, r);
      },
    });
    revision.execution = execution;
    lastExecution = execution;

    hooks.onStage?.("reviewing", "AI 正在终审结果");
    const reviewRes = await reviewExecution({
      understanding,
      plan: revision.plan,
      execution,
      userConstraints: input.userHardConstraints,
      truncationNote,
      requestId,
    });
    reviewOk = reviewRes.ok;
    review = reviewRes.review;
    if (review) {
      revision.review = review;
      hooks.onReview?.(review);
    }

    if (reviewOk && review && review.status === "approved") break;
    if (reviewOk && review && review.status === "needs_user_input") {
      logger.info("review_needs_user_input", {
        requestId,
        datasetId: dataset.id,
        sessionId,
        revisionId: revision.id,
      });
      hooks.onQuestion?.(review.questionsForUser);
      session.status = "needs_user_input";
      break;
    }
    if (round === MAX_REVIEW_ROUNDS) {
      unresolvedReview = Boolean(review?.status === "revise");
      break;
    }
    if (review && review.planPatch) {
      if (review.planPatch.addTasks.length > MAX_REVIEW_ADDED_TASKS) {
        review.planPatch.addTasks = review.planPatch.addTasks.slice(
          0,
          MAX_REVIEW_ADDED_TASKS,
        );
      }
      const newPlan = applyReviewPatch(revision.plan, review.planPatch);
      const v = validateAnalysisPlan(newPlan, { dataset, understanding });
      if (!v.ok) {
        logger.warn("review_patch_invalid", {
          requestId,
          issues: v.issues.map((i) => i.message),
        });
        unresolvedReview = true;
        break;
      }
      revision.status = "reviewing";
      plan = newPlan;
      revision = makeRevision({
        plan: newPlan,
        source: "review",
        parentRevisionId: revision.id,
      });
      revisions.push(revision);
      logger.info("review_requested_revision", {
        requestId,
        datasetId: dataset.id,
        sessionId,
        revisionId: revision.id,
        round: round + 1,
      });
      logger.info("revision_started", {
        requestId,
        datasetId: dataset.id,
        sessionId,
        revisionId: revision.id,
        source: revision.source,
      });
      hooks.onRevision?.(revision);
    } else {
      unresolvedReview = Boolean(review?.status === "revise");
      break;
    }
  }

  if (!lastExecution) throw new Error("分析执行未产生结果");

  // 流式 narrative
  if (review?.narrative) {
    for (const ch of chunkText(review.narrative, 20)) {
      hooks.onNarrativeToken?.(ch);
    }
  }

  // 4. finalize
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
  revision.status =
    session.status === "needs_user_input" ? "needs_user_input" : "approved";

  session.activeRevisionId = revision.id;
  session.revisionIds = revisions.map((r) => r.id);
  if (session.status !== "needs_user_input") session.status = "completed";
  session.updatedAt = new Date().toISOString();

  // 5. persist（先写 Revision，最后原子激活 Session，避免 activeRevisionId 悬空）
  for (const r of revisions) await saveRevision(dataset.id, sessionId, r);
  await saveSession(dataset.id, session);

  logger.info("revision_activated", {
    requestId,
    datasetId: dataset.id,
    sessionId,
    revisionId: revision.id,
  });
  logger.info("session_completed", {
    requestId,
    datasetId: dataset.id,
    sessionId,
    revisionId: revision.id,
    status: session.status,
    provider: finalResult.provider,
  });

  hooks.onRevision?.(revision);
  hooks.onFinal?.(finalResult);
  return { session, activeRevision: revision, finalResult };
}
