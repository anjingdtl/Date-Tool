/**
 * lib/analyzer.ts
 *
 * v0.3 兼容门面（SPEC 14.1）：
 * - LLM 未启用 / 无已确认 Understanding → runLocalFallbackAnalysis（保留 v0.2.1 本地降级）；
 * - LLM 启用 + confirmed Understanding → runOrchestratedAnalysis（理解→计划→执行→终审）。
 *
 * 现有 runLocalAnalysis 保留为无 LLM 或 LLM 失败时的 fallback。
 */
import { buildChartOption } from "./chart";
import { logger } from "./logger";
import { getActiveLLMConfig } from "./llm-config";
import { runLocalAnalysis } from "./analysis";
import { getUnderstanding } from "./store";
import { runAnalysisSession } from "./orchestrator/run-analysis-session";
import type { OrchestratorHooks } from "./orchestrator/events";
import type {
  AnalysisEvidence,
  AnalysisPlan,
  AnalysisResult,
  AnalysisReview,
  AnalysisRevision,
  AnalysisTask,
  ChartSpec,
  ComputedInsight,
  EChartsOption,
  FinalAnalysisResult,
  StoredDataset,
  TaskExecutionResult,
} from "./types";

/* ------------------------- 工具 ------------------------- */

function attachOptions(charts: ChartSpec[], ds: StoredDataset): EChartsOption[] {
  return charts.map((c) => buildChartOption(c, ds.rows));
}

function insightsToStrings(insights: ComputedInsight[]): string[] {
  return insights.map(
    (i) =>
      `[${i.level === "warning" ? "关注" : i.level === "positive" ? "正向" : "提示"}] ${i.title} — ${i.statement}`,
  );
}

function localSummary(ds: StoredDataset, insightCount: number): string {
  return `数据集《${ds.name}》共 ${ds.rowCount} 行、${ds.columns.length} 列，本地引擎已生成 ${insightCount} 条洞察。`;
}

function localNarrative(ds: StoredDataset, insights: ComputedInsight[]): string {
  const top = insights.slice(0, 3);
  const parts = top.map((i) => `· ${i.title}: ${i.statement}`);
  return [
    `已为你完成《${ds.name}》的分析：共 ${ds.rowCount} 行、${ds.columns.length} 列。`,
    `本地引擎已算完所有关键数值，以下 3 条是最值得关注的信号：`,
    ...parts,
    `如需深挖某个字段，告诉我字段名即可继续下钻。`,
  ].join("\n\n");
}

function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize)
    chunks.push(text.slice(i, i + chunkSize));
  return chunks;
}

/* ------------------------- 钩子定义 ------------------------- */

/** SSE final 事件载荷（本地兜底） */
export interface FinalAnalysisPayload {
  summary: string;
  insights: string[];
  charts: ChartSpec[];
  options: EChartsOption[];
  narrative?: string;
  provider: "local" | "local+llm";
  createdAt: string;
  evidence?: AnalysisEvidence[];
  computedInsights?: ComputedInsight[];
  warnings?: string[];
}

export interface AnalyzeHooks {
  onStructured?: (p: {
    summary: string;
    insights: string[];
    charts: ChartSpec[];
    options: EChartsOption[];
    evidence?: unknown[];
    computedInsights?: ComputedInsight[];
    warnings?: string[];
    provider: "local" | "local+llm";
  }) => void;
  onNarrativeToken: (token: string) => void;
  onStage?: (stage: string, code?: string) => void;
  onFinal?: (p: FinalAnalysisPayload | FinalAnalysisResult) => void;
  /** v0.3 编排事件 */
  onPlan?: (plan: AnalysisPlan) => void;
  onTaskStarted?: (task: AnalysisTask) => void;
  onTaskCompleted?: (task: AnalysisTask, result: TaskExecutionResult) => void;
  onTaskFailed?: (task: AnalysisTask, result: TaskExecutionResult) => void;
  onReview?: (review: AnalysisReview) => void;
  onQuestion?: (questions: string[]) => void;
  onRevision?: (revision: AnalysisRevision) => void;
}

/** 本地兜底 final 载荷 */
function emitFinal(hooks: AnalyzeHooks, r: AnalysisResult): void {
  // 防御性去重：避免 warnings 中出现重复条目（如 LLM 自己列了两条相同的截断提示）。
  const seen = new Set<string>();
  const dedupedWarnings = (r.warnings ?? []).filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
  hooks.onFinal?.({
    summary: r.summary,
    insights: r.insights,
    charts: r.charts,
    options: r.options,
    narrative: r.narrative,
    provider: r.provider === "local+llm" ? "local+llm" : "local",
    createdAt: r.createdAt,
    evidence: r.evidence,
    computedInsights: r.computedInsights,
    warnings: dedupedWarnings,
  });
}

/* ------------------------- 总入口（门面） ------------------------- */

export async function analyzeDataset(
  ds: StoredDataset,
  requestId: string,
  hooks: AnalyzeHooks,
  options?: { userGoal?: string; forceLocal?: boolean },
): Promise<AnalysisResult> {
  if (options?.forceLocal) {
    return runLocalFallbackAnalysis(ds, requestId, hooks);
  }
  const llmConfig = await getActiveLLMConfig();
  if (!llmConfig.enabled) {
    return runLocalFallbackAnalysis(ds, requestId, hooks);
  }
  // LLM 编排需已确认 Understanding（SPEC 6 / 19.3）
  const understanding = await getUnderstanding(ds.id);
  if (!understanding || understanding.status !== "confirmed") {
    logger.info("orchestrator_fallback_no_understanding", {
      requestId,
      datasetId: ds.id,
    });
    return runLocalFallbackAnalysis(ds, requestId, hooks);
  }
  try {
    return await runOrchestratedAnalysis(
      ds,
      understanding,
      requestId,
      hooks,
      options,
    );
  } catch (err) {
    // 计划生成/校验等编排步骤失败时不得让可用的本地分析一起失败。
    // runAnalysisSession 只会在最终成功时发 final，因此这里不会产生伪双 final。
    const errMsg = err instanceof Error ? err.message : "unknown";
    logger.warn("orchestrator_failed_fallback_local", {
      requestId,
      datasetId: ds.id,
      message: errMsg,
    });
    // 区分「Session 上限触发」和「真实编排失败」，避免误导用户以为 LLM 不可用。
    const isSessionLimit = errMsg.includes("Session 数量已达到上限");
    hooks.onStage?.(
      isSessionLimit
        ? `已达 Session 上限，本次以本地规则模式继续（不影响已有结果，可清理旧 Session 后重试 LLM 模式）`
        : "AI 编排不可用，正在切换到本地规则模式",
      isSessionLimit ? "fallback_session_limit" : "fallback",
    );
    return runLocalFallbackAnalysis(ds, requestId, hooks);
  }
}

/* ------------------------- 本地降级（保留 v0.2.1） ------------------------- */

async function runLocalFallbackAnalysis(
  ds: StoredDataset,
  requestId: string,
  hooks: AnalyzeHooks,
): Promise<AnalysisResult> {
  const createdAt = new Date().toISOString();
  hooks.onStage?.("正在计算数据质量与统计结果", "local_analysis");
  const local = runLocalAnalysis(ds);

  const insights = local.insights;
  const insightStrings = insightsToStrings(insights);
  const warnings: string[] = [];
  if (ds.quality && ds.quality.storedRowCount < ds.quality.originalRowCount) {
    warnings.push(
      `数据已截断:原始 ${ds.quality.originalRowCount} 行,载入 ${ds.quality.storedRowCount} 行,结论基于已载入数据。`,
    );
  }
  for (const o of local.outliers) {
    if (o.detected && o.outlierCount > 0) {
      warnings.push(`字段「${o.field}」检测到 ${o.outlierCount} 个统计异常(IQR)。`);
    }
  }
  if (local.chartIssues.length > 0) {
    warnings.push(`图表引擎有 ${local.chartIssues.length} 条校验提示(已局部容错)。`);
  }

  const summaryText = localSummary(ds, insights.length);
  const localCharts = local.charts;
  const localOptions = attachOptions(localCharts, ds);

  hooks.onStructured?.({
    summary: summaryText,
    insights: insightStrings,
    charts: localCharts,
    options: localOptions,
    evidence: local.evidence,
    computedInsights: insights,
    warnings,
    provider: "local",
  });

  const narrative = localNarrative(ds, insights);
  for (const ch of chunkText(narrative, 20)) hooks.onNarrativeToken(ch);

  const result: FinalAnalysisResult = {
    provider: "local",
    summary: summaryText,
    insights: insightStrings,
    charts: localCharts,
    options: localOptions,
    narrative,
    createdAt,
    evidence: local.evidence,
    computedInsights: insights,
    warnings,
    version: "v0.3.0",
    analysisMode: "rule_fallback",
    reviewStatus: "unavailable",
  };
  emitFinal(hooks, result);
  return result;
}

/* ------------------------- LLM 编排 ------------------------- */

async function runOrchestratedAnalysis(
  ds: StoredDataset,
  understanding: NonNullable<Awaited<ReturnType<typeof getUnderstanding>>>,
  requestId: string,
  hooks: AnalyzeHooks,
  options?: { userGoal?: string; forceLocal?: boolean },
): Promise<FinalAnalysisResult> {
  const orchHooks: OrchestratorHooks = {
    onStage: (code, message) => hooks.onStage?.(message, code),
    onPlan: (plan) => hooks.onPlan?.(plan),
    onTaskStarted: (t) => hooks.onTaskStarted?.(t),
    onTaskCompleted: (t, r) => hooks.onTaskCompleted?.(t, r),
    onTaskFailed: (t, r) => hooks.onTaskFailed?.(t, r),
    onReview: (review) => hooks.onReview?.(review),
    onQuestion: (q) => hooks.onQuestion?.(q),
    onRevision: (rev) => hooks.onRevision?.(rev),
    onNarrativeToken: (tok) => hooks.onNarrativeToken(tok),
    onFinal: (fr) => hooks.onFinal?.(fr),
  };
  const result = await runAnalysisSession({
    dataset: ds,
    understanding,
    requestId,
    hooks: orchHooks,
    userGoal: options?.userGoal,
  });
  return result.finalResult;
}
