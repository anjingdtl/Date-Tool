/**
 * lib/planner/repair-analysis-plan.ts
 *
 * 计划修复 Prompt 构造（SPEC 12.7 / 4.2）。
 *
 * 校验失败时把错误反馈给 LLM，要求按 Schema 重新输出（最多 2 次，由调用方控制循环）。
 */
import type { PlanValidationIssue } from "./validate-analysis-plan";

/** 把校验问题格式化为给 LLM 的修复提示 */
export function formatIssues(issues: PlanValidationIssue[]): string {
  if (issues.length === 0) return "(无)";
  return issues
    .map((i) => `[${i.level}]${i.taskId ? `(${i.taskId})` : ""}${i.itemId ? `(${i.itemId})` : ""} ${i.code}: ${i.message}`)
    .join("\n");
}

/** 构造修复轮次的 user prompt（在原输入后追加错误说明） */
export function buildRepairPrompt(
  baseInput: string,
  issues: PlanValidationIssue[],
): string {
  return (
    baseInput +
    `\n\n【上次输出校验失败，必须修正】\n${formatIssues(issues)}\n请严格按 Schema 修正后重新输出一个 JSON 对象，不要解释。`
  );
}
