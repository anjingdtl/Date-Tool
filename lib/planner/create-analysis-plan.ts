/**
 * lib/planner/create-analysis-plan.ts
 *
 * 制订分析计划（SPEC 12 / 14.2）：
 * 1. LLM 未启用 → 失败（调用方走本地降级）；
 * 2. chatJSON + LLMAnalysisPlanSchema 校验 + 补全服务端字段；
 * 3. validateAnalysisPlan（20 规则）+ 默认任务上限 16；
 * 4. 校验失败用 buildRepairPrompt 反馈，最多修复 2 次。
 */
import { chatJSON } from "@/lib/llm";
import { getActiveLLMConfig } from "@/lib/llm-config";
import { logger } from "@/lib/logger";
import { validateLLMAnalysisPlan } from "@/lib/schemas/analysis-plan";
import type {
  AnalysisPlan,
  DatasetUnderstanding,
  StoredDataset,
} from "@/lib/types";
import { PLANNING_SYSTEM_PROMPT, buildPlanningInput } from "./planning-prompt";
import {
  validateAnalysisPlan,
  type PlanValidationContext,
  type PlanValidationIssue,
} from "./validate-analysis-plan";
import { buildRepairPrompt } from "./repair-analysis-plan";

const MAX_PLAN_REPAIR = 2;
const MAX_TASKS_DEFAULT = 16;

export interface CreatePlanOptions {
  userGoal?: string;
  userHardConstraints?: string[];
}

export interface CreatePlanResult {
  ok: boolean;
  plan: AnalysisPlan | null;
  issues: PlanValidationIssue[];
  attempts: number;
  error?: string;
}

function newPlanId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `plan_${rand}`;
}

export async function createAnalysisPlan(
  understanding: DatasetUnderstanding,
  dataset: StoredDataset,
  requestId: string,
  options: CreatePlanOptions = {},
): Promise<CreatePlanResult> {
  const llmConfig = await getActiveLLMConfig();
  if (!llmConfig.enabled) {
    return {
      ok: false,
      plan: null,
      issues: [],
      attempts: 0,
      error: "LLM 未启用，无法制订计划",
    };
  }

  const baseInput = buildPlanningInput(
    understanding,
    dataset,
    options.userGoal,
    options.userHardConstraints,
  );
  logger.info("plan_started", {
    requestId,
    datasetId: dataset.id,
    understandingId: understanding.id,
  });
  const ctx: PlanValidationContext = {
    dataset,
    understanding,
    userHardConstraints: options.userHardConstraints,
  };

  let currentUser = baseInput;
  let lastIssues: PlanValidationIssue[] = [];
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_PLAN_REPAIR; attempt++) {
    let raw: unknown;
    try {
      raw = await chatJSON(PLANNING_SYSTEM_PROMPT, currentUser, requestId);
    } catch (err) {
      return {
        ok: false,
        plan: null,
        issues: lastIssues,
        attempts: attempt,
        error: err instanceof Error ? err.message : "LLM 调用失败",
      };
    }

    const parsed = validateLLMAnalysisPlan(raw);
    if (!parsed.ok) {
      lastError = `Schema 校验失败：${parsed.error}`;
      lastIssues = [
        { code: "SCHEMA_INVALID", message: parsed.error, level: "error" },
      ];
      logger.warn("plan_schema_failed", {
        requestId,
        attempt,
        error: parsed.error,
      });
      currentUser =
        baseInput +
        `\n\n【上次输出 JSON 结构不合法】\n${parsed.error}\n请严格按 Schema 输出 JSON 对象。`;
      continue;
    }

    // 注：Zod z.unknown() 将 TaskFilter.value 推断为 optional，与接口 required 仅类型标记差异，
    // 运行时结构一致（LLM 输出含 value），此处断言为 AnalysisPlan。
    const plan = {
      ...parsed.data,
      id: newPlanId(),
      datasetId: dataset.id,
      understandingId: understanding.id,
      createdAt: new Date().toISOString(),
    } as AnalysisPlan;

    const tooMany = plan.tasks.length > MAX_TASKS_DEFAULT;
    const validation = validateAnalysisPlan(plan, ctx);
    if (validation.ok && !tooMany) {
      logger.info("plan_generated", {
        requestId,
        datasetId: dataset.id,
        attempt,
        taskCount: plan.tasks.length,
      });
      if (attempt > 0) {
        logger.info("plan_repaired", {
          requestId,
          datasetId: dataset.id,
          attempt,
        });
      }
      return { ok: true, plan, issues: validation.issues, attempts: attempt };
    }

    lastIssues = tooMany
      ? [
          ...validation.issues,
          {
            code: "TOO_MANY_TASKS_DEFAULT",
            message: `任务数 ${plan.tasks.length} 超过默认上限 ${MAX_TASKS_DEFAULT}`,
            level: "error",
          },
        ]
      : validation.issues;
    lastError = lastIssues.map((i) => i.message).join("; ");
    logger.warn("plan_validation_failed", {
      requestId,
      attempt,
      error: lastError,
    });
    currentUser = buildRepairPrompt(baseInput, lastIssues);
  }

  return {
    ok: false,
    plan: null,
    issues: lastIssues,
    attempts: MAX_PLAN_REPAIR + 1,
    error: `计划校验 ${MAX_PLAN_REPAIR + 1} 次未通过：${lastError}`,
  };
}
