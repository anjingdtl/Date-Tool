import { chatJSON } from "@/lib/llm";
import { getActiveLLMConfig } from "@/lib/llm-config";
import { logger } from "@/lib/logger";
import { validateAnalysisPlanPatch } from "@/lib/schemas/plan-patch";
import type { AnalysisPlanPatch, AnalysisRevision } from "@/lib/types";
import { buildFeedbackInput, FEEDBACK_SYSTEM_PROMPT } from "./feedback-prompt";

const MAX_REPAIR_ATTEMPTS = 2;

export interface InterpretFeedbackResult {
  ok: boolean;
  patch: AnalysisPlanPatch | null;
  attempts: number;
  error?: string;
}

export async function interpretUserFeedback(
  revision: AnalysisRevision,
  message: string,
  requestId: string,
): Promise<InterpretFeedbackResult> {
  const config = await getActiveLLMConfig();
  if (!config.enabled) {
    return { ok: false, patch: null, attempts: 0, error: "LLM 未启用，无法理解自然语言修改" };
  }
  const baseInput = buildFeedbackInput(revision, message);
  let prompt = baseInput;
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    let raw: unknown;
    try {
      raw = await chatJSON(FEEDBACK_SYSTEM_PROMPT, prompt, requestId);
    } catch (err) {
      return {
        ok: false,
        patch: null,
        attempts: attempt,
        error: err instanceof Error ? err.message : "LLM 调用失败",
      };
    }
    const parsed = validateAnalysisPlanPatch(raw);
    if (parsed.ok && parsed.data.baseRevisionId === revision.id) {
      logger.info("feedback_patch_generated", {
        requestId,
        revisionId: revision.id,
        attempt,
      });
      return {
        ok: true,
        patch: parsed.data as AnalysisPlanPatch,
        attempts: attempt,
      };
    }
    lastError = parsed.ok
      ? `baseRevisionId 必须为 ${revision.id}`
      : parsed.error;
    logger.warn("feedback_patch_rejected", {
      requestId,
      revisionId: revision.id,
      attempt,
      error: lastError,
    });
    prompt = `${baseInput}\n\n上次 JSON 不合法：${lastError}\n请修复后只输出 JSON。`;
  }

  return {
    ok: false,
    patch: null,
    attempts: MAX_REPAIR_ATTEMPTS + 1,
    error: `修改要求连续校验失败：${lastError}`,
  };
}
