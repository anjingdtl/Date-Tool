import { describe, it, expect } from "vitest";
import type { AnalysisPlan, AnalysisTask } from "@/lib/types";
import { validateAnalysisPlan } from "@/lib/planner/validate-analysis-plan";
import { detectCycle, topologicalSort } from "@/lib/planner/plan-dependencies";
import { makeKpiDataset, makeKpiUnderstanding } from "./executor-fixtures";

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

function validPlan(tasks: AnalysisTask[] = [task({})]): AnalysisPlan {
  return {
    version: "v1",
    id: "plan_1",
    datasetId: "44444444-4444-4444-8444-444444444444",
    understandingId: "und_kpi",
    objectives: ["收入分析"],
    assumptions: [],
    tasks,
    dashboard: {
      items: [
        {
          id: "c1",
          taskId: tasks[0].id,
          type: "bar",
          title: "地市收入",
          description: "",
          rationale: "",
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

const ctx = {
  dataset: makeKpiDataset(),
  understanding: makeKpiUnderstanding(),
};

describe("validateAnalysisPlan - SPEC 12.7 规则矩阵", () => {
  it("合法计划通过", () => {
    const r = validateAnalysisPlan(validPlan(), ctx);
    expect(r.ok).toBe(true);
  });

  it("不存在字段 → error", () => {
    const p = validPlan([task({ metrics: ["不存在字段"] })]);
    expect(validateAnalysisPlan(p, ctx).ok).toBe(false);
  });

  it("重复 task ID → error", () => {
    const p = validPlan([
      task({ id: "dup" }),
      task({ id: "dup", metrics: ["目标收入"] }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "DUPLICATE_TASK_ID")).toBe(true);
  });

  it("依赖环 → error", () => {
    const p = validPlan([
      task({ id: "a", dependsOn: ["b"] }),
      task({ id: "b", dependsOn: ["a"], metrics: ["目标收入"] }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((i) => i.code === "DEPENDENCY_CYCLE")).toBe(true);
  });

  it("percentage/rate + sum → error", () => {
    const p = validPlan([task({ metrics: ["满意度"], aggregation: "sum" })]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((i) => i.code === "RATE_NO_SUM")).toBe(true);
  });

  it("stock 跨时间 sum → error", () => {
    const p = validPlan([
      task({
        operator: "timeseries",
        metrics: ["用户数"],
        aggregation: "sum",
        time: { field: "月份", grain: "month" },
        dimensions: [],
        expectedOutput: "series",
      }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((i) => i.code === "STOCK_NO_TIMESERIES_SUM")).toBe(true);
  });

  it("last 无 time/sort → error（顺序不稳定，禁止执行）", () => {
    const p = validPlan([
      task({ metrics: ["业务收入"], aggregation: "last", time: undefined }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "LAST_NEEDS_ORDER")).toBe(true);
  });

  it("任务超过硬上限 24 → error", () => {
    const tasks = Array.from({ length: 25 }, (_, i) =>
      task({ id: `t${i}`, metrics: ["业务收入"] }),
    );
    const p = validPlan(tasks);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((i) => i.code === "TOO_MANY_TASKS")).toBe(true);
  });

  it("图表引用不存在任务 → error", () => {
    const p = validPlan();
    p.dashboard.items[0].taskId = "不存在";
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((i) => i.code === "DANGLING_TASK_REF")).toBe(true);
  });

  it("between filter 缺数组 → error", () => {
    const p = validPlan([
      task({
        metrics: ["业务收入"],
        filters: [{ field: "业务收入", operator: "between", value: 100 }],
      }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((i) => i.code === "BAD_BETWEEN")).toBe(true);
  });

  it("非法公式节点 → error", () => {
    const p = validPlan([
      task({
        operator: "ratio",
        metrics: ["业务收入", "目标收入"],
        formula: {
          outputField: "x",
          expression: {
            op: "safe_divide",
            numerator: { op: "field", field: "业务收入" },
            denominator: { op: "field", field: "未知字段" },
            whenZero: "null",
          },
        },
      }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.ok).toBe(false);
  });

  it("identifier 禁止 avg", () => {
    const dataset = makeKpiDataset();
    const understanding = makeKpiUnderstanding();
    dataset.columns = dataset.columns.map((column) =>
      column.name === "地市" ? { ...column, type: "number", role: "identifier" } : column,
    );
    understanding.fields = understanding.fields.map((field) =>
      field.field === "地市" ? { ...field, role: "identifier" } : field,
    );
    const p = validPlan([task({ metrics: ["地市"], aggregation: "avg" })]);
    const r = validateAnalysisPlan(p, { dataset, understanding });
    expect(r.issues.some((issue) => issue.code === "IDENTIFIER_NO_SUM_AVG")).toBe(true);
  });

  it("ratio 公式引用非数值字段 → error", () => {
    const p = validPlan([
      task({
        operator: "ratio",
        metrics: ["业务收入", "地市"],
        formula: {
          outputField: "错误比率",
          expression: {
            op: "safe_divide",
            numerator: { op: "field", field: "业务收入" },
            denominator: { op: "field", field: "地市" },
            whenZero: "null",
          },
        },
      }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((issue) => issue.code === "RATIO_NON_NUMERIC_FIELD")).toBe(true);
  });

  it("correlation 至少需要两个数值指标", () => {
    const p = validPlan([
      task({ operator: "correlation", dimensions: [], metrics: ["业务收入"], expectedOutput: "matrix" }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((issue) => issue.code.includes("NEED_TWO_METRICS"))).toBe(true);
  });

  it("filter 值必须与字段物理类型兼容", () => {
    const p = validPlan([
      task({ filters: [{ field: "业务收入", operator: "gt", value: "一百" }] }),
    ]);
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((issue) => issue.code === "FILTER_VALUE_TYPE")).toBe(true);
  });

  it("pie 类别超过 8 时拒绝", () => {
    const dataset = makeKpiDataset();
    dataset.columns = dataset.columns.map((column) =>
      column.name === "地市" ? { ...column, distinctCount: 20 } : column,
    );
    const p = validPlan();
    p.dashboard.items[0].type = "pie";
    const r = validateAnalysisPlan(p, { dataset, understanding: makeKpiUnderstanding() });
    expect(r.ok).toBe(false);
    expect(r.issues.some((issue) => issue.code === "PIE_TOO_MANY_CATEGORIES")).toBe(true);
  });

  it("图表类型必须与任务输出形态兼容", () => {
    const p = validPlan();
    p.dashboard.items[0].type = "kpi";
    const r = validateAnalysisPlan(p, ctx);
    expect(r.issues.some((issue) => issue.code === "CHART_OUTPUT_MISMATCH")).toBe(true);
  });

  it("已识别的用户硬约束不可违反", () => {
    const p = validPlan();
    p.dashboard.items[0].type = "pie";
    const r = validateAnalysisPlan(p, {
      ...ctx,
      userHardConstraints: ["不要使用饼图"],
    });
    expect(
      r.issues.some((issue) => issue.code === "USER_HARD_CONSTRAINT_VIOLATED"),
    ).toBe(true);
  });
});

describe("plan-dependencies - DAG", () => {
  it("无环拓扑排序正确", () => {
    const tasks = [
      task({ id: "a", dependsOn: [] }),
      task({ id: "b", dependsOn: ["a"] }),
      task({ id: "c", dependsOn: ["a", "b"] }),
    ];
    const { order, cycle } = topologicalSort(tasks);
    expect(cycle).toBeNull();
    const ai = order.indexOf("a");
    const bi = order.indexOf("b");
    const ci = order.indexOf("c");
    expect(ai).toBeLessThan(bi);
    expect(bi).toBeLessThan(ci);
  });

  it("检测自环 / 两点环", () => {
    const tasks = [
      task({ id: "a", dependsOn: ["b"] }),
      task({ id: "b", dependsOn: ["a"] }),
    ];
    expect(detectCycle(tasks)).not.toBeNull();
  });
});
