import { applyReviewPatch } from "@/lib/reviewer/apply-review-patch";
import { applyFieldUnderstandingChanges } from "@/lib/semantic/apply-understanding";
import type {
  AnalysisPlan,
  AnalysisPlanPatch,
  DatasetUnderstanding,
} from "@/lib/types";

function assertKnownTargets(plan: AnalysisPlan, understanding: DatasetUnderstanding, patch: AnalysisPlanPatch): void {
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  const itemIds = new Set(plan.dashboard.items.map((item) => item.id));
  const fieldNames = new Set(understanding.fields.map((field) => field.field));

  for (const id of patch.removeTasks) {
    if (!taskIds.has(id)) throw new Error(`待删除任务不存在：${id}`);
  }
  for (const update of patch.updateTasks) {
    if (!taskIds.has(update.taskId)) throw new Error(`待更新任务不存在：${update.taskId}`);
  }
  for (const task of patch.addTasks) {
    if (taskIds.has(task.id)) throw new Error(`新增任务 ID 已存在：${task.id}`);
    taskIds.add(task.id);
  }
  for (const id of patch.dashboardChanges.removeItems) {
    if (!itemIds.has(id)) throw new Error(`待删除图表不存在：${id}`);
  }
  for (const update of patch.dashboardChanges.updateItems) {
    if (!itemIds.has(update.itemId)) throw new Error(`待更新图表不存在：${update.itemId}`);
  }
  for (const change of patch.understandingPatch?.fields ?? []) {
    if (!fieldNames.has(change.field)) throw new Error(`待修正字段不存在：${change.field}`);
    if ("field" in change.changes) throw new Error("字段修正不得重命名物理字段");
  }
}

export function applyPlanPatch(
  plan: AnalysisPlan,
  understanding: DatasetUnderstanding,
  patch: AnalysisPlanPatch,
): { plan: AnalysisPlan; understanding: DatasetUnderstanding } {
  assertKnownTargets(plan, understanding, patch);
  const nextPlan = applyReviewPatch(plan, patch);
  const up = patch.understandingPatch;
  if (!up) return { plan: nextPlan, understanding };

  let nextUnderstanding = applyFieldUnderstandingChanges(
    understanding,
    up.fields ?? [],
  );
  const removedRelations = new Set(up.relationshipsToRemove ?? []);
  const relationMap = new Map(
    nextUnderstanding.relationships
      .filter((relationship) => !removedRelations.has(relationship.id))
      .map((relationship) => [relationship.id, relationship]),
  );
  for (const relationship of up.relationshipsToAdd ?? []) {
    relationMap.set(relationship.id, relationship);
  }
  const removedMetrics = new Set(up.derivedMetricsToRemove ?? []);
  const metricMap = new Map(
    nextUnderstanding.derivedMetrics
      .filter((metric) => !removedMetrics.has(metric.id))
      .map((metric) => [metric.id, metric]),
  );
  for (const metric of up.derivedMetricsToAdd ?? []) metricMap.set(metric.id, metric);
  nextUnderstanding = {
    ...nextUnderstanding,
    relationships: [...relationMap.values()],
    derivedMetrics: [...metricMap.values()],
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
  };
  return { plan: nextPlan, understanding: nextUnderstanding };
}
