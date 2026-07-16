import { describe, it, expect } from "vitest";
import {
  AnalysisPlanPatchSchema,
  validateAnalysisPlanPatch,
  type AnalysisPlanPatchParsed,
} from "@/lib/schemas/plan-patch";

function validPatch(): AnalysisPlanPatchParsed {
  return {
    version: "v1",
    baseRevisionId: "rev_1",
    intentSummary: "只看南宁市，删除收入饼图",
    removeTasks: ["t_pie"],
    updateTasks: [],
    addTasks: [],
    dashboardChanges: { removeItems: ["c_pie"], updateItems: [] },
    userHardConstraints: ["只统计南宁市数据"],
    explanation: "为相关任务增加 地市=南宁 筛选，并移除收入饼图。",
  };
}

describe("AnalysisPlanPatchSchema - SPEC 16.2", () => {
  it("合法 patch 通过", () => {
    expect(AnalysisPlanPatchSchema.safeParse(validPatch()).success).toBe(true);
  });

  it("拒绝空 baseRevisionId（防 stale revision）", () => {
    const p = validPatch();
    p.baseRevisionId = "";
    expect(AnalysisPlanPatchSchema.safeParse(p).success).toBe(false);
  });

  it("拒绝空 intentSummary", () => {
    const p = validPatch();
    p.intentSummary = "";
    expect(AnalysisPlanPatchSchema.safeParse(p).success).toBe(false);
  });

  it("接受含 updateTasks 的 patch", () => {
    const p = validPatch();
    p.updateTasks = [
      {
        taskId: "t1",
        changes: { aggregation: "avg", filters: [{ field: "地市", operator: "eq", value: "南宁" }] },
      },
    ];
    expect(AnalysisPlanPatchSchema.safeParse(p).success).toBe(true);
  });

  it("接受含 addTasks 的 patch（任务结构必须合法）", () => {
    const p = validPatch();
    p.addTasks = [
      {
        id: "t_new",
        operator: "aggregate",
        title: "南宁区县完成率",
        purpose: "评估南宁各区县目标完成情况",
        dimensions: ["区县"],
        metrics: ["收入完成率"],
        filters: [],
        aggregation: "avg",
        dependsOn: [],
        expectedOutput: "category_table",
        priority: 2,
      },
    ];
    expect(AnalysisPlanPatchSchema.safeParse(p).success).toBe(true);
  });

  it("拒绝 addTasks 内非法任务结构", () => {
    const p = validPatch();
    // 故意塞入非法 operator，校验 schema 是否拒绝
    (p as { addTasks: unknown[] }).addTasks = [
      {
        id: "t_bad",
        operator: "sql_query",
        title: "x",
        purpose: "x",
        dimensions: [],
        metrics: [],
        filters: [],
        dependsOn: [],
        expectedOutput: "scalar",
        priority: 1,
      },
    ];
    expect(AnalysisPlanPatchSchema.safeParse(p).success).toBe(false);
  });

  it("接受含 understandingPatch 的 patch", () => {
    const p = validPatch();
    p.understandingPatch = {
      fields: [{ field: "用户数", changes: { measureBehavior: "stock" } }],
    };
    expect(AnalysisPlanPatchSchema.safeParse(p).success).toBe(true);
  });

  it("拒绝 understandingPatch 内非法 measureBehavior", () => {
    const p = validPatch();
    p.understandingPatch = {
      fields: [{ field: "用户数", changes: { measureBehavior: "cumulative" as never } }],
    };
    expect(AnalysisPlanPatchSchema.safeParse(p).success).toBe(false);
  });

  it("接受 dashboardChanges.reorderItems", () => {
    const p = validPatch();
    p.dashboardChanges = {
      removeItems: [],
      updateItems: [],
      reorderItems: ["c2", "c1"],
    };
    expect(AnalysisPlanPatchSchema.safeParse(p).success).toBe(true);
  });

  it("validateAnalysisPlanPatch 返回 ok/error", () => {
    expect(validateAnalysisPlanPatch(validPatch()).ok).toBe(true);
    expect(validateAnalysisPlanPatch({}).ok).toBe(false);
  });
});
