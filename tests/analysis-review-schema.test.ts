import { describe, it, expect } from "vitest";
import {
  AnalysisReviewSchema,
  validateAnalysisReview,
  type AnalysisReviewParsed,
} from "@/lib/schemas/analysis-review";

function validReview(): AnalysisReviewParsed {
  return {
    version: "v1",
    status: "approved",
    executiveSummary: "分析完成，收入整体达标。",
    narrative: "本月收入环比上升，南宁完成率偏低。",
    findings: [
      {
        id: "f1",
        level: "positive",
        title: "收入增长",
        statement: "业务收入环比上升 8%。",
        evidenceIds: ["e1"],
        taskIds: ["t1"],
      },
    ],
    chartDecisions: [{ itemId: "c1", action: "keep", reason: "保留收入对比图" }],
    questionsForUser: [],
    assumptions: ["假设目标值已按月确认"],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("AnalysisReviewSchema - SPEC 15.3", () => {
  it("合法 review 通过", () => {
    expect(AnalysisReviewSchema.safeParse(validReview()).success).toBe(true);
  });

  it("接受 revise / needs_user_input 状态", () => {
    for (const status of ["revise", "needs_user_input"] as const) {
      const r = validReview();
      r.status = status;
      expect(AnalysisReviewSchema.safeParse(r).success).toBe(true);
    }
  });

  it("拒绝非法 status", () => {
    const r = validReview();
    (r as { status: string }).status = "rejected";
    expect(AnalysisReviewSchema.safeParse(r).success).toBe(false);
  });

  it("拒绝 finding 非法 level", () => {
    const r = validReview();
    (r.findings[0] as { level: string }).level = "critical";
    expect(AnalysisReviewSchema.safeParse(r).success).toBe(false);
  });

  it("拒绝空 executiveSummary", () => {
    const r = validReview();
    r.executiveSummary = "";
    expect(AnalysisReviewSchema.safeParse(r).success).toBe(false);
  });

  it("拒绝空 narrative", () => {
    const r = validReview();
    r.narrative = "";
    expect(AnalysisReviewSchema.safeParse(r).success).toBe(false);
  });

  it("拒绝非法 chart action", () => {
    const r = validReview();
    (r.chartDecisions[0] as { action: string }).action = "delete";
    expect(AnalysisReviewSchema.safeParse(r).success).toBe(false);
  });

  it("接受 replace 含 replacement", () => {
    const r = validReview();
    r.chartDecisions = [
      {
        itemId: "c1",
        action: "replace",
        reason: "饼图改柱图",
        replacement: { type: "bar", title: "地市收入" },
      },
    ];
    expect(AnalysisReviewSchema.safeParse(r).success).toBe(true);
  });

  it("接受含 planPatch 的 revise", () => {
    const r = validReview();
    r.status = "revise";
    r.planPatch = {
      version: "v1",
      baseRevisionId: "rev_1",
      intentSummary: "补充完成率任务",
      removeTasks: [],
      updateTasks: [],
      addTasks: [],
      dashboardChanges: { removeItems: [], updateItems: [] },
      userHardConstraints: [],
      explanation: "建议补充目标完成率分析",
    };
    expect(AnalysisReviewSchema.safeParse(r).success).toBe(true);
  });

  it("validateAnalysisReview 返回 ok/error", () => {
    expect(validateAnalysisReview(validReview()).ok).toBe(true);
    expect(validateAnalysisReview(null).ok).toBe(false);
  });
});
