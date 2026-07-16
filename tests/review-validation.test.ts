import { describe, it, expect } from "vitest";
import { validateReview } from "@/lib/reviewer/validate-review";
import type {
  AnalysisPlan,
  AnalysisReview,
  PlanExecutionResult,
  TaskExecutionResult,
} from "@/lib/types";

function plan(): AnalysisPlan {
  return {
    version: "v1",
    id: "plan_1",
    datasetId: "ds",
    understandingId: "und",
    objectives: [],
    assumptions: [],
    tasks: [
      { id: "t1", operator: "aggregate", title: "t", purpose: "p", dimensions: ["d"], metrics: ["m"], filters: [], aggregation: "sum", dependsOn: [], expectedOutput: "category_table", priority: 1 },
    ],
    dashboard: {
      items: [{ id: "c1", taskId: "t1", type: "bar", title: "c", description: "", rationale: "", priority: 1, width: "half", visible: true }],
      sections: [],
    },
    questionsForUser: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function execution(evidenceIds: string[]): PlanExecutionResult {
  const results: Record<string, TaskExecutionResult> = {
    t1: {
      taskId: "t1",
      operator: "aggregate",
      status: "success",
      columns: [],
      rows: [],
      summary: { rowCount: 1, nullCount: 0, truncated: false },
      warnings: [],
      evidence: evidenceIds.map((id) => ({
        id,
        title: "e",
        description: "d",
        fields: [],
        method: "summary",
        result: {},
        sampleSize: 1,
      })),
      inputHash: "h",
      resultHash: "r",
      durationMs: 1,
    },
  };
  return { results, taskOrder: ["t1"], cacheHits: 0, durationMs: 1 };
}

function review(evidenceIds: string[]): AnalysisReview {
  return {
    version: "v1",
    status: "approved",
    executiveSummary: "s",
    narrative: "n",
    findings: [
      { id: "f1", level: "positive", title: "t", statement: "s", evidenceIds, taskIds: ["t1"] },
    ],
    chartDecisions: [{ itemId: "c1", action: "keep", reason: "r" }],
    questionsForUser: [],
    assumptions: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("validateReview - SPEC 15.4 / 22.6", () => {
  it("findings 引用存在 evidence → ok", () => {
    const r = validateReview(review(["ev1"]), {
      plan: plan(),
      execution: execution(["ev1"]),
    });
    expect(r.ok).toBe(true);
  });

  it("findings 编造 evidence → error（不得编造）", () => {
    const r = validateReview(review(["ghost_ev"]), {
      plan: plan(),
      execution: execution(["ev1"]),
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "DANGLING_EVIDENCE")).toBe(true);
  });

  it("chartDecisions 引用不存在图表 → warning（不阻断）", () => {
    const rv = review([]);
    rv.chartDecisions = [{ itemId: "ghost", action: "remove", reason: "r" }];
    const r = validateReview(rv, { plan: plan(), execution: execution(["ev1"]) });
    expect(r.issues.some((i) => i.code === "DANGLING_CHART")).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("findings 引用不存在任务 → warning", () => {
    const rv = review(["ev1"]);
    rv.findings[0].taskIds = ["ghost_task"];
    const r = validateReview(rv, { plan: plan(), execution: execution(["ev1"]) });
    expect(r.issues.some((i) => i.code === "DANGLING_TASK")).toBe(true);
  });

  it("包含数值的 finding 没有 Evidence → error", () => {
    const rv = review([]);
    rv.findings[0].statement = "收入增长 12.5%";
    const r = validateReview(rv, { plan: plan(), execution: execution(["ev1"]) });
    expect(r.ok).toBe(false);
    expect(
      r.issues.some((issue) => issue.code === "NUMERIC_FINDING_WITHOUT_EVIDENCE"),
    ).toBe(true);
  });
});
