import { describe, expect, it } from "vitest";
import { compileChart } from "@/lib/executor/compile-chart";
import type { AnalysisTask, DashboardItemPlan, PlannedChartType, TaskExecutionResult } from "@/lib/types";

const task: AnalysisTask = {
  id: "t1", operator: "pivot", title: "图表", purpose: "图表",
  dimensions: ["地区", "月份"], metrics: ["收入", "目标"], filters: [], aggregation: "sum",
  dependsOn: [], expectedOutput: "matrix", priority: 1,
};
const result: TaskExecutionResult = {
  taskId: "t1", operator: "pivot", status: "success",
  columns: [
    { name: "地区", type: "string" }, { name: "月份", type: "string" },
    { name: "收入", type: "number" }, { name: "目标", type: "number" },
  ],
  rows: [
    { 地区: "南宁", 月份: "1月", 收入: 10, 目标: 12 },
    { 地区: "柳州", 月份: "1月", 收入: 8, 目标: 9 },
  ],
  scalar: 18,
  summary: { rowCount: 2, nullCount: 0, truncated: false }, warnings: [], evidence: [],
  inputHash: "i", resultHash: "r", durationMs: 1,
};

function item(type: PlannedChartType): DashboardItemPlan {
  return { id: `c_${type}`, taskId: "t1", type, title: type, description: "", rationale: "", priority: 1, width: "half", visible: true };
}

describe("v0.3 图表编译", () => {
  it("area/stacked_bar 保留扩展类型并生成 ECharts series", () => {
    for (const type of ["area", "stacked_bar"] as const) {
      const compiled = compileChart(item(type), task, result)!;
      expect(compiled.spec.type).toBe(type);
      expect(Array.isArray(compiled.option.series)).toBe(true);
    }
  });

  it("scatter 编译为 scatter series", () => {
    const compiled = compileChart(item("scatter"), task, result)!;
    expect((compiled.option.series as Array<{ type: string }>)[0].type).toBe("scatter");
  });

  it("heatmap 编译为 heatmap series", () => {
    const compiled = compileChart(item("heatmap"), task, result)!;
    expect((compiled.option.series as Array<{ type: string }>)[0].type).toBe("heatmap");
  });

  it("table 使用任务结果行，kpi 使用 scalar", () => {
    const table = compileChart(item("table"), task, result)!;
    const kpi = compileChart(item("kpi"), task, result)!;
    expect(table.spec.dataRows).toEqual(result.rows);
    expect(kpi.spec.scalar).toBe(18);
    expect(kpi.spec.type).toBe("kpi");
  });
});
