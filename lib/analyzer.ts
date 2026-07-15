/**
 * lib/analyzer.ts
 *
 * v0.2 阶段 G 重写:
 * - 本地确定性引擎(runLocalAnalysis)先算所有数值;
 * - 立即向前端发送 structured 结果(charts + insights + evidence);
 * - 若启用 LLM,只发送结构化结果(不含原始数据)让 LLM 做解读;
 * - LLM 只返回 summary/narrative/actions/renamedChartTitles(SPEC 12.2);
 * - LLM 不得修改 xField/yField/agg/计算结果;
 * - 失败回退:LLM 超时或出错时保留本地结果,provider=local;
 * - provider 改为 "local" | "local+llm"(SPEC 12.6)。
 *
 * 旧 mock 逻辑保留为本地兜底,不再单独走 mock 分支。
 */

import { buildChartOption } from "./chart";
import { chatJSON, streamChat } from "./llm";
import { logger } from "./logger";
import { getActiveLLMConfig } from "./llm-config";
import {
  buildLLMInput,
  SYSTEM_PROMPT,
  validateLLMInterpretation,
} from "./llm-prompt";
import { runLocalAnalysis } from "./analysis";
import type {
  AnalysisEvidence,
  AnalysisResult,
  ChartSpec,
  ComputedInsight,
  EChartsOption,
  StoredDataset,
} from "./types";

/* ------------------------- 工具 ------------------------- */

function attachOptions(
  charts: ChartSpec[],
  ds: StoredDataset,
): EChartsOption[] {
  return charts.map((c) => buildChartOption(c, ds.rows));
}

/** 把 ComputedInsight 转成前端展示用的字符串数组 */
function insightsToStrings(insights: ComputedInsight[]): string[] {
  return insights.map(
    (i) => `[${i.level === "warning" ? "关注" : i.level === "positive" ? "正向" : "提示"}] ${i.title} — ${i.statement}`,
  );
}

/** 生成本地兜底 summary */
function localSummary(ds: StoredDataset, insightCount: number): string {
  return `数据集《${ds.name}》共 ${ds.rowCount} 行、${ds.columns.length} 列,本地引擎已生成 ${insightCount} 条洞察。`;
}

/** 生成本地兜底 narrative */
function localNarrative(
  ds: StoredDataset,
  insights: ComputedInsight[],
): string {
  const top = insights.slice(0, 3);
  const parts = top.map((i) => `· ${i.title}: ${i.statement}`);
  return [
    `你好,世恒哥～ 我把《${ds.name}》通读了一遍:共 ${ds.rowCount} 行、${ds.columns.length} 列。`,
    `本地引擎算完了所有关键数值,挑 3 条最值得看的信号给你:`,
    ...parts,
    `想深挖哪个字段,告诉我字段名,我直接去数据里翻个底朝天。`,
  ].join("\n\n");
}

/** 应用 LLM 返回的 renamedChartTitles 到 charts(SPEC 12.2) */
function applyRenamedTitles(
  charts: ChartSpec[],
  renamed?: Record<string, string>,
): ChartSpec[] {
  if (!renamed) return charts;
  return charts.map((c) => {
    const newTitle = renamed[c.id];
    if (newTitle && newTitle.trim()) {
      return { ...c, title: newTitle.trim() };
    }
    return c;
  });
}

/* ------------------------- 钩子定义 ------------------------- */

/** SSE final 事件载荷（SPEC 9.2）：LLM/local 完成后一次性发送最终结果 */
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
  /** 本地结果就绪时触发(立即发送给前端) */
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
  /** LLM 流式 token(SPEC 12.4) */
  onNarrativeToken: (token: string) => void;
  /** LLM 阶段切换提示(SPEC 13.2 分析阶段状态) */
  onStage?: (stage: string) => void;
  /** 最终结果（SPEC 9.2 final 事件）：完成时整体发送，前端据此刷新 summary/图表/标题 */
  onFinal?: (p: FinalAnalysisPayload) => void;
}

/** 发送 final 事件载荷（SPEC 9.2），由 local 与 llm 分支在返回前统一调用 */
function emitFinal(hooks: AnalyzeHooks, r: AnalysisResult): void {
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
    warnings: r.warnings,
  });
}

/* ------------------------- 总入口 ------------------------- */

/**
 * 分析数据集。
 *
 * 流程(SPEC 12.4):
 * 1. 本地计算 runLocalAnalysis;
 * 2. 立即 onStructured 发送本地结果;
 * 3. 若启用 LLM,chatJSON 拿 interpretation;
 * 4. 应用 renamedChartTitles;
 * 5. streamChat 流式发送 narrative;
 * 6. 返回完整 AnalysisResult。
 *
 * 失败回退:任何 LLM 步骤失败都保留本地结果,provider=local。
 */
export async function analyzeDataset(
  ds: StoredDataset,
  requestId: string,
  hooks: AnalyzeHooks,
): Promise<AnalysisResult> {
  const createdAt = new Date().toISOString();

  /* —— 0. 解析运行时 LLM 配置(SPEC 6 单一事实来源) —— */
  const llmConfig = await getActiveLLMConfig();
  logger.info("llm_config_resolved", {
    requestId,
    provider: llmConfig.provider,
    model: llmConfig.model,
    enabled: llmConfig.enabled,
  });

  /* —— 1. 本地确定性计算(SPEC 10) —— */
  hooks.onStage?.("正在计算数据质量与统计结果");
  const local = runLocalAnalysis(ds);

  const insights = local.insights;
  const insightStrings = insightsToStrings(insights);
  const warnings: string[] = [];
  if (
    ds.quality &&
    ds.quality.storedRowCount < ds.quality.originalRowCount
  ) {
    warnings.push(
      `数据已截断:原始 ${ds.quality.originalRowCount} 行,载入 ${ds.quality.storedRowCount} 行,结论基于已载入数据。`,
    );
  }
  for (const o of local.outliers) {
    if (o.detected && o.outlierCount > 0) {
      warnings.push(
        `字段「${o.field}」检测到 ${o.outlierCount} 个统计异常(IQR)。`,
      );
    }
  }
  if (local.chartIssues.length > 0) {
    warnings.push(
      `图表引擎有 ${local.chartIssues.length} 条校验提示(已局部容错)。`,
    );
  }

  const summaryText = localSummary(ds, insights.length);
  const localCharts = local.charts;
  const localOptions = attachOptions(localCharts, ds);

  /* —— 2. 立即发送本地结果(SPEC 12.4) —— */
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

  /* —— 3. 若未启用 LLM,直接返回本地结果(仍流式推送 narrative) —— */
  if (!llmConfig.enabled) {
    const narrative = localNarrative(ds, insights);
    for (const ch of chunkText(narrative, 20)) {
      hooks.onNarrativeToken(ch);
    }
    const result: AnalysisResult = {
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
      version: "v0.2",
    };
    emitFinal(hooks, result);
    return result;
  }

  /* —— 4. LLM 解读(SPEC 12.1/12.2) —— */
  hooks.onStage?.("正在生成 LLM 解读");

  let interpretation: {
    summary: string;
    narrative: string;
    actions: string[];
    renamedChartTitles?: Record<string, string>;
  } | null = null;

  try {
    const userPrompt = buildLLMInput(ds, local);
    const raw = await chatJSON(SYSTEM_PROMPT, userPrompt, requestId);
    const valid = validateLLMInterpretation(raw);
    if (valid.ok) {
      interpretation = valid.data;
    } else {
      logger.warn("LLM interpretation 校验失败,回退本地", {
        requestId,
        error: valid.error,
      });
    }
  } catch (err) {
    logger.warn("LLM 结构化解读失败,回退本地", {
      requestId,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  // 应用 renamedChartTitles(SPEC 12.2)
  const finalCharts = interpretation
    ? applyRenamedTitles(localCharts, interpretation.renamedChartTitles)
    : localCharts;
  const finalOptions = attachOptions(finalCharts, ds);

  const finalSummary = interpretation?.summary ?? summaryText;
  const finalInsights = interpretation
    ? [...insightStrings, ...interpretation.actions.map((a) => `[行动] ${a}`)]
    : insightStrings;

  /* —— 5. 流式发送 narrative(SPEC 12.4) —— */
  let narrative = "";
  if (interpretation?.narrative) {
    // 流式输出 LLM 生成的 narrative
    hooks.onStage?.("正在流式发送解读");
    try {
      // 注意:interpretation.narrative 已经是 chatJSON 返回的完整文本,
      // 这里不再调 streamChat 重复请求,直接逐段发送。
      // 真正的流式在 chatJSON 之后可选:为保持单次请求,我们分段推送。
      const chunks = chunkText(interpretation.narrative, 20);
      for (const ch of chunks) {
        hooks.onNarrativeToken(ch);
        narrative += ch;
      }
    } catch {
      narrative = interpretation.narrative;
      hooks.onNarrativeToken(narrative);
    }
  } else {
    // LLM 失败,推送本地兜底 narrative
    narrative = localNarrative(ds, insights);
    hooks.onNarrativeToken(narrative);
  }

  /* —— 6. 返回完整结果 —— */
  const usedLLM = interpretation !== null;
  const result: AnalysisResult = {
    provider: usedLLM ? "local+llm" : "local",
    summary: finalSummary,
    insights: finalInsights,
    charts: finalCharts,
    options: finalOptions,
    narrative,
    createdAt,
    evidence: local.evidence,
    computedInsights: insights,
    warnings,
    version: "v0.2",
  };
  emitFinal(hooks, result);
  return result;
}

/** 把文本按 chunkSize 字符切块(用于模拟流式推送) */
function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}
