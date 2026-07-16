import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/conversation/interpret-user-feedback", () => ({ interpretUserFeedback: vi.fn() }));
vi.mock("@/lib/executor/execute-plan", () => ({ executePlan: vi.fn() }));
vi.mock("@/lib/reviewer/review-execution", () => ({ reviewExecution: vi.fn() }));
vi.mock("@/lib/store", () => ({
  listRevisions: vi.fn(async () => []),
  saveRevision: vi.fn(async () => {}),
  saveSession: vi.fn(async () => {}),
  saveUnderstanding: vi.fn(async () => {}),
}));

import { applyUserFeedback } from "@/lib/orchestrator/apply-user-feedback";
import { interpretUserFeedback } from "@/lib/conversation/interpret-user-feedback";
import { executePlan } from "@/lib/executor/execute-plan";
import { reviewExecution } from "@/lib/reviewer/review-execution";
import { saveSession } from "@/lib/store";
import { makeKpiDataset, makeKpiUnderstanding } from "./executor-fixtures";
import type { AnalysisPlan, AnalysisRevision, AnalysisReview, AnalysisSession, PlanExecutionResult, TaskExecutionResult } from "@/lib/types";

const task = {
  id: "t1", operator: "aggregate" as const, title: "收入", purpose: "收入",
  dimensions: ["地市"], metrics: ["业务收入"], filters: [], aggregation: "sum" as const,
  dependsOn: [], expectedOutput: "category_table" as const, priority: 1,
};
function plan(): AnalysisPlan {
  return {
    version: "v1", id: "p1", datasetId: makeKpiDataset().id, understandingId: makeKpiUnderstanding().id,
    objectives: [], assumptions: [], tasks: [task],
    dashboard: { items: [{ id: "c1", taskId: "t1", type: "bar", title: "收入", description: "", rationale: "", priority: 1, width: "half", visible: true }], sections: [] },
    questionsForUser: [], createdAt: "2026-07-16T00:00:00.000Z",
  };
}
function execution(): PlanExecutionResult {
  const result: TaskExecutionResult = {
    taskId: "t1", operator: "aggregate", status: "success",
    columns: [{ name: "地市", type: "string" }, { name: "业务收入", type: "number" }],
    rows: [{ 地市: "南宁", 业务收入: 10 }], summary: { rowCount: 1, nullCount: 0, truncated: false },
    warnings: [], evidence: [{ id: "ev1", title: "收入", description: "", fields: ["业务收入"], method: "aggregate", result: {}, sampleSize: 1 }],
    inputHash: "i", resultHash: "r", durationMs: 1,
  };
  return { results: { t1: result }, taskOrder: ["t1"], cacheHits: 0, durationMs: 1 };
}
function base() {
  const revision: AnalysisRevision = {
    id: "r1", sessionId: "s1", sequence: 1, status: "approved", source: "initial",
    understandingSnapshot: makeKpiUnderstanding(), plan: plan(), execution: execution(), review: null,
    finalResult: null, createdAt: "2026-07-16T00:00:00.000Z",
  };
  const session: AnalysisSession = {
    id: "s1", datasetId: makeKpiDataset().id, status: "completed", activeRevisionId: "r1",
    revisionIds: ["r1"], createdAt: revision.createdAt, updatedAt: revision.createdAt,
  };
  return { revision, session };
}
const approved: AnalysisReview = {
  version: "v1", status: "approved", executiveSummary: "通过", narrative: "通过",
  findings: [{ id: "f1", level: "positive", title: "收入", statement: "已核验", evidenceIds: ["ev1"], taskIds: ["t1"] }],
  chartDecisions: [{ itemId: "c1", action: "keep", reason: "保留" }], questionsForUser: [], assumptions: [],
  createdAt: "2026-07-16T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(interpretUserFeedback).mockResolvedValue({
    ok: true, attempts: 0,
    patch: {
      version: "v1", baseRevisionId: "r1", intentSummary: "改标题", removeTasks: [], updateTasks: [], addTasks: [],
      dashboardChanges: { removeItems: [], updateItems: [{ itemId: "c1", changes: { title: "新标题" } }] },
      userHardConstraints: [], explanation: "",
    },
  });
  vi.mocked(executePlan).mockResolvedValue(execution());
  vi.mocked(reviewExecution).mockResolvedValue({ ok: true, review: approved });
});

describe("反馈增量编排", () => {
  it("仅改标题复用全部任务结果并生成新 Revision", async () => {
    const current = base();
    const result = await applyUserFeedback({
      dataset: makeKpiDataset(), session: current.session, baseRevision: current.revision,
      message: "改标题", requestId: "req", hooks: {},
    });
    const options = vi.mocked(executePlan).mock.calls[0][2];
    expect(options?.taskIdsToExecute?.size).toBe(0);
    expect(options?.reuseResults?.t1).toBeDefined();
    expect(result.activeRevision.parentRevisionId).toBe("r1");
    expect(result.activeRevision.plan.dashboard.items[0].title).toBe("新标题");
    expect(saveSession).toHaveBeenCalledTimes(1);
  });

  it("stale Revision 在解释和写入前被拒绝", async () => {
    const current = base();
    current.session.activeRevisionId = "newer";
    await expect(applyUserFeedback({
      dataset: makeKpiDataset(), session: current.session, baseRevision: current.revision,
      message: "改标题", requestId: "req", hooks: {},
    })).rejects.toThrow(/已变化/);
    expect(interpretUserFeedback).not.toHaveBeenCalled();
    expect(saveSession).not.toHaveBeenCalled();
  });
});
