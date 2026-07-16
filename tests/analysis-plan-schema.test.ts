import { describe, it, expect } from "vitest";
import {
  AnalysisPlanSchema,
  AnalysisTaskSchema,
  validateAnalysisPlan,
  type AnalysisPlanParsed,
  type AnalysisTaskParsed,
} from "@/lib/schemas/analysis-plan";

function validTask(): AnalysisTaskParsed {
  return {
    id: "t1",
    operator: "aggregate",
    title: "各地市收入",
    purpose: "对比各地市业务收入贡献",
    dimensions: ["地市"],
    metrics: ["业务收入"],
    filters: [],
    aggregation: "sum",
    dependsOn: [],
    expectedOutput: "category_table",
    priority: 1,
  };
}

function validPlan(): AnalysisPlanParsed {
  return {
    version: "v1",
    id: "plan_1",
    datasetId: "ds_1",
    understandingId: "und_1",
    objectives: ["收入对比"],
    assumptions: [],
    tasks: [validTask()],
    dashboard: {
      items: [
        {
          id: "c1",
          taskId: "t1",
          type: "bar",
          title: "地市收入对比",
          description: "按地市聚合业务收入",
          rationale: "识别贡献地市",
          priority: 1,
          width: "half",
          visible: true,
        },
      ],
      sections: [],
    },
    questionsForUser: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("AnalysisTaskSchema - SPEC 12.3", () => {
  it("合法任务通过", () => {
    expect(AnalysisTaskSchema.safeParse(validTask()).success).toBe(true);
  });

  it("拒绝非法 operator", () => {
    const t = validTask() as { operator: string };
    t.operator = "sql_query";
    expect(AnalysisTaskSchema.safeParse(t).success).toBe(false);
  });

  it("拒绝 limit 超过 100", () => {
    const t = { ...validTask(), limit: 101 };
    expect(AnalysisTaskSchema.safeParse(t).success).toBe(false);
  });

  it("接受 limit 在 1~100", () => {
    const t = { ...validTask(), limit: 50 };
    expect(AnalysisTaskSchema.safeParse(t).success).toBe(true);
  });

  it("拒绝非法 time grain", () => {
    const t = { ...validTask(), time: { field: "月份", grain: "decade" } };
    expect(AnalysisTaskSchema.safeParse(t).success).toBe(false);
  });

  it("接受合法 formula", () => {
    const t = {
      ...validTask(),
      operator: "ratio",
      formula: {
        outputField: "收入完成率",
        expression: {
          op: "safe_divide",
          numerator: { op: "field", field: "业务收入" },
          denominator: { op: "field", field: "目标收入" },
          whenZero: "null",
        },
        format: "percentage",
      },
    };
    expect(AnalysisTaskSchema.safeParse(t).success).toBe(true);
  });

  it("接受 median/last 聚合", () => {
    for (const aggregation of ["median", "last"] as const) {
      expect(AnalysisTaskSchema.safeParse({ ...validTask(), aggregation }).success).toBe(true);
    }
  });

  it("拒绝 filter 非法 operator", () => {
    const t = {
      ...validTask(),
      filters: [{ field: "地市", operator: "regex", value: "南宁" }],
    };
    expect(AnalysisTaskSchema.safeParse(t).success).toBe(false);
  });
});

describe("AnalysisPlanSchema - SPEC 12.5", () => {
  it("合法计划通过", () => {
    expect(AnalysisPlanSchema.safeParse(validPlan()).success).toBe(true);
  });

  it("拒绝 version 非 v1", () => {
    const p = validPlan();
    (p as { version: string }).version = "v0";
    expect(AnalysisPlanSchema.safeParse(p).success).toBe(false);
  });

  it("拒绝空 understandingId", () => {
    const p = validPlan();
    p.understandingId = "";
    expect(AnalysisPlanSchema.safeParse(p).success).toBe(false);
  });

  it("拒绝非法图表 type", () => {
    const p = validPlan();
    (p.dashboard.items[0] as { type: string }).type = "radar";
    expect(AnalysisPlanSchema.safeParse(p).success).toBe(false);
  });

  it("接受新增图表类型 area/stacked_bar/scatter/heatmap/kpi", () => {
    const p = validPlan();
    p.tasks = [
      { ...validTask(), id: "t1" },
      { ...validTask(), id: "t2" },
      { ...validTask(), id: "t3" },
      { ...validTask(), id: "t4" },
      { ...validTask(), id: "t5" },
    ];
    const types = ["area", "stacked_bar", "scatter", "heatmap", "kpi"] as const;
    p.dashboard.items = types.map((type, i) => ({
      ...p.dashboard.items[0],
      id: `c${i + 1}`,
      taskId: `t${i + 1}`,
      type,
    }));
    expect(AnalysisPlanSchema.safeParse(p).success).toBe(true);
  });

  it("validateAnalysisPlan 返回 ok/error", () => {
    expect(validateAnalysisPlan(validPlan()).ok).toBe(true);
    expect(validateAnalysisPlan({}).ok).toBe(false);
  });
});
