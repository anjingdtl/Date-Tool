import { describe, expect, it } from "vitest";
import { buildReviewInput } from "@/lib/reviewer/review-prompt";
import { makeKpiUnderstanding } from "./executor-fixtures";
import type { AnalysisPlan, PlanExecutionResult } from "@/lib/types";

function plan(): AnalysisPlan {
  return {
    version: "v1",
    id: "p1",
    datasetId: "d1",
    understandingId: "u1",
    objectives: ["收入分析"],
    assumptions: [],
    tasks: [{
      id: "t1",
      operator: "aggregate",
      title: "收入",
      purpose: "分析收入",
      dimensions: ["地市"],
      metrics: ["业务收入"],
      filters: [],
      aggregation: "sum",
      dependsOn: [],
      expectedOutput: "category_table",
      priority: 1,
    }],
    dashboard: {
      items: [{ id: "c1", taskId: "t1", type: "bar", title: "收入", description: "", rationale: "", priority: 1, width: "half", visible: true }],
      sections: [],
    },
    questionsForUser: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function execution(fields = ["业务收入"]): PlanExecutionResult {
  return {
    results: {
      t1: {
        taskId: "t1",
        operator: "aggregate",
        status: "success",
        columns: [],
        rows: [],
        summary: { rowCount: 2, nullCount: 0, truncated: false },
        warnings: [],
        evidence: [{
          id: "ev1",
          title: "收入汇总",
          description: "按地市汇总",
          fields,
          method: "aggregate",
          result: { total: 8230, top: [{ city: "南宁", value: 4600 }] },
          sampleSize: 8,
        }],
        inputHash: "h",
        resultHash: "r",
        durationMs: 1,
      },
    },
    taskOrder: ["t1"],
    cacheHits: 0,
    durationMs: 1,
  };
}

describe("Review Prompt Evidence 裁剪与隐私", () => {
  it("向终审提供可核验的 Evidence 结果摘要", () => {
    const prompt = buildReviewInput({
      understanding: makeKpiUnderstanding(),
      plan: plan(),
      execution: execution(),
    });
    expect(prompt).toContain('"total":8230');
    expect(prompt).toContain("ev1");
  });

  it("identifier Evidence 结果不发送给 LLM", () => {
    const understanding = makeKpiUnderstanding();
    understanding.fields = understanding.fields.map((field) =>
      field.field === "地市" ? { ...field, role: "identifier" } : field,
    );
    const prompt = buildReviewInput({
      understanding,
      plan: plan(),
      execution: execution(["地市"]),
    });
    expect(prompt).toContain("identifier evidence is not sent to LLM");
    expect(prompt).not.toContain("南宁");
  });
});
