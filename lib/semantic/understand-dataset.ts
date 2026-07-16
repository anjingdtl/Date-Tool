/**
 * lib/semantic/understand-dataset.ts
 *
 * LLM 数据理解服务（SPEC 10）。
 *
 * 流程：
 * 1. buildDataContext 构建客观数据上下文；
 * 2. LLM 未启用 → 返回 fallback，不产生伪 understanding（SPEC 21.1）；
 * 3. chatJSON 调用 + Zod 校验 + 最多 2 次 JSON 修复（SPEC 4.2）；
 * 4. blocking ambiguity → status=needs_user_input，否则 ready_for_confirmation；
 * 5. LLM 调用或校验失败 → status=failed，understanding=null。
 *
 * 单元格提示注入不会改变 System 约束（System Prompt 固定 + 数据仅作 user 输入）。
 */
import { chatJSON } from "@/lib/llm";
import { getActiveLLMConfig } from "@/lib/llm-config";
import { logger } from "@/lib/logger";
import { readSettings } from "@/lib/settings";
import {
  validateLLMUnderstanding,
  type LLMUnderstandingParsed,
} from "@/lib/schemas/understanding";
import type {
  DataContext,
  DatasetUnderstanding,
  StoredDataset,
  UnderstandingStatus,
} from "@/lib/types";
import { buildDataContext } from "./build-data-context";
import {
  UNDERSTANDING_SYSTEM_PROMPT,
  buildUnderstandingInput,
} from "./understanding-prompt";

const MAX_REPAIR_ATTEMPTS = 2;

export interface UnderstandOptions {
  userDescription?: string;
  force?: boolean;
}

export interface UnderstandResult {
  status: UnderstandingStatus;
  understanding: DatasetUnderstanding | null;
  context: DataContext;
  error?: string;
}

function hasBlockingAmbiguity(
  u: Pick<DatasetUnderstanding, "ambiguities">,
): boolean {
  return u.ambiguities.some((a) => a.blocking);
}

function newUnderstandingId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `und_${rand}`;
}

/**
 * 调用 LLM 并在 Schema 校验失败时最多修复 2 次。
 * 网络/超时错误不修复（直接失败）。
 */
async function callLLMWithRepair(
  baseUserPrompt: string,
  requestId: string,
): Promise<{ ok: true; data: LLMUnderstandingParsed } | { ok: false; error: string }> {
  let currentUser = baseUserPrompt;
  let lastError = "未知错误";
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    let raw: unknown;
    try {
      raw = await chatJSON(UNDERSTANDING_SYSTEM_PROMPT, currentUser, requestId);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "LLM 调用失败",
      };
    }
    const valid = validateLLMUnderstanding(raw);
    if (valid.ok) {
      return { ok: true, data: valid.data };
    }
    lastError = valid.error;
    logger.warn("understanding_validation_failed", {
      requestId,
      attempt,
      error: lastError,
    });
    currentUser =
      baseUserPrompt +
      `\n\n【上次输出校验失败，错误：${lastError}】请严格按 Schema 修正后重新输出一个 JSON 对象，不要解释。`;
  }
  return { ok: false, error: lastError };
}

/**
 * 理解数据集。
 *
 * @returns status: fallback（未启用 LLM）/ failed（调用或校验失败）/
 *                 needs_user_input（存在 blocking ambiguity）/ ready_for_confirmation
 */
export async function understandDataset(
  ds: StoredDataset,
  requestId: string,
  options: UnderstandOptions = {},
): Promise<UnderstandResult> {
  const settings = await readSettings();
  const context = buildDataContext(ds, {
    userDescription: options.userDescription,
    sendRowSamples: settings.privacy.sendRowSamples,
  });
  logger.info("data_context_built", {
    requestId,
    datasetId: ds.id,
    rowCount: context.rowCount,
    storedRowCount: context.storedRowCount,
    truncated: context.tokenBudget.truncated,
  });

  const llmConfig = await getActiveLLMConfig();
  if (!llmConfig.enabled) {
    // SPEC 21.1 / 19.3：LLM 不可用走本地降级，不伪造 understanding
    return { status: "fallback", understanding: null, context };
  }

  logger.info("understanding_started", { requestId, datasetId: ds.id });

  const userPrompt = buildUnderstandingInput(context);
  const result = await callLLMWithRepair(userPrompt, requestId);

  if (!result.ok) {
    logger.warn("understanding_failed", {
      requestId,
      datasetId: ds.id,
      error: result.error,
    });
    return {
      status: "failed",
      understanding: null,
      context,
      error: result.error,
    };
  }

  const blocking = hasBlockingAmbiguity(result.data);
  const understanding: DatasetUnderstanding = {
    ...result.data,
    id: newUnderstandingId(),
    datasetId: ds.id,
    selectedSheets:
      result.data.selectedSheets.length > 0
        ? result.data.selectedSheets
        : context.workbook.selectedSheetNames,
    createdAt: new Date().toISOString(),
    status: blocking ? "needs_user_input" : "ready_for_confirmation",
  };

  logger.info("understanding_completed", {
    requestId,
    datasetId: ds.id,
    status: understanding.status,
    fieldCount: understanding.fields.length,
    ambiguityCount: understanding.ambiguities.length,
  });

  return { status: understanding.status, understanding, context };
}
