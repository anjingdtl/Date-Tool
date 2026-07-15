import { describe, it, expect } from "vitest";
import { buildChartOption } from "@/lib/chart";
import type { ChartSpec, DatasetRow } from "@/lib/types";

const rows: DatasetRow[] = [
  { date: "2026-07-01", 客户: "A", 值: 100 },
  { date: "2026-07-02", 客户: "A", 值: 200 },
  { date: "2026-07-03", 客户: "B", 值: 150 },
];

describe("buildChartOption - bar", () => {
  it("生成柱状图 option，含 series 与 data", () => {
    const spec: ChartSpec = {
      id: "c1",
      title: "测试柱状图",
      type: "bar",
      xField: "客户",
      yField: "值",
      agg: "sum",
    };
    const opt = buildChartOption(spec, rows) as Record<string, unknown>;
    expect(opt.series).toBeDefined();
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series.length).toBeGreaterThan(0);
    expect(series[0].type).toBe("bar");
    const data = series[0].data as number[];
    expect(data.length).toBeGreaterThan(0);
  });
});

describe("buildChartOption - line", () => {
  it("生成折线图 option", () => {
    const spec: ChartSpec = {
      id: "c2",
      title: "趋势",
      type: "line",
      xField: "date",
      yField: "值",
      agg: "sum",
    };
    const opt = buildChartOption(spec, rows) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].type).toBe("line");
  });
});

describe("buildChartOption - pie", () => {
  it("生成饼图 option，data 含 name/value", () => {
    const spec: ChartSpec = {
      id: "c3",
      title: "构成",
      type: "pie",
      xField: "客户",
      yField: "__count__",
      agg: "count",
    };
    const opt = buildChartOption(spec, rows) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].type).toBe("pie");
    const data = series[0].data as Array<{ name: string; value: number }>;
    expect(data.length).toBe(2); // A, B
    expect(data.some((d) => d.name === "A")).toBe(true);
  });
});

describe("buildChartOption - count 聚合", () => {
  it("agg=count 或 yField=__count__ 时按计数", () => {
    const spec: ChartSpec = {
      id: "c4",
      title: "计数",
      type: "bar",
      xField: "客户",
      yField: "__count__",
      agg: "count",
    };
    const opt = buildChartOption(spec, rows) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    const data = series[0].data as number[];
    // A 出现 2 次, B 1 次
    expect(data).toContain(2);
    expect(data).toContain(1);
  });
});

describe("buildChartOption - 空数据容错", () => {
  it("空 rows 不抛错", () => {
    const spec: ChartSpec = {
      id: "c5",
      title: "空",
      type: "bar",
      xField: "x",
      yField: "y",
      agg: "sum",
    };
    expect(() => buildChartOption(spec, [])).not.toThrow();
  });
});
