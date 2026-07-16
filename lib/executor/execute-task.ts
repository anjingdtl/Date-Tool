/**
 * lib/executor/execute-task.ts
 *
 * 单任务执行入口（SPEC 14.3）。薄包装 registry.dispatchTask，
 * 提供独立可测的执行单元（含缓存、校验、inputHash 填充）。
 */
import type {
  AnalysisTask,
  TaskExecutionResult,
  ToolExecutionContext,
} from "@/lib/types";
import { dispatchTask } from "./registry";

export async function executeTask(
  task: AnalysisTask,
  context: ToolExecutionContext,
): Promise<TaskExecutionResult> {
  return dispatchTask(task, context);
}
