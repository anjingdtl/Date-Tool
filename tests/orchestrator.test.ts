/**
 * tests/orchestrator.test.ts
 *
 * 阶段 8：runAnalysisSession 编排主链路（SPEC 14.2 / 24.6）。
 * mock createAnalysisPlan / executePlan / reviewExecution，验证：
 * approved / revise 一轮 / needs_user_input / review 失败降级 / 事件顺序。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/store", () => ({
  listSessions: vi.fn(async () => []),
  saveSession: vi.fn(async () => {}),
  saveRevision: vi.fn(async () => {}),
}));
vi.mock("@/lib/planner/create-analysis-plan", () => ({
  createAnalysisPlan: vi.fn(),
}));
vi.mock("@/lib/executor/execute-plan", () => ({ executePlan: vi.fn() }));
vi.mock("@/lib/reviewer/review-execution", () => ({ reviewExecution: vi.fn() }));

import { runAnalysisSession } from "@/lib/orchestrator/run-analysis-session";
import { createAnalysisPlan } from "@/lib/planner/create-analysis-plan";
import { executePlan } from "@/lib/executor/execute-plan";
import { reviewExecution } from "@/lib/reviewer/review-execution";
import { makeKpiDataset, makeKpiUnderstanding } from "./executor-fixtures";
import type {
  AnalysisPlan,
  AnalysisReview,
  AnalysisTask,
  PlanExecutionResult,
  TaskExecutionResult,
} from "@/lib/types";

function task(over: Partial<AnalysisTask> = {}): AnalysisTask {
  return {
    id: "t1",
    operator: "aggregate",
    title: "地市收入",
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

function mockPlan(): AnalysisPlan {
  return {
    version: "v1",
    id: "plan_1",
    datasetId: "ds",
    understandingId: "und",
    objectives: ["收入分析"],
    assumptions: [],
    tasks: [task({})],
    dashboard: {
      items: [
        { id: "c1", taskId: "t1", type: "bar", title: "地市收入", description: "", rationale: "", priority: 1, width: "half", visible: true },
      ],
      sections: [],
    },
    questionsForUser: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function mockExecution(): PlanExecutionResult {
  const r: TaskExecutionResult = {
    taskId: "t1",
    operator: "aggregate",
    status: "success",
    columns: [
      { name: "地市", type: "string" },
      { name: "业务收入", type: "number" },
    ],
    rows: [
      { 地市: "南宁", 业务收入: 4600 },
      { 地市: "柳州", 业务收入: 3630 },
    ],
    summary: { rowCount: 2, nullCount: 0, truncated: false },
    warnings: [],
    evidence: [{ id: "ev1", title: "聚合", description: "d", fields: ["业务收入"], method: "aggregate", result: {}, sampleSize: 8 }],
    inputHash: "h",
    resultHash: "r",
    durationMs: 1,
  };
  return { results: { t1: r }, taskOrder: ["t1"], cacheHits: 0, durationMs: 1 };
}

function mockReview(status: "approved" | "revise" | "needs_user_input"): AnalysisReview {
  return {
    version: "v1",
    status,
    executiveSummary: "结论",
    narrative: "解读",
    findings: [{ id: "f1", level: "positive", title: "t", statement: "s", evidenceIds: ["ev1"], taskIds: ["t1"] }],
    chartDecisions: [{ itemId: "c1", action: "keep", reason: "保留" }],
    planPatch:
      status === "revise"
        ? {
            version: "v1",
            baseRevisionId: "rev_1",
            intentSummary: "补充完成率",
            removeTasks: [],
            updateTasks: [],
            addTasks: [
              task({
                id: "t2",
                operator: "ratio",
                metrics: ["业务收入", "目标收入"],
                formula: {
                  outputField: "完成率",
                  expression: {
                    op: "safe_divide",
                    numerator: { op: "field", field: "业务收入" },
                    denominator: { op: "field", field: "目标收入" },
                    whenZero: "null",
                  },
                },
              }),
            ],
            dashboardChanges: { removeItems: [], updateItems: [] },
            userHardConstraints: [],
            explanation: "补完成率",
          }
        : undefined,
    questionsForUser: status === "needs_user_input" ? ["某字段含义？"] : [],
    assumptions: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.mocked(createAnalysisPlan).mockReset();
  vi.mocked(executePlan).mockReset();
  vi.mocked(reviewExecution).mockReset();
});

function setupPlanOk() {
  vi.mocked(createAnalysisPlan).mockResolvedValue({
    ok: true,
    plan: mockPlan(),
    issues: [],
    attempts: 0,
  });
}
function setupExecute() {
  vi.mocked(executePlan).mockImplementation(async (plan, _ctx, options) => {
    const exec = mockExecution();
    // 真实 executePlan 会触发任务回调，mock 同步触发以满足事件顺序断言
    for (const t of plan.tasks) {
      options?.onTaskStarted?.(t);
      const r = exec.results["t1"];
      if (r) options?.onTaskCompleted?.(t, r);
    }
    return exec;
  });
}

const baseInput = {
  dataset: makeKpiDataset(),
  understanding: makeKpiUnderstanding(),
  requestId: "req-orch",
  hooks: { onNarrativeToken: () => {} },
};

describe("runAnalysisSession - SPEC 14.2 / 24.6", () => {
  it("approved：单轮完成，reviewStatus=approved", async () => {
    setupPlanOk();
    setupExecute();
    vi.mocked(reviewExecution).mockResolvedValue({
      ok: true,
      review: mockReview("approved"),
    });
    const r = await runAnalysisSession(baseInput);
    expect(r.finalResult.analysisMode).toBe("llm_orchestrated");
    expect(r.finalResult.reviewStatus).toBe("approved");
    expect(r.finalResult.planSummary?.taskCount).toBe(1);
    expect(r.session.status).toBe("completed");
    expect(r.finalResult.charts.length).toBeGreaterThan(0);
  });

  it("revise 一轮：形成 2 个 Revision，最终 approved", async () => {
    setupPlanOk();
    setupExecute();
    vi.mocked(reviewExecution)
      .mockResolvedValueOnce({ ok: true, review: mockReview("revise") })
      .mockResolvedValueOnce({ ok: true, review: mockReview("approved") });
    const r = await runAnalysisSession(baseInput);
    expect(r.session.revisionIds.length).toBe(2);
    expect(r.finalResult.reviewStatus).toBe("approved");
    // 第 2 轮 plan 含新增任务 t2
    expect(r.activeRevision.plan.tasks.some((t) => t.id === "t2")).toBe(true);
  });

  it("连续 revise 达到硬上限后停止，并标记未解决警告", async () => {
    setupPlanOk();
    setupExecute();
    vi.mocked(reviewExecution).mockResolvedValue({
      ok: true,
      review: mockReview("revise"),
    });
    const r = await runAnalysisSession(baseInput);
    expect(reviewExecution).toHaveBeenCalledTimes(3);
    expect(r.session.revisionIds).toHaveLength(3);
    expect(r.finalResult.reviewStatus).toBe("approved_with_warnings");
    expect(
      r.finalResult.warnings?.some((warning) => warning.includes("未解决")),
    ).toBe(true);
  });

  it("needs_user_input：session 暂停，保留结果", async () => {
    setupPlanOk();
    setupExecute();
    vi.mocked(reviewExecution).mockResolvedValue({
      ok: true,
      review: mockReview("needs_user_input"),
    });
    const r = await runAnalysisSession(baseInput);
    expect(r.session.status).toBe("needs_user_input");
    expect(r.finalResult.reviewStatus).toBe("needs_user_input");
    expect(r.finalResult.questionsForUser?.length).toBeGreaterThan(0);
  });

  it("review 失败 → reviewStatus=unavailable，保留确定性结果", async () => {
    setupPlanOk();
    setupExecute();
    vi.mocked(reviewExecution).mockResolvedValue({
      ok: false,
      review: null,
      error: "LLM 超时",
    });
    const r = await runAnalysisSession(baseInput);
    expect(r.finalResult.reviewStatus).toBe("unavailable");
    expect(r.finalResult.warnings?.some((w) => w.includes("终审不可用"))).toBe(true);
    expect(r.finalResult.charts.length).toBeGreaterThan(0);
    expect(r.finalResult.narrative).toContain("本地确定性引擎");
  });

  it("事件顺序：stage(planning) → plan → task_started → task_completed → review → final", async () => {
    setupPlanOk();
    setupExecute();
    vi.mocked(reviewExecution).mockResolvedValue({
      ok: true,
      review: mockReview("approved"),
    });
    const seq: string[] = [];
    await runAnalysisSession({
      ...baseInput,
      hooks: {
        onStage: (_c, msg) => seq.push(`stage:${msg}`),
        onPlan: () => seq.push("plan"),
        onTaskStarted: () => seq.push("task_started"),
        onTaskCompleted: () => seq.push("task_completed"),
        onReview: () => seq.push("review"),
        onRevision: () => seq.push("revision"),
        onNarrativeToken: () => seq.push("token"),
        onFinal: () => seq.push("final"),
      },
    });
    const planIdx = seq.indexOf("plan");
    const taskStartIdx = seq.indexOf("task_started");
    const reviewIdx = seq.indexOf("review");
    const finalIdx = seq.indexOf("final");
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeLessThan(taskStartIdx);
    expect(taskStartIdx).toBeLessThan(reviewIdx);
    expect(reviewIdx).toBeLessThan(finalIdx);
    expect(seq.indexOf("revision")).toBeLessThan(finalIdx);
  });

  it("计划生成失败 → 抛错（调用方降级本地）", async () => {
    vi.mocked(createAnalysisPlan).mockResolvedValue({
      ok: false,
      plan: null,
      issues: [],
      attempts: 3,
      error: "计划校验未通过",
    });
    await expect(runAnalysisSession(baseInput)).rejects.toThrow();
  });
});
