/**
 * tests/review-loop.test.ts
 *
 * 阶段 7：reviewExecution 的 mocked LLM 路径 + applyReviewPatch。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  shouldThrow: false,
  response: null as unknown,
}));

vi.mock("@/lib/llm-config", () => ({
  getActiveLLMConfig: vi.fn(async () => ({
    provider: "test",
    baseUrl: "https://example.com/v1",
    apiKey: state.enabled ? "test-key" : "",
    model: "test-model",
    enabled: state.enabled,
  })),
}));
vi.mock("@/lib/llm", () => ({
  chatJSON: vi.fn(async () => {
    if (state.shouldThrow) throw new Error("LLM 超时");
    return state.response;
  }),
  streamChat: vi.fn(),
}));

import { reviewExecution } from "@/lib/reviewer/review-execution";
import { applyReviewPatch } from "@/lib/reviewer/apply-review-patch";
import type {
  AnalysisPlan,
  AnalysisPlanPatch,
  AnalysisTask,
  PlanExecutionResult,
  TaskExecutionResult,
} from "@/lib/types";
import { makeKpiUnderstanding } from "./executor-fixtures";

function task(over: Partial<AnalysisTask>): AnalysisTask {
  return {
    id: "t1",
    operator: "aggregate",
    title: "t",
    purpose: "p",
    dimensions: ["地市"],
    metrics: ["业务收入"],
    filters: [],
    aggregation: "sum",
    dependsOn: [],
    expectedOutput: "category_table",
    priority: 1,
    ...over,
  };
}

function plan(): AnalysisPlan {
  return {
    version: "v1",
    id: "plan_1",
    datasetId: "ds",
    understandingId: "und",
    objectives: ["收入"],
    assumptions: [],
    tasks: [task({})],
    dashboard: {
      items: [
        { id: "c1", taskId: "t1", type: "bar", title: "c", description: "", rationale: "", priority: 1, width: "half", visible: true },
      ],
      sections: [],
    },
    questionsForUser: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function execution(): PlanExecutionResult {
  const r: TaskExecutionResult = {
    taskId: "t1",
    operator: "aggregate",
    status: "success",
    columns: [],
    rows: [],
    summary: { rowCount: 2, nullCount: 0, truncated: false },
    warnings: [],
    evidence: [{ id: "ev1", title: "e", description: "d", fields: ["业务收入"], method: "aggregate", result: {}, sampleSize: 8 }],
    inputHash: "h",
    resultHash: "r",
    durationMs: 1,
  };
  return { results: { t1: r }, taskOrder: ["t1"], cacheHits: 0, durationMs: 1 };
}

/** 合法 LLM review（findings 引用真实 evidence） */
function llmReview(status: "approved" | "revise" | "needs_user_input"): unknown {
  return {
    version: "v1",
    status,
    executiveSummary: "结论",
    narrative: "解读内容",
    findings: [
      { id: "f1", level: "positive", title: "t", statement: "s", evidenceIds: ["ev1"], taskIds: ["t1"] },
    ],
    chartDecisions: [{ itemId: "c1", action: "keep", reason: "保留" }],
    planPatch: status === "revise" ? samplePatch() : undefined,
    questionsForUser: status === "needs_user_input" ? ["某字段含义？"] : [],
    assumptions: [],
  };
}

function samplePatch(): AnalysisPlanPatch {
  return {
    version: "v1",
    baseRevisionId: "rev_1",
    intentSummary: "补充完成率",
    removeTasks: [],
    updateTasks: [],
    addTasks: [
      { id: "t2", operator: "ratio", title: "完成率", purpose: "p", dimensions: ["地市"], metrics: ["业务收入", "目标收入"], filters: [], dependsOn: [], expectedOutput: "category_table", priority: 2, formula: { outputField: "完成率", expression: { op: "safe_divide", numerator: { op: "field", field: "业务收入" }, denominator: { op: "field", field: "目标收入" }, whenZero: "null" } } },
    ],
    dashboardChanges: { removeItems: [], updateItems: [] },
    userHardConstraints: [],
    explanation: "建议补充目标完成率",
  };
}

beforeEach(() => {
  state.enabled = true;
  state.shouldThrow = false;
  state.response = null;
});

describe("reviewExecution - SPEC 15", () => {
  it("approved", async () => {
    state.response = llmReview("approved");
    const r = await reviewExecution({
      understanding: makeKpiUnderstanding(),
      plan: plan(),
      execution: execution(),
      requestId: "r1",
    });
    expect(r.ok).toBe(true);
    expect(r.review!.status).toBe("approved");
    expect(r.review!.createdAt).toBeTruthy();
  });

  it("needs_user_input", async () => {
    state.response = llmReview("needs_user_input");
    const r = await reviewExecution({
      understanding: makeKpiUnderstanding(),
      plan: plan(),
      execution: execution(),
      requestId: "r2",
    });
    expect(r.ok).toBe(true);
    expect(r.review!.status).toBe("needs_user_input");
    expect(r.review!.questionsForUser.length).toBeGreaterThan(0);
  });

  it("revise 含 planPatch", async () => {
    state.response = llmReview("revise");
    const r = await reviewExecution({
      understanding: makeKpiUnderstanding(),
      plan: plan(),
      execution: execution(),
      requestId: "r3",
    });
    expect(r.ok).toBe(true);
    expect(r.review!.status).toBe("revise");
    expect(r.review!.planPatch).toBeTruthy();
  });

  it("LLM 失败 → ok:false（降级）", async () => {
    state.shouldThrow = true;
    const r = await reviewExecution({
      understanding: makeKpiUnderstanding(),
      plan: plan(),
      execution: execution(),
      requestId: "r4",
    });
    expect(r.ok).toBe(false);
    expect(r.review).toBeNull();
  });

  it("编造 evidence → ok:false", async () => {
    const bad = llmReview("approved") as { findings: Array<{ evidenceIds: string[] }> };
    bad.findings[0].evidenceIds = ["ghost_ev"];
    state.response = bad;
    const r = await reviewExecution({
      understanding: makeKpiUnderstanding(),
      plan: plan(),
      execution: execution(),
      requestId: "r5",
    });
    expect(r.ok).toBe(false);
  });
});

describe("applyReviewPatch - SPEC 15.4 / 16", () => {
  it("addTasks 增加任务", () => {
    const p = applyReviewPatch(plan(), samplePatch());
    expect(p.tasks.length).toBe(2);
    expect(p.tasks.some((t) => t.id === "t2")).toBe(true);
  });

  it("removeTasks 删除并清理依赖", () => {
    const base = plan();
    base.tasks = [task({ id: "t1" }), task({ id: "t2", dependsOn: ["t1"] })];
    const patch: AnalysisPlanPatch = {
      version: "v1",
      baseRevisionId: "rev_1",
      intentSummary: "删 t1",
      removeTasks: ["t1"],
      updateTasks: [],
      addTasks: [],
      dashboardChanges: { removeItems: [], updateItems: [] },
      userHardConstraints: [],
      explanation: "",
    };
    const p = applyReviewPatch(base, patch);
    expect(p.tasks.length).toBe(1);
    expect(p.tasks[0].dependsOn).toEqual([]);
  });

  it("dashboardChanges reorder", () => {
    const base = plan();
    base.dashboard.items = [
      { id: "c1", taskId: "t1", type: "bar", title: "1", description: "", rationale: "", priority: 1, width: "half", visible: true },
      { id: "c2", taskId: "t1", type: "line", title: "2", description: "", rationale: "", priority: 2, width: "half", visible: true },
    ];
    const patch: AnalysisPlanPatch = {
      version: "v1",
      baseRevisionId: "rev_1",
      intentSummary: "重排",
      removeTasks: [],
      updateTasks: [],
      addTasks: [],
      dashboardChanges: { removeItems: [], updateItems: [], reorderItems: ["c2", "c1"] },
      userHardConstraints: [],
      explanation: "",
    };
    const p = applyReviewPatch(base, patch);
    expect(p.dashboard.items.map((i) => i.id)).toEqual(["c2", "c1"]);
  });
});
