import type { AnalysisPlan, AnalysisPlanPatch } from "@/lib/types";

export interface PatchImpact {
  presentationOnly: boolean;
  requiresPlanRebuild: boolean;
  affectedTaskIds: string[];
  reusedTaskIds: string[];
  reasons: string[];
}

function descendants(plan: AnalysisPlan, seeds: Set<string>): Set<string> {
  const affected = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of plan.tasks) {
      if (!affected.has(task.id) && task.dependsOn.some((id) => affected.has(id))) {
        affected.add(task.id);
        changed = true;
      }
    }
  }
  return affected;
}

export function analyzePatchImpact(
  basePlan: AnalysisPlan,
  nextPlan: AnalysisPlan,
  patch: AnalysisPlanPatch,
): PatchImpact {
  const seeds = new Set<string>();
  const reasons: string[] = [];
  for (const update of patch.updateTasks) seeds.add(update.taskId);
  for (const task of patch.addTasks) seeds.add(task.id);
  const removedIds = new Set(patch.removeTasks);
  for (const task of basePlan.tasks) {
    if (
      nextPlan.tasks.some((candidate) => candidate.id === task.id) &&
      task.dependsOn.some((dependency) => removedIds.has(dependency))
    ) {
      seeds.add(task.id);
    }
  }
  if (patch.updateTasks.length > 0) reasons.push("任务参数发生变化");
  if (patch.addTasks.length > 0) reasons.push("新增分析任务");
  if (patch.removeTasks.length > 0) reasons.push("删除分析任务");

  const requiresPlanRebuild = Boolean(
    patch.understandingPatch?.datasetKind ||
      patch.understandingPatch?.tableShape ||
      patch.understandingPatch?.businessDescription !== undefined ||
      patch.understandingPatch?.grainDescription !== undefined ||
      patch.understandingPatch?.rowMeaning !== undefined ||
      patch.understandingPatch?.selectedSheets,
  );
  const understandingPatch = patch.understandingPatch;
  if (understandingPatch) {
    if (requiresPlanRebuild) {
      nextPlan.tasks.forEach((task) => seeds.add(task.id));
      reasons.push("数据集类型、表格粒度或 Sheet 发生变化，需要重建计划");
    }
    const fields = new Set((understandingPatch.fields ?? []).map((change) => change.field));
    for (const task of nextPlan.tasks) {
      const refs = [
        ...task.dimensions,
        ...task.metrics,
        ...task.filters.map((filter) => filter.field),
        ...(task.time ? [task.time.field] : []),
      ];
      if (refs.some((field) => fields.has(field))) seeds.add(task.id);
    }
    if (
      (understandingPatch.relationshipsToAdd?.length ?? 0) > 0 ||
      (understandingPatch.relationshipsToRemove?.length ?? 0) > 0 ||
      (understandingPatch.derivedMetricsToAdd?.length ?? 0) > 0 ||
      (understandingPatch.derivedMetricsToRemove?.length ?? 0) > 0
    ) {
      for (const task of nextPlan.tasks) seeds.add(task.id);
    }
    reasons.push("字段语义或关系发生变化");
  }

  const affected = descendants(nextPlan, seeds);
  const nextIds = new Set(nextPlan.tasks.map((task) => task.id));
  const removed = new Set(basePlan.tasks.map((task) => task.id).filter((id) => !nextIds.has(id)));
  for (const id of removed) affected.delete(id);
  const reused = nextPlan.tasks
    .map((task) => task.id)
    .filter((id) => !affected.has(id));
  const presentationOnly = affected.size === 0 && !understandingPatch;
  if (presentationOnly) reasons.push("仅展示层变化，无需重算");

  return {
    presentationOnly,
    requiresPlanRebuild,
    affectedTaskIds: [...affected],
    reusedTaskIds: reused,
    reasons,
  };
}
