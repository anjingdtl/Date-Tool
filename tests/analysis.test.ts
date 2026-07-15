import { describe, it, expect } from "vitest";
import {
  computeNumericStats,
  quantile,
  formatNumber,
  formatRate,
  extractNumbers,
} from "@/lib/analysis/statistics";
import {
  computeCategoryStats,
  isLowCardinality,
  profileFields,
} from "@/lib/analysis/profile";
import {
  computeMetricTrend,
  computeTrends,
  pickGranularity,
  pickTrendAgg,
} from "@/lib/analysis/trends";
import {
  computeGroupComparison,
  pickComparisonAgg,
} from "@/lib/analysis/comparisons";
import { detectOutliers } from "@/lib/analysis/outliers";
import { runLocalAnalysis } from "@/lib/analysis";
import { recommendCharts } from "@/lib/analysis/recommend-charts";
import type {
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
  over: Partial<StoredDataset> = {},
): StoredDataset {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    name: over.name ?? "测试集",
    fileName: over.fileName ?? "test.csv",
    source: over.source ?? "csv",
    rowCount: rows.length,
    originalRowCount: over.originalRowCount ?? rows.length,
    storedRowCount: over.storedRowCount ?? rows.length,
    columns,
    rows,
    quality: over.quality ?? {
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

/* ------------------------- 基础统计 ------------------------- */

describe("statistics · 基础统计(SPEC 10.2)", () => {
  it("extractNumbers 跳过空值与非数字", () => {
    const rows: DatasetRow[] = [
      { a: 1 }, { a: 2 }, { a: null }, { a: "" }, { a: "x" }, { a: 3 },
    ];
    const { values, nullCount } = extractNumbers(rows, "a");
    expect(values).toEqual([1, 2, 3]);
    expect(nullCount).toBe(3);
  });

  it("computeNumericStats 计算 count/sum/avg/min/max/median/p25/p75/std/零负值", () => {
    const rows: DatasetRow[] = [
      { a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }, { a: 5 }, { a: 0 }, { a: -1 },
    ];
    const s = computeNumericStats(rows, "a");
    expect(s.count).toBe(8);
    expect(s.sum).toBe(19);
    expect(s.avg).toBeCloseTo(2.375, 3);
    expect(s.min).toBe(-1);
    expect(s.max).toBe(5);
    expect(s.median).toBe(2.5); // 排序 [-1,0,1,2,3,4,5,5],中位 (2+3)/2=2.5
    expect(s.zeroCount).toBe(1);
    expect(s.negativeCount).toBe(1);
    expect(s.nullCount).toBe(0);
    expect(s.nullRate).toBe(0);
  });

  it("空字段返回全 0", () => {
    const s = computeNumericStats([], "a");
    expect(s.count).toBe(0);
    expect(s.sum).toBe(0);
    expect(s.median).toBe(0);
  });

  it("单元素标准差为 0", () => {
    const s = computeNumericStats([{ a: 5 }], "a");
    expect(s.std).toBe(0);
  });

  it("quantile 边界值", () => {
    expect(quantile([10], 0.5)).toBe(10);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("formatNumber 与 formatRate", () => {
    expect(formatNumber(100)).toBe("100");
    expect(formatNumber(3.14159)).toBe("3.14");
    expect(formatNumber(NaN)).toBe("N/A");
    expect(formatRate(0.125)).toBe("12.50%");
  });
});

/* ------------------------- 字段画像 ------------------------- */

describe("profile · 字段画像(SPEC 10.3)", () => {
  it("computeCategoryStats 计算 distinctCount/Top/Bottom/占比/长尾", () => {
    const rows: DatasetRow[] = [
      { c: "甲" }, { c: "甲" }, { c: "乙" }, { c: "丙" }, { c: "丁" }, { c: "戊" },
    ];
    const s = computeCategoryStats(rows, "c", 3, 2);
    expect(s.distinctCount).toBe(5);
    expect(s.total).toBe(6);
    expect(s.nullCount).toBe(0);
    expect(s.top[0]).toEqual({ value: "甲", count: 2, rate: 2 / 6 });
    expect(s.top.length).toBe(3);
    expect(s.bottom.length).toBe(2);
    // Top3 是 甲2+乙1+丙1=4,长尾 丁1+戊1=2,占比 2/6
    expect(s.longTailRate).toBeCloseTo(2 / 6, 3);
  });

  it("isLowCardinality 阈值判断", () => {
    const s = computeCategoryStats(
      Array.from({ length: 40 }, (_, i) => ({ c: `v${i}` })),
      "c",
    );
    expect(isLowCardinality(s, 30)).toBe(false);
    expect(isLowCardinality(s, 50)).toBe(true);
  });

  it("profileFields 按 role 筛选", () => {
    const p = profileFields(salesColumns);
    expect(p.timeField?.name).toBe("日期");
    expect(p.primaryDimension?.name).toBe("客户");
    expect(p.statusFields.map((s) => s.name)).toEqual(["运营状态"]);
    expect(p.metricFields.map((m) => m.name)).toEqual(["金额", "转化率"]);
  });

  it("profileFields 排除 includeInAnalysis=false", () => {
    const cols = salesColumns.map((c) =>
      c.name === "转化率" ? { ...c, includeInAnalysis: false } : c,
    );
    const p = profileFields(cols);
    expect(p.metricFields.map((m) => m.name)).toEqual(["金额"]);
  });
});

/* ------------------------- 时间趋势 ------------------------- */

describe("trends · 时间趋势(SPEC 10.4)", () => {
  it("pickGranularity 根据跨度选择", () => {
    expect(pickGranularity(["2026-07-01", "2026-07-10"])).toBe("day");
    expect(pickGranularity(["2026-01-01", "2026-06-01"])).toBe("week");
    expect(pickGranularity(["2024-01-01", "2026-12-31"])).toBe("month");
  });

  it("pickTrendAgg 根据 format 选择", () => {
    expect(pickTrendAgg("percentage")).toBe("avg");
    expect(pickTrendAgg("currency")).toBe("sum");
    expect(pickTrendAgg("integer")).toBe("sum");
    expect(pickTrendAgg(undefined)).toBe("sum");
  });

  it("computeMetricTrend currency 用 sum,计算首末期与变化率", () => {
    const metric = salesColumns[2]; // 金额 currency
    const t = computeMetricTrend(salesRows, "日期", metric);
    expect(t.agg).toBe("sum");
    expect(t.granularity).toBe("day");
    expect(t.points.length).toBe(10);
    expect(t.first).toBe(100);
    expect(t.last).toBe(1000);
    expect(t.absoluteChange).toBe(900);
    expect(t.changeRate).toBeCloseTo(9, 3); // (1000-100)/100=9
    expect(t.sampleSize).toBe(10);
  });

  it("computeMetricTrend percentage 用 avg", () => {
    const metric = salesColumns[3]; // 转化率 percentage
    const t = computeMetricTrend(salesRows, "日期", metric);
    expect(t.agg).toBe("avg");
    // 每天 1 条,avg 等于原值
    expect(t.first).toBeCloseTo(0.1, 3);
    expect(t.last).toBeCloseTo(1.0, 3);
  });

  it("首期为 0 时 changeRate 为 null(分母为 0 保护)", () => {
    const rows: DatasetRow[] = [
      { d: "2026-07-01", m: 0 },
      { d: "2026-07-02", m: 100 },
    ];
    const t = computeMetricTrend(rows, "d", makeColumn({ name: "m" }));
    expect(t.absoluteChange).toBe(100);
    expect(t.changeRate).toBeNull();
  });

  it("样本不足 2 周期时不生成变化率", () => {
    const rows: DatasetRow[] = [{ d: "2026-07-01", m: 5 }];
    const t = computeMetricTrend(rows, "d", makeColumn({ name: "m" }));
    expect(t.points.length).toBe(1);
    expect(t.absoluteChange).toBeNull();
    expect(t.changeRate).toBeNull();
  });

  it("computeTrends 批量", () => {
    const ts = computeTrends(
      salesRows,
      "日期",
      salesColumns.slice(2, 4),
    );
    expect(ts.length).toBe(2);
    expect(ts[0].field).toBe("金额");
    expect(ts[1].field).toBe("转化率");
  });
});

/* ------------------------- 分组对比 ------------------------- */

describe("comparisons · 分组对比(SPEC 10.5)", () => {
  it("pickComparisonAgg 根据 format", () => {
    expect(pickComparisonAgg("percentage")).toBe("avg");
    expect(pickComparisonAgg("currency")).toBe("sum");
  });

  it("computeGroupComparison 金额 sum Top10 降序", () => {
    const cmp = computeGroupComparison(
      salesRows,
      "客户",
      salesColumns[2],
    );
    expect(cmp.agg).toBe("sum");
    expect(cmp.dimension).toBe("客户");
    expect(cmp.top10.length).toBe(3); // 3 个客户
    // 甲:100+300+500+800=1700 乙:200+600+900=1700 丙:400+700+1000=2100
    expect(cmp.top10[0].label).toBe("丙公司");
    expect(cmp.top10[0].value).toBe(2100);
    expect(cmp.sampleSize).toBe(10);
    expect(cmp.highCardinality).toBe(false);
  });

  it("computeGroupComparison 转化率 avg", () => {
    const cmp = computeGroupComparison(
      salesRows,
      "客户",
      salesColumns[3],
    );
    expect(cmp.agg).toBe("avg");
    // 甲:(0.1+0.3+0.5+0.8)/4=0.425
    expect(cmp.top10.find((b) => b.label === "甲公司")?.value).toBeCloseTo(0.425, 3);
  });

  it("空维度值跳过", () => {
    const rows: DatasetRow[] = [
      { c: "甲", m: 1 }, { c: "", m: 2 }, { c: null, m: 3 }, { c: "甲", m: 4 },
    ];
    const cmp = computeGroupComparison(rows, "c", makeColumn({ name: "m" }));
    expect(cmp.buckets.length).toBe(1);
    expect(cmp.buckets[0].label).toBe("甲");
    expect(cmp.buckets[0].count).toBe(2);
  });
});

/* ------------------------- 异常值 ------------------------- */

describe("outliers · IQR 异常值(SPEC 10.7)", () => {
  it("样本 < 8 不检测", () => {
    const rows: DatasetRow[] = Array.from({ length: 7 }, (_, i) => ({ a: i }));
    const r = detectOutliers(rows, "a");
    expect(r.detected).toBe(false);
    expect(r.outlierCount).toBe(0);
    expect(r.samples).toEqual([]);
  });

  it("样本 ≥ 8 检测,返回上下界与异常数", () => {
    const rows: DatasetRow[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ a: i + 1 })), // 1~8
      { a: 1000 }, // 明显异常
    ];
    const r = detectOutliers(rows, "a");
    expect(r.detected).toBe(true);
    expect(r.outlierCount).toBe(1);
    expect(r.samples.length).toBe(1);
    expect(r.samples[0].value).toBe(1000);
    expect(r.samples[0].direction).toBe("upper");
    expect(r.upperBound).toBeLessThan(1000);
  });

  it("最多返回 5 个样本", () => {
    // 20 个正常值 1~20 + 8 个异常值 1000
    // sorted: [1..20, 1000×8], n=28, Q1 位置 27×0.25=6.75 → 7, Q3 位置 27×0.75=20.25 → 1000(第21个值)
    // 为避免 Q3 被异常值污染,异常值必须少于 25%
    // 改用 30 个正常 + 6 个异常:n=36, Q3 位置 35×0.75=26.25 → 27(正常区间), 上界合理
    const rows: DatasetRow[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ a: i + 1 })),
      ...Array.from({ length: 6 }, () => ({ a: 1000 })),
    ];
    const r = detectOutliers(rows, "a");
    expect(r.outlierCount).toBe(6);
    expect(r.samples.length).toBe(5); // 最多 5
    expect(r.samples.every((s) => s.value === 1000)).toBe(true);
  });

  it("无异常时 outlierCount=0", () => {
    const rows: DatasetRow[] = Array.from({ length: 20 }, (_, i) => ({ a: i }));
    const r = detectOutliers(rows, "a");
    expect(r.outlierCount).toBe(0);
    expect(r.samples).toEqual([]);
  });
});

/* ------------------------- 总入口 + evidence 引用 ------------------------- */

describe("runLocalAnalysis · 总入口(SPEC 10.8)", () => {
  it("生成 evidence + insights,每条 insight 引用 evidenceId", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);

    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.insights.length).toBeGreaterThan(0);

    const evIds = new Set(r.evidence.map((e) => e.id));
    for (const ins of r.insights) {
      expect(ins.evidenceId).toBeTruthy();
      expect(evIds.has(ins.evidenceId)).toBe(true);
    }
  });

  it("包含基础统计 evidence(金额、转化率)", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    const fields = r.numericStats.map((s) => s.field);
    expect(fields).toContain("金额");
    expect(fields).toContain("转化率");
  });

  it("包含趋势(有 time 字段)", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    expect(r.trends.length).toBe(2); // 金额 + 转化率
    expect(r.trends[0].points.length).toBe(10);
  });

  it("包含分组对比(主维度 客户)", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    expect(r.comparisons.length).toBe(2);
    expect(r.comparisons[0].dimension).toBe("客户");
  });

  it("包含状态分析(运营状态)并识别预警", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    expect(r.statusAnalyses.length).toBe(1);
    const sa = r.statusAnalyses[0];
    expect(sa.field).toBe("运营状态");
    expect(sa.warnCount).toBe(3); // 3 条"预警"
    expect(sa.warnRate).toBeCloseTo(0.3, 3);
    // 应有预警占比洞察
    const warnInsight = r.insights.find((i) =>
      i.title.includes("预警占比"),
    );
    expect(warnInsight).toBeTruthy();
    expect(warnInsight?.level).toBe("warning");
  });

  it("状态分析含 metricDiff(预警组 vs 正常组)", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    const sa = r.statusAnalyses[0];
    expect(sa.metricDiff).toBeDefined();
    expect(sa.metricDiff?.metric).toBe("金额");
  });

  it("截断数据集生成截断洞察", () => {
    const ds = makeDataset(salesRows, salesColumns, {
      originalRowCount: 1000,
      storedRowCount: 10,
      quality: {
        originalRowCount: 1000,
        storedRowCount: 10,
        columnCount: 5,
        duplicateRowCount: 0,
        emptyRowCount: 0,
        warnings: [],
        generatedAt: new Date().toISOString(),
      },
    });
    const r = runLocalAnalysis(ds);
    const truncInsight = r.insights.find((i) =>
      i.title.includes("截断"),
    );
    expect(truncInsight).toBeTruthy();
    expect(truncInsight?.statement).toContain("1000");
    expect(truncInsight?.statement).toContain("10");
    expect(truncInsight?.statement).toContain("已载入数据");
  });

  it("重复行生成重复行洞察", () => {
    const ds = makeDataset(salesRows, salesColumns, {
      quality: {
        originalRowCount: 10,
        storedRowCount: 10,
        columnCount: 5,
        duplicateRowCount: 3,
        emptyRowCount: 0,
        warnings: [],
        generatedAt: new Date().toISOString(),
      },
    });
    const r = runLocalAnalysis(ds);
    const dupInsight = r.insights.find((i) =>
      i.title.includes("重复行"),
    );
    expect(dupInsight).toBeTruthy();
    expect(dupInsight?.statement).toContain("3");
  });

  it("evidence 含 method 字段,可追溯计算方法", () => {
    const ds = makeDataset(salesRows, salesColumns);
    const r = runLocalAnalysis(ds);
    const methods = new Set(r.evidence.map((e) => e.method));
    expect(methods.has("summary")).toBe(true);
    expect(methods.has("trend")).toBe(true);
    expect(methods.has("group_compare")).toBe(true);
    expect(methods.has("status_distribution")).toBe(true);
    expect(methods.has("outlier")).toBe(true);
  });
});

/* ------------------------- 图表推荐 ------------------------- */

describe("recommendCharts · 本地推荐(SPEC 11 草案)", () => {
  it("根据字段角色生成图表", () => {
    const profile = profileFields(salesColumns);
    const charts = recommendCharts(salesRows, profile, 8);
    expect(charts.length).toBeGreaterThan(0);
    // 应有趋势线图
    expect(charts.some((c) => c.type === "line")).toBe(true);
    // 应有对比柱图
    expect(charts.some((c) => c.type === "bar")).toBe(true);
    // 应有状态饼图
    expect(charts.some((c) => c.type === "pie")).toBe(true);
    // 应有原始数据表
    expect(charts.some((c) => c.type === "table")).toBe(true);
  });

  it("percentage metric 的趋势用 avg", () => {
    const profile = profileFields(salesColumns);
    const charts = recommendCharts(salesRows, profile, 8);
    const trendChart = charts.find(
      (c) => c.type === "line" && c.yField === "转化率",
    );
    expect(trendChart).toBeTruthy();
    expect(trendChart?.agg).toBe("avg");
  });

  it("currency metric 的对比用 sum", () => {
    const profile = profileFields(salesColumns);
    const charts = recommendCharts(salesRows, profile, 8);
    const cmpChart = charts.find(
      (c) => c.type === "bar" && c.yField === "金额",
    );
    expect(cmpChart).toBeTruthy();
    expect(cmpChart?.agg).toBe("sum");
  });

  it("maxCharts 限制图表数量", () => {
    const profile = profileFields(salesColumns);
    const charts = recommendCharts(salesRows, profile, 4);
    expect(charts.length).toBeLessThanOrEqual(4);
  });
});
