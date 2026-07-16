/**
 * lib/reviewer/apply-review-patch.ts
 *
 * 把终审的 planPatch 应用到计划（SPEC 15.4 / 16）。
 *
 * - removeTasks / updateTasks / addTasks（去重 id，清理对已删任务的依赖）；
 * - dashboardChanges（removeItems / updateItems / reorderItems / sectionChanges）；
 * - understandingPatch 不在此处应用（由 orchestrator 应用到 understanding）。
 *
 * 纯函数，返回新 plan（不改原对象）。
 */
import type { AnalysisPlan, AnalysisPlanPatch } from "@/lib/types";

export function applyReviewPatch(
  plan: AnalysisPlan,
  patch: AnalysisPlanPatch,
): AnalysisPlan {
  let tasks = plan.tasks.map((task) => ({
    ...task,
    dimensions: [...task.dimensions],
    metrics: [...task.metrics],
    filters: task.filters.map((filter) => ({ ...filter })),
    dependsOn: [...task.dependsOn],
  }));

  // 1. 删除任务 + 清理依赖
  if (patch.removeTasks.length > 0) {
    const rm = new Set(patch.removeTasks);
    tasks = tasks
      .filter((t) => !rm.has(t.id))
      .map((t) => ({
        ...t,
        dependsOn: t.dependsOn.filter((d) => !rm.has(d)),
      }));
  }

  // 2. 更新任务
  if (patch.updateTasks.length > 0) {
    const upd = new Map(patch.updateTasks.map((u) => [u.taskId, u.changes]));
    tasks = tasks.map((t) =>
      upd.has(t.id) ? { ...t, ...upd.get(t.id) } : t,
    );
  }

  // 3. 新增任务（去重 id）
  if (patch.addTasks.length > 0) {
    const exist = new Set(tasks.map((t) => t.id));
    for (const t of patch.addTasks) {
      if (!exist.has(t.id)) {
        tasks.push(t);
        exist.add(t.id);
      }
    }
  }

  // 4. dashboard 变更
  let items = plan.dashboard.items.map((item) => ({ ...item }));
  const dc = patch.dashboardChanges;
  if (dc.removeItems.length > 0) {
    const rm = new Set(dc.removeItems);
    items = items.filter((i) => !rm.has(i.id));
  }
  if (dc.updateItems.length > 0) {
    const upd = new Map(dc.updateItems.map((u) => [u.itemId, u.changes]));
    items = items.map((i) => (upd.has(i.id) ? { ...i, ...upd.get(i.id) } : i));
  }
  if (dc.reorderItems && dc.reorderItems.length > 0) {
    const order = new Map(dc.reorderItems.map((id, i) => [id, i]));
    items = [...items].sort(
      (a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999),
    );
  }

  return {
    ...plan,
    tasks,
    dashboard: {
      items,
      sections: dc.sectionChanges ?? plan.dashboard.sections,
    },
  };
}
