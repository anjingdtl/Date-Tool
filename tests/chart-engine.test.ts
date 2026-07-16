import { describe, it, expect } from "vitest";
import {
  recommendCharts,
  semanticValidateCharts,
  recommendAndValidate,
  pickAgg,
  type SemanticIssue,
} from "@/lib/analysis/recommend-charts";
import {
  validateChartSpec,
  filterValidCharts,
  ChartSpecSchema,
} from "@/lib/schemas/chart";
import { buildChartOption } from "@/lib/chart";
import { profileFields } from "@/lib/analysis/profile";
import { runLocalAnalysis } from "@/lib/analysis";
import type {
  ChartSpec,
  ColumnMeta,
  DatasetRow,
  StoredDataset,
} from "@/lib/types";

/* ------------------------- 测试夹具 ------------------------- */

function makeColumn(over: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: over.name ?? "金额",
    type: over.type ?? "number",
    role: over.role ?? "metric",
    format: over.format ?? "decimal",
    defaultAggregation: over.defaultAggregation ?? "sum",
    includeInAnalysis: over.includeInAnalysis ?? true,
    sampleValues: over.sampleValues ?? [],
    nullable: over.nullable ?? false,
    nullCount: over.nullCount ?? 0,
    nullRate: over.nullRate ?? 0,
    distinctCount: over.distinctCount,
    confidence: over.confidence ?? 1,
    userModified: over.userModified ?? false,
  };
}

const salesRows: DatasetRow[] = [
  { 日期: "2026-07-01", 客户: "甲公司", 金额: 100, 转化率: 0.1, 运营状态: "正常" },
  { 日期: "2026-07-02", 客户: "乙公司", 金额: 200, 转化率: 0.2, 运营状态: "正常" },
  { 日期: "2026-07-03", 客户: "甲公司", 金额: 300, 转化率: 0.3, 运营状态: "预警" },
  { 日期: "2026-07-04", 客户: "丙公司", 金额: 400, 转化率: 0.4, 运营状态: "正常" },
  { 日期: "2026-07-05", 客户: "甲公司", 金额: 500, 转化率: 0.5, 运营状态: "预警" },
  { 日期: "2026-07-06", 客户: "乙公司", 金额: 600, 转化率: 0.6, 运营状态: "正常" },
  { 日期: "2026-07-07", 客户: "丙公司", 金额: 700, 转化率: 0.7, 运营状态: "正常" },
  { 日期: "2026-07-08", 客户: "甲公司", 金额: 800, 转化率: 0.8, 运营状态: "预警" },
  { 日期: "2026-07-09", 客户: "乙公司", 金额: 900, 转化率: 0.9, 运营状态: "正常" },
  { 日期: "2026-07-10", 客户: "丙公司", 金额: 1000, 转化率: 1.0, 运营状态: "正常" },
];

const salesColumns: ColumnMeta[] = [
  makeColumn({ name: "日期", type: "date", role: "time", format: "date", defaultAggregation: "count" }),
  makeColumn({ name: "客户", type: "string", role: "dimension", format: "plain", defaultAggregation: "count" }),
  makeColumn({ name: "金额", type: "number", role: "metric", format: "currency", defaultAggregation: "sum" }),
  makeColumn({ name: "转化率", type: "number", role: "metric", format: "percentage", defaultAggregation: "avg" }),
  makeColumn({ name: "运营状态", type: "string", role: "status", format: "plain", defaultAggregation: "count" }),
];

function makeDataset(
  rows: DatasetRow[],
  columns: ColumnMeta[],
): StoredDataset {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    name: "测试集",
    fileName: "test.csv",
    source: "csv",
    rowCount: rows.length,
    originalRowCount: rows.length,
    storedRowCount: rows.length,
    columns,
    rows,
    quality: {
      originalRowCount: rows.length,
      storedRowCount: rows.length,
      columnCount: columns.length,
      duplicateRowCount: 0,
      emptyRowCount: 0,
      warnings: [],
      generatedAt: new Date().toISOString(),
    },
    status: "ready",
    analysis: null,
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------- Zod 结构校验(SPEC 11.4) ------------------------- */

describe("ChartSpecSchema · 结构校验(SPEC 11.4)", () => {
  it("合法 ChartSpec 通过", () => {
    const spec: ChartSpec = {
      id: "c1",
      title: "测试",
      type: "bar",
      xField: "客户",
      yField: "金额",
      agg: "sum",
    };
    expect(ChartSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("agg 必填,缺失拒绝", () => {
    const spec = {
      id: "c1",
      title: "测试",
      type: "bar",
      xField: "客户",
      yField: "金额",
      // agg 缺失
    };
    expect(ChartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("agg 非法值拒绝", () => {
    const spec = {
      id: "c1",
      title: "测试",
      type: "bar",
      xField: "客户",
      yField: "金额",
      agg: "median",
    };
    expect(ChartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("type 非法值拒绝", () => {
    const spec = {
      id: "c1",
      title: "测试",
      type: "radar",
      xField: "客户",
      yField: "金额",
      agg: "sum",
    };
    expect(ChartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("title 空字符串拒绝", () => {
    const spec = {
      id: "c1",
      title: "",
      type: "bar",
      xField: "客户",
      yField: "金额",
      agg: "sum",
    };
    expect(ChartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("limit 范围 1~50", () => {
    const valid = { id: "c1", title: "t", type: "bar", xField: "x", yField: "y", agg: "sum", limit: 10 };
    const tooSmall = { ...valid, limit: 0 };
    const tooBig = { ...valid, limit: 51 };
    expect(ChartSpecSchema.safeParse(valid).success).toBe(true);
    expect(ChartSpecSchema.safeParse(tooSmall).success).toBe(false);
    expect(ChartSpecSchema.safeParse(tooBig).success).toBe(false);
  });

  it("filterValidCharts 局部容错:跳过非法,保留合法", () => {
    const raws = [
      { id: "c1", title: "ok", type: "bar", xField: "x", yField: "y", agg: "sum" },
      { id: "c2", title: "bad", type: "radar", xField: "x", yField: "y", agg: "sum" },
      { id: "c3", title: "ok2", type: "line", xField: "x", yField: "y", agg: "avg" },
    ];
    const out = filterValidCharts(raws);
    expect(out.length).toBe(2);
    expect(out[0].id).toBe("c1");
    expect(out[1].id).toBe("c3");
  });

  it("v0.3 扩展图表类型可读", () => {
    for (const type of ["area", "stacked_bar", "scatter", "heatmap", "kpi"]) {
      const spec = { id: type, title: type, type, xField: "x", yField: "y", agg: "sum" };
      expect(ChartSpecSchema.safeParse(spec).success).toBe(true);
    }
  });
});

/* ------------------------- 聚合选择 ------------------------- */

describe("pickAgg · 聚合选择", () => {
  it("percentage 用 avg", () => {
    expect(pickAgg("percentage")).toBe("avg");
  });

  it("currency 用 sum", () => {
    expect(pickAgg("currency")).toBe("sum");
  });

  it("undefined 用 sum", () => {
    expect(pickAgg(undefined)).toBe("sum");
  });
});

/* ------------------------- 图表推荐 ------------------------- */

describe("recommendCharts · 本地推荐", () => {
  it("根据字段角色生成 line/bar/pie/table", () => {
    const profile = profileFields(salesColumns);
    const charts = recommendCharts(salesRows, profile, 8);
    expect(charts.some((c) => c.type === "line")).toBe(true);
    expect(charts.some((c) => c.type === "bar")).toBe(true);
    expect(charts.some((c) => c.type === "pie")).toBe(true);
    expect(charts.some((c) => c.type === "table")).toBe(true);
  });

  it("percentage metric 的趋势用 avg", () => {
    const profile = profileFields(salesColumns);
    const charts = recommendCharts(salesRows, profile, 8);
    const trend = charts.find((c) => c.type === "line" && c.yField === "转化率");
    expect(trend?.agg).toBe("avg");
  });

  it("maxCharts 限制数量", () => {
    const profile = profileFields(salesColumns);
    const charts = recommendCharts(salesRows, profile, 3);
    expect(charts.length).toBeLessThanOrEqual(3);
  });
});

/* ------------------------- 语义校验(SPEC 11.4 8 条) ------------------------- */

describe("semanticValidateCharts · 语义校验(SPEC 11.4)", () => {
  it("规则1: xField 不存在 → 跳过", () => {
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "bar", xField: "不存在", yField: "金额", agg: "sum" },
    ];
    const r = semanticValidateCharts(specs, salesColumns, salesRows);
    expect(r.charts.length).toBe(0);
    expect(r.issues.some((i) => i.message.includes("xField"))).toBe(true);
  });

  it("规则2: yField 不存在且非系统保留 → 跳过", () => {
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "bar", xField: "客户", yField: "不存在", agg: "sum" },
    ];
    const r = semanticValidateCharts(specs, salesColumns, salesRows);
    expect(r.charts.length).toBe(0);
    expect(r.issues.some((i) => i.message.includes("yField"))).toBe(true);
  });

  it("规则2: yField 为系统保留值 __count__ → 通过", () => {
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "bar", xField: "客户", yField: "__count__", agg: "count" },
    ];
    const r = semanticValidateCharts(specs, salesColumns, salesRows);
    expect(r.charts.length).toBe(1);
  });

  it("规则3: groupBy 不存在 → 跳过", () => {
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "bar", xField: "客户", yField: "金额", agg: "sum", groupBy: "不存在" },
    ];
    const r = semanticValidateCharts(specs, salesColumns, salesRows);
    expect(r.charts.length).toBe(0);
    expect(r.issues.some((i) => i.message.includes("groupBy"))).toBe(true);
  });

  it("规则4: line 的 yField 不可数值化 → 跳过", () => {
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "line", xField: "日期", yField: "客户", agg: "sum" },
    ];
    const r = semanticValidateCharts(specs, salesColumns, salesRows);
    expect(r.charts.length).toBe(0);
    expect(r.issues.some((i) => i.message.includes("不可数值化"))).toBe(true);
  });

  it("规则5: percentage + sum → 跳过", () => {
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "bar", xField: "客户", yField: "转化率", agg: "sum" },
    ];
    const r = semanticValidateCharts(specs, salesColumns, salesRows);
    expect(r.charts.length).toBe(0);
    expect(r.issues.some((i) => i.message.includes("百分比"))).toBe(true);
  });

  it("规则5: percentage + avg → 通过", () => {
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "bar", xField: "客户", yField: "转化率", agg: "avg" },
    ];
    const r = semanticValidateCharts(specs, salesColumns, salesRows);
    expect(r.charts.length).toBe(1);
  });

  it("规则6: identifier 作为 metric → 跳过", () => {
    const cols = [
      ...salesColumns,
      makeColumn({ name: "客户ID", type: "string", role: "identifier", format: "plain" }),
    ];
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "bar", xField: "客户", yField: "客户ID", agg: "sum" },
    ];
    const r = semanticValidateCharts(specs, cols, salesRows);
    expect(r.charts.length).toBe(0);
    expect(r.issues.some((i) => i.message.includes("identifier"))).toBe(true);
  });

  it("规则7: pie 类别超过 6 → 降级为 bar", () => {
    // 7 个不同客户
    const rows: DatasetRow[] = Array.from({ length: 7 }, (_, i) => ({
      客户: `客户${i}`,
      金额: (i + 1) * 100,
    }));
    const cols = [makeColumn({ name: "客户", type: "string", role: "dimension" }), makeColumn({ name: "金额" })];
    const specs: ChartSpec[] = [
      { id: "c1", title: "构成", type: "pie", xField: "客户", yField: "__count__", agg: "count" },
    ];
    const r = semanticValidateCharts(specs, cols, rows);
    expect(r.charts.length).toBe(1);
    expect(r.charts[0].type).toBe("bar"); // 降级
    expect(r.issues.some((i) => i.level === "warning" && i.message.includes("降级"))).toBe(true);
  });

  it("规则7: pie 类别 ≤ 6 → 保持 pie", () => {
    const rows: DatasetRow[] = Array.from({ length: 5 }, (_, i) => ({
      客户: `客户${i}`,
      金额: (i + 1) * 100,
    }));
    const cols = [makeColumn({ name: "客户", type: "string", role: "dimension" }), makeColumn({ name: "金额" })];
    const specs: ChartSpec[] = [
      { id: "c1", title: "构成", type: "pie", xField: "客户", yField: "__count__", agg: "count" },
    ];
    const r = semanticValidateCharts(specs, cols, rows);
    expect(r.charts.length).toBe(1);
    expect(r.charts[0].type).toBe("pie");
  });

  it("规则8: 局部容错,多图混合时只跳过非法", () => {
    const specs: ChartSpec[] = [
      { id: "c1", title: "ok", type: "bar", xField: "客户", yField: "金额", agg: "sum" },
      { id: "c2", title: "bad", type: "line", xField: "日期", yField: "客户", agg: "sum" },
      { id: "c3", title: "ok2", type: "bar", xField: "客户", yField: "转化率", agg: "avg" },
    ];
    const r = semanticValidateCharts(specs, salesColumns, salesRows);
    expect(r.charts.length).toBe(2);
    expect(r.charts.map((c) => c.id).sort()).toEqual(["c1", "c3"]);
  });
});

/* ------------------------- TopN 截断 ------------------------- */

describe("TopN 截断(SPEC 11.3)", () => {
  it("bar limit=10,类别 > 10 时只显示 Top 10", () => {
    const rows: DatasetRow[] = Array.from({ length: 15 }, (_, i) => ({
      客户: `客户${i}`,
      金额: (15 - i) * 100, // 客户0 金额最大
    }));
    const spec: ChartSpec = {
      id: "c1",
      title: "Top10",
      type: "bar",
      xField: "客户",
      yField: "金额",
      agg: "sum",
      limit: 10,
    };
    const opt = buildChartOption(spec, rows) as Record<string, unknown>;
    const xAxis = opt.xAxis as { data: string[] };
    expect(xAxis.data.length).toBe(10);
    // 按金额降序,客户0 应排第一
    expect(xAxis.data[0]).toBe("客户0");
  });

  it("line 不截断(时间序列需完整)", () => {
    const rows: DatasetRow[] = Array.from({ length: 15 }, (_, i) => ({
      日期: `2026-07-${String(i + 1).padStart(2, "0")}`,
      金额: i * 100,
    }));
    const spec: ChartSpec = {
      id: "c1",
      title: "趋势",
      type: "line",
      xField: "日期",
      yField: "金额",
      agg: "sum",
      limit: 10,
    };
    const opt = buildChartOption(spec, rows) as Record<string, unknown>;
    const xAxis = opt.xAxis as { data: string[] };
    expect(xAxis.data.length).toBe(15); // 不截断
  });

  it("语义校验自动补 limit=10(类别 > 10)", () => {
    const rows: DatasetRow[] = Array.from({ length: 15 }, (_, i) => ({
      客户: `客户${i}`,
      金额: i * 100,
    }));
    const cols = [makeColumn({ name: "客户", type: "string", role: "dimension" }), makeColumn({ name: "金额" })];
    const specs: ChartSpec[] = [
      { id: "c1", title: "t", type: "bar", xField: "客户", yField: "金额", agg: "sum" },
    ];
    const r = semanticValidateCharts(specs, cols, rows);
    expect(r.charts[0].limit).toBe(10);
  });
});

/* ------------------------- 图表排序(SPEC 11.5) ------------------------- */

describe("图表显示顺序(SPEC 11.5)", () => {
  it("顺序: line → bar → pie → table", () => {
    const profile = profileFields(salesColumns);
    const charts = recommendCharts(salesRows, profile, 8);
    const r = semanticValidateCharts(charts, salesColumns, salesRows);
    const types = r.charts.map((c) => c.type);
    const lineIdx = types.indexOf("line");
    const barIdx = types.indexOf("bar");
    const pieIdx = types.indexOf("pie");
    const tableIdx = types.indexOf("table");
    expect(lineIdx).toBeLessThan(barIdx);
    expect(barIdx).toBeLessThan(pieIdx);
    expect(pieIdx).toBeLessThan(tableIdx);
  });
});

/* ------------------------- 便捷入口 ------------------------- */

describe("recommendAndValidate · 便捷入口", () => {
  it("一站式: 推断画像 + 推荐 + 校验", () => {
    const r = recommendAndValidate(salesRows, salesColumns, 8);
    expect(r.charts.length).toBeGreaterThan(0);
    expect(r.charts.length).toBeLessThanOrEqual(8);
    // 所有图表应通过语义校验
    expect(r.charts.every((c) => c.agg)).toBe(true);
  });
});

/* ------------------------- runLocalAnalysis 集成 ------------------------- */

describe("runLocalAnalysis · 图表集成(SPEC 11)", () => {
  it("LocalAnalysis 包含 charts 与 chartIssues", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    expect(r.charts).toBeDefined();
    expect(r.charts.length).toBeGreaterThan(0);
    expect(r.chartIssues).toBeDefined();
    expect(Array.isArray(r.chartIssues)).toBe(true);
  });

  it("charts 数量 ≤ maxCharts", () => {
    const ds = makeDataset(salesRows, salesColumns);
    ds.config = {
      timeField: "日期",
      statusFields: ["运营状态"],
      metricFields: ["金额", "转化率"],
      ignoredFields: [],
      maxCharts: 4,
    };
    const r = runLocalAnalysis(ds);
    expect(r.charts.length).toBeLessThanOrEqual(4);
  });

  it("所有 charts 的 agg 必填", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    for (const c of r.charts) {
      expect(c.agg).toBeTruthy();
    }
  });

  it("charts 按 SPEC 11.5 排序", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    const types = r.charts.map((c) => c.type);
    const lineIdx = types.indexOf("line");
    const tableIdx = types.indexOf("table");
    if (lineIdx >= 0 && tableIdx >= 0) {
      expect(lineIdx).toBeLessThan(tableIdx);
    }
  });
});
