import { describe, expect, it } from "vitest";
import { analyzePatchImpact } from "@/lib/conversation/impact-analysis";
import { applyReviewPatch } from "@/lib/reviewer/apply-review-patch";
import type { AnalysisPlan, AnalysisPlanPatch, AnalysisTask } from "@/lib/types";

function task(id: string, dependsOn: string[] = []): AnalysisTask {
  return {
    id,
    operator: "aggregate",
    title: id,
    purpose: id,
    dimensions: ["地市"],
    metrics: ["收入"],
    filters: [],
    aggregation: "sum",
    dependsOn,
    expectedOutput: "category_table",
    priority: 1,
  };
}

function plan(): AnalysisPlan {
  return {
    version: "v1",
    id: "p1",
    datasetId: "d1",
    understandingId: "u1",
    objectives: [],
    assumptions: [],
    tasks: [task("t1"), task("t2", ["t1"])],
    dashboard: {
      items: [
        { id: "c1", taskId: "t1", type: "bar", title: "收入", description: "", rationale: "", priority: 1, width: "half", visible: true },
      ],
      sections: [],
    },
    questionsForUser: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function patch(over: Partial<AnalysisPlanPatch> = {}): AnalysisPlanPatch {
  return {
    version: "v1",
    baseRevisionId: "r1",
    intentSummary: "调整",
    removeTasks: [],
    updateTasks: [],
    addTasks: [],
    dashboardChanges: { removeItems: [], updateItems: [] },
    userHardConstraints: [],
    explanation: "",
    ...over,
  };
}

describe("PlanPatch 影响分析", () => {
  it("仅改标题不重算", () => {
    const base = plan();
    const p = patch({
      dashboardChanges: {
        removeItems: [],
        updateItems: [{ itemId: "c1", changes: { title: "新标题" } }],
      },
    });
    const impact = analyzePatchImpact(base, applyReviewPatch(base, p), p);
    expect(impact.presentationOnly).toBe(true);
    expect(impact.affectedTaskIds).toEqual([]);
    expect(impact.reusedTaskIds).toEqual(["t1", "t2"]);
  });

  it("改筛选只重算任务与下游依赖链", () => {
    const base = plan();
    const p = patch({
      updateTasks: [{ taskId: "t1", changes: { filters: [{ field: "地市", operator: "eq", value: "南宁" }] } }],
    });
    const impact = analyzePatchImpact(base, applyReviewPatch(base, p), p);
    expect(new Set(impact.affectedTaskIds)).toEqual(new Set(["t1", "t2"]));
    expect(impact.presentationOnly).toBe(false);
  });

  it("新增任务只执行新增任务", () => {
    const base = plan();
    const p = patch({ addTasks: [task("t3")] });
    const impact = analyzePatchImpact(base, applyReviewPatch(base, p), p);
    expect(impact.affectedTaskIds).toEqual(["t3"]);
    expect(impact.reusedTaskIds).toEqual(["t1", "t2"]);
  });

  it("字段语义修正重算引用该字段的任务和下游", () => {
    const base = plan();
    const p = patch({
      understandingPatch: {
        fields: [{ field: "收入", changes: { measureBehavior: "currency" } }],
      },
    });
    const impact = analyzePatchImpact(base, base, p);
    expect(new Set(impact.affectedTaskIds)).toEqual(new Set(["t1", "t2"]));
  });
});
