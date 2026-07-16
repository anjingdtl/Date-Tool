/**
 * lib/executor/registry.ts
 *
 * 确定性工具注册表（SPEC 13.2 / 14.3）。
 *
 * - 所有分析任务从注册表分派，不得绕过直接操作数据（SPEC 4.2）；
 * - dispatch 算 inputHash（dataset rows + understanding + 任务规范 + executor 版本），
 *   命中缓存复用，miss 则校验→执行→填 inputHash→写缓存；
 * - 单任务失败返回 failed 结果，不抛错（由上层决定是否中止）。
 */
import type {
  AnalysisOperator,
  AnalysisTask,
  TaskExecutionResult,
  ToolDefinition,
  ToolExecutionContext,
} from "@/lib/types";
import { hashTaskInput, sha256 } from "./result-hash";
import { computeRowsHash } from "../semantic/build-data-context";
import { getCachedTaskResult, setCachedTaskResult } from "./task-cache";

import { profileTool } from "./operators/profile";
import { aggregateTool } from "./operators/aggregate";
import { timeseriesTool } from "./operators/timeseries";
import { compareTool } from "./operators/compare";
import { distributionTool } from "./operators/distribution";
import { rankingTool } from "./operators/ranking";
import { ratioTool } from "./operators/ratio";
import { growthTool } from "./operators/growth";
import { anomalyTool } from "./operators/anomaly";

/** 执行器版本（缓存键一部分，升级执行逻辑时缓存自动失效） */
export const EXECUTOR_VERSION = "v0.3.0-1";

const tools = new Map<AnalysisOperator, ToolDefinition>();

function register(def: ToolDefinition): void {
  tools.set(def.operator, def);
}

register(profileTool);
register(aggregateTool);
register(timeseriesTool);
register(compareTool);
register(distributionTool);
register(rankingTool);
register(ratioTool);
register(growthTool);
register(anomalyTool);
// correlation / pivot 在阶段 6 注册

/** 取操作符定义；不存在返回 null */
export function getTool(operator: AnalysisOperator): ToolDefinition | null {
  return tools.get(operator) ?? null;
}

/** 已注册的全部操作符 */
export function listOperators(): AnalysisOperator[] {
  return [...tools.keys()];
}

/** understanding 摘要哈希（id/status/字段语义，业务语义变化则缓存失效） */
function hashUnderstanding(u: ToolExecutionContext["understanding"]): string {
  return sha256(
    JSON.stringify({
      id: u.id,
      status: u.status,
      fields: u.fields.map((f) => `${f.field}|${f.role}|${f.measureBehavior}`),
      relationships: u.relationships.map((r) => `${r.id}|${r.relation}`),
    }),
  );
}

function failedResult(task: AnalysisTask, message: string): TaskExecutionResult {
  return {
    taskId: task.id,
    operator: task.operator,
    status: "failed",
    columns: [],
    rows: [],
    summary: { rowCount: 0, nullCount: 0, truncated: false },
    warnings: [message],
    evidence: [],
    inputHash: "",
    resultHash: "",
    durationMs: 0,
  };
}

/** 校验任务（暴露给 planner 在执行前预检） */
export function validateTask(
  task: AnalysisTask,
  context: ToolExecutionContext,
): { ok: boolean; message: string } {
  const tool = getTool(task.operator);
  if (!tool) return { ok: false, message: `未知操作符 ${task.operator}` };
  const v = tool.validate(task, context);
  if (v.ok) return { ok: true, message: "" };
  return {
    ok: false,
    message: v.issues
      .filter((i) => i.level === "error")
      .map((i) => i.message)
      .join("; "),
  };
}

/**
 * 分派并执行单个任务（含缓存）。
 *
 * @returns TaskExecutionResult（status 含 success/partial/skipped/failed）
 */
export async function dispatchTask(
  task: AnalysisTask,
  context: ToolExecutionContext,
): Promise<TaskExecutionResult> {
  const tool = getTool(task.operator);
  if (!tool) {
    return failedResult(task, `未知操作符 ${task.operator}`);
  }

  const rowsHash = computeRowsHash(
    context.dataset.rows,
    context.dataset.columns,
  );
  const understandingHash = hashUnderstanding(context.understanding);
  const inputHash = hashTaskInput({
    task,
    rowsHash,
    understandingHash,
    executorVersion: EXECUTOR_VERSION,
  });

  const cached = getCachedTaskResult(inputHash);
  if (cached) {
    return cached;
  }

  const v = tool.validate(task, context);
  if (!v.ok) {
    const msg = v.issues
      .filter((i) => i.level === "error")
      .map((i) => i.message)
      .join("; ");
    const res = failedResult(task, `任务校验失败：${msg}`);
    res.inputHash = inputHash;
    return res;
  }

  let result: TaskExecutionResult;
  try {
    result = await tool.execute(task, context);
  } catch (err) {
    result = failedResult(
      task,
      err instanceof Error ? err.message : "任务执行异常",
    );
  }

  // 填充 inputHash（result 与 evidence）
  result.inputHash = inputHash;
  for (const ev of result.evidence) {
    ev.inputHash = inputHash;
  }
  setCachedTaskResult(inputHash, result);
  return result;
}
