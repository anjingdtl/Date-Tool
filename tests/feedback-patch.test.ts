import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({ chatJSON: vi.fn() }));
vi.mock("@/lib/llm-config", () => ({ getActiveLLMConfig: vi.fn() }));

import { chatJSON } from "@/lib/llm";
import { getActiveLLMConfig } from "@/lib/llm-config";
import { interpretUserFeedback } from "@/lib/conversation/interpret-user-feedback";
import { applyPlanPatch } from "@/lib/conversation/apply-plan-patch";
import { makeKpiUnderstanding } from "./executor-fixtures";
import type { AnalysisPlan, AnalysisPlanPatch, AnalysisRevision } from "@/lib/types";

function plan(): AnalysisPlan {
  return {
    version: "v1",
    id: "p1",
    datasetId: "d1",
    understandingId: "u1",
    objectives: [],
    assumptions: [],
    tasks: [{
      id: "t1", operator: "aggregate", title: "收入", purpose: "收入",
      dimensions: ["地市"], metrics: ["业务收入"], filters: [], aggregation: "sum",
      dependsOn: [], expectedOutput: "category_table", priority: 1,
    }],
    dashboard: { items: [{ id: "c1", taskId: "t1", type: "bar", title: "收入", description: "", rationale: "", priority: 1, width: "half", visible: true }], sections: [] },
    questionsForUser: [], createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function patch(): AnalysisPlanPatch {
  return {
    version: "v1", baseRevisionId: "r1", intentSummary: "改标题并修正语义",
    understandingPatch: { fields: [{ field: "业务收入", changes: { businessMeaning: "含税收入" } }] },
    removeTasks: [], updateTasks: [], addTasks: [],
    dashboardChanges: { removeItems: [], updateItems: [{ itemId: "c1", changes: { title: "含税收入" } }] },
    userHardConstraints: [], explanation: "按用户要求修改",
  };
}

function revision(): AnalysisRevision {
  return {
    id: "r1", sessionId: "s1", sequence: 1, status: "approved", source: "initial",
    understandingSnapshot: makeKpiUnderstanding(), plan: plan(), execution: null, review: null,
    finalResult: null, createdAt: "2026-07-16T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.mocked(getActiveLLMConfig).mockResolvedValue({ provider: "x", baseUrl: "x", apiKey: "k", model: "m", enabled: true });
  vi.mocked(chatJSON).mockReset();
});

describe("用户反馈 PlanPatch", () => {
  it("合法 LLM JSON 转为结构化 Patch", async () => {
    vi.mocked(chatJSON).mockResolvedValue(patch());
    const result = await interpretUserFeedback(revision(), "把标题改成含税收入", "req1");
    expect(result.ok).toBe(true);
    expect(result.patch?.baseRevisionId).toBe("r1");
  });

  it("stale baseRevisionId 会进入修复，第二次成功", async () => {
    vi.mocked(chatJSON)
      .mockResolvedValueOnce({ ...patch(), baseRevisionId: "old" })
      .mockResolvedValueOnce(patch());
    const result = await interpretUserFeedback(revision(), "改标题", "req2");
    expect(result.ok).toBe(true);
    expect(chatJSON).toHaveBeenCalledTimes(2);
  });

  it("应用 Patch 不修改原计划，用户字段修正标记 source=user", () => {
    const basePlan = plan();
    const understanding = makeKpiUnderstanding();
    const result = applyPlanPatch(basePlan, understanding, patch());
    expect(basePlan.dashboard.items[0].title).toBe("收入");
    expect(result.plan.dashboard.items[0].title).toBe("含税收入");
    expect(result.understanding.fields.find((field) => field.field === "业务收入")?.source).toBe("user");
  });

  it("不存在的任务/图表目标被拒绝", () => {
    const bad = patch();
    bad.updateTasks = [{ taskId: "ghost", changes: { limit: 3 } }];
    expect(() => applyPlanPatch(plan(), makeKpiUnderstanding(), bad)).toThrow(/不存在/);
  });
});
