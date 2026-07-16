/**
 * lib/reviewer/review-execution.ts
 *
 * 终审执行（SPEC 15）：调 LLM → LLMAnalysisReviewSchema → validateReview → 补 createdAt。
 *
 * 失败降级（SPEC 21.5）：LLM 未启用 / 调用失败 / Schema 或引用校验失败 →
 * 返回 ok=false，调用方用确定性结果 + 本地模板 narrative + reviewStatus=unavailable。
 */
import { chatJSON } from "@/lib/llm";
import { getActiveLLMConfig } from "@/lib/llm-config";
import { logger } from "@/lib/logger";
import { validateLLMAnalysisReview } from "@/lib/schemas/analysis-review";
import type { AnalysisReview } from "@/lib/types";
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewInput,
  type ReviewInput,
} from "./review-prompt";
import { validateReview } from "./validate-review";

export interface ReviewExecutionInput extends ReviewInput {
  requestId: string;
}

export interface ReviewExecutionResult {
  ok: boolean;
  review: AnalysisReview | null;
  error?: string;
}

export async function reviewExecution(
  input: ReviewExecutionInput,
): Promise<ReviewExecutionResult> {
  const llmConfig = await getActiveLLMConfig();
  if (!llmConfig.enabled) {
    return { ok: false, review: null, error: "LLM 未启用，终审不可用" };
  }

  const userPrompt = buildReviewInput(input);
  let raw: unknown;
  try {
    raw = await chatJSON(REVIEW_SYSTEM_PROMPT, userPrompt, input.requestId);
  } catch (err) {
    return {
      ok: false,
      review: null,
      error: err instanceof Error ? err.message : "LLM 调用失败",
    };
  }

  const parsed = validateLLMAnalysisReview(raw);
  if (!parsed.ok) {
    logger.warn("review_schema_failed", {
      requestId: input.requestId,
      error: parsed.error,
    });
    return { ok: false, review: null, error: parsed.error };
  }

  // LLMAnalysisReviewParsed 的 planPatch 来自 Zod（TaskFilter.value 推断 optional），
  // 与接口仅类型标记差异，运行时结构一致，断言为 AnalysisReview。
  const review = {
    ...parsed.data,
    createdAt: new Date().toISOString(),
  } as AnalysisReview;

  // Evidence / 任务 / 图表引用校验
  const v = validateReview(review, {
    plan: input.plan,
    execution: input.execution,
  });
  if (!v.ok) {
    logger.warn("review_validation_failed", {
      requestId: input.requestId,
      issues: v.issues.map((i) => i.message),
    });
    // 引用错误（编造 Evidence）→ 终审不可信，降级
    return {
      ok: false,
      review,
      error: v.issues
        .filter((i) => i.level === "error")
        .map((i) => i.message)
        .join("; "),
    };
  }

  logger.info("review_completed", {
    requestId: input.requestId,
    status: review.status,
    findings: review.findings.length,
  });
  return { ok: true, review };
}
