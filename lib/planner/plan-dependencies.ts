/**
 * lib/planner/plan-dependencies.ts
 *
 * 任务依赖 DAG：环检测 + 拓扑排序（SPEC 12.7 规则 4 / 14.3）。
 */
import type { AnalysisTask } from "@/lib/types";

/** 检测依赖环；存在则返回环上的任务 id 序列，否则 null */
export function detectCycle(tasks: AnalysisTask[]): string[] | null {
  const map = new Map(tasks.map((t) => [t.id, t]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const t of tasks) color.set(t.id, WHITE);
  let cyclePath: string[] | null = null;
  const stack: string[] = [];

  const dfs = (id: string): boolean => {
    color.set(id, GRAY);
    stack.push(id);
    const t = map.get(id);
    if (t) {
      for (const d of t.dependsOn) {
        if (!map.has(d)) continue; // 未知依赖由校验单独报
        const c = color.get(d);
        if (c === GRAY) {
          const idx = stack.indexOf(d);
          cyclePath = [...stack.slice(idx), d];
          return true;
        }
        if (c === WHITE && dfs(d)) return true;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return false;
  };

  for (const t of tasks) {
    if (color.get(t.id) === WHITE && dfs(t.id)) break;
  }
  return cyclePath;
}

/** 拓扑排序（依赖在前）；有环时返回原始顺序 + cycle */
export function topologicalSort(tasks: AnalysisTask[]): {
  order: string[];
  cycle: string[] | null;
} {
  const cycle = detectCycle(tasks);
  if (cycle) return { order: tasks.map((t) => t.id), cycle };
  const map = new Map(tasks.map((t) => [t.id, t]));
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const t = map.get(id);
    if (t) {
      for (const d of t.dependsOn) if (map.has(d)) visit(d);
    }
    order.push(id);
  };
  for (const t of tasks) visit(t.id);
  return { order, cycle: null };
}
