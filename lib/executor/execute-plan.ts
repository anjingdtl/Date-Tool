/**
 * lib/executor/execute-plan.ts
 *
 * 计划执行器（SPEC 14.3）：
 * - 依赖 DAG 拓扑排序（环 → 全部 skipped）；
 * - 按层级并发（默认最大 3，SPEC 14.3）；
 * - 单任务失败不中止全部；依赖失败的任务标记 skipped；
 * - 任务缓存命中复用（统计 cacheHits）。
 */
import type {
  AnalysisPlan,
  AnalysisTask,
  PlanExecutionResult,
  TaskExecutionResult,
  ToolExecutionContext,
} from "@/lib/types";
import { topologicalSort } from "@/lib/planner/plan-dependencies";
import { dispatchTask } from "./registry";
import { getCacheHits } from "./task-cache";

export interface ExecutePlanHooks {
  onTaskStarted?: (task: AnalysisTask) => void;
  onTaskCompleted?: (task: AnalysisTask, result: TaskExecutionResult) => void;
  onTaskFailed?: (task: AnalysisTask, result: TaskExecutionResult) => void;
}

export interface ExecutePlanOptions extends ExecutePlanHooks {
  maxConcurrency?: number;
  /** 增量执行：不在 taskIdsToExecute 中的任务优先复用上一 Revision 结果。 */
  taskIdsToExecute?: Set<string>;
  reuseResults?: Record<string, TaskExecutionResult>;
}

function skippedResult(task: AnalysisTask, reason: string): TaskExecutionResult {
  return {
    taskId: task.id,
    operator: task.operator,
    status: "skipped",
    columns: [],
    rows: [],
    summary: { rowCount: 0, nullCount: 0, truncated: false },
    warnings: [reason],
    evidence: [],
    inputHash: "",
    resultHash: "",
    durationMs: 0,
  };
}

export async function executePlan(
  plan: AnalysisPlan,
  context: ToolExecutionContext,
  options: ExecutePlanOptions = {},
): Promise<PlanExecutionResult> {
  const start = Date.now();
  const maxConc = Math.max(1, options.maxConcurrency ?? 3);
  const { order, cycle } = topologicalSort(plan.tasks);
  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));
  const results: Record<string, TaskExecutionResult> = {};
  const done = new Set<string>();
  const failed = new Set<string>();

  if (cycle) {
    for (const t of plan.tasks) {
      const r = skippedResult(t, `依赖存在环（${cycle.join(" → ")}），无法执行`);
      results[t.id] = r;
      failed.add(t.id);
    }
    return { results, taskOrder: order, cacheHits: 0, durationMs: Date.now() - start };
  }

  const hitsBefore = getCacheHits();
  const requested = options.taskIdsToExecute
    ? new Set(options.taskIdsToExecute)
    : new Set(order);
  for (const id of order) {
    if (requested.has(id)) continue;
    const reused = options.reuseResults?.[id];
    if (!reused) {
      requested.add(id);
      continue;
    }
    results[id] = reused;
    if (reused.status === "success" || reused.status === "partial") done.add(id);
    else failed.add(id);
  }
  context.priorResults = { ...context.priorResults, ...results };
  const pending = new Set(order.filter((id) => requested.has(id)));

  while (pending.size > 0) {
    const ready = [...pending].filter((id) => {
      const t = taskMap.get(id)!;
      return t.dependsOn.every((d) => done.has(d) || failed.has(d));
    });
    if (ready.length === 0) break; // 死锁保护

    const batch = ready.slice(0, maxConc);
    await Promise.all(
      batch.map(async (id) => {
        const t = taskMap.get(id)!;
        const depFailed = t.dependsOn.some((d) => failed.has(d));
        if (depFailed) {
          const r = skippedResult(t, "依赖任务失败或跳过");
          results[id] = r;
          failed.add(id);
          pending.delete(id);
          options.onTaskFailed?.(t, r);
          return;
        }
        options.onTaskStarted?.(t);
        const r = await dispatchTask(t, context);
        results[id] = r;
        if (r.status === "success" || r.status === "partial") done.add(id);
        else failed.add(id);
        pending.delete(id);
        if (r.status === "failed" || r.status === "skipped")
          options.onTaskFailed?.(t, r);
        else options.onTaskCompleted?.(t, r);
      }),
    );
    // 依赖任务在下一批执行时可读取已经完成的上游结果。
    context.priorResults = { ...context.priorResults, ...results };
  }

  // 理论上计划已通过 DAG 校验；若仍因未知依赖等原因无法推进，明确标为 skipped，
  // 避免返回缺少 task result 的不完整执行对象。
  for (const id of pending) {
    const t = taskMap.get(id)!;
    const r = skippedResult(t, "任务依赖无法满足");
    results[id] = r;
    failed.add(id);
    options.onTaskFailed?.(t, r);
  }

  const cacheHits = getCacheHits() - hitsBefore;
  return { results, taskOrder: order, cacheHits, durationMs: Date.now() - start };
}
