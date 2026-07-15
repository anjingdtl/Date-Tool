/**
 * tests/aggregation-flow.test.ts
 *
 * SPEC 8.9 / 18.3：用户聚合方式全链路生效。
 * 验证 resolveAggregation 单一入口 + aggregate 计算 + 贯穿 trend/comparison/chart，
 * 且 percentage+sum 等非法组合被拦截，图表 agg 与 evidence agg 一致。
 */

import { describe, it, expect } from "vitest";
import {
  resolveAggregation,
  isAllowedAgg,
  aggregate,
} from "@/lib/analysis/aggregation";
import { computeMetricTrend } from "@/lib/analysis/trends";
import { computeGroupComparison } from "@/lib/analysis/comparisons";
import { recommendAndValidate } from "@/lib/analysis/recommend-charts";
import type { ColumnMeta, DatasetRow } from "@/lib/types";

function col(over: Partial<ColumnMeta> & { name: string }): ColumnMeta {
  return {
    type: "string",
    role: "dimension",
    format: "plain",
    sampleValues: [],
    includeInAnalysis: true,
    // defaultAggregation 默认不设置，用于测试 fallback 规则
    ...over,
  };
}

describe("resolveAggregation - SPEC 8.2 / 8.3", () => {
  it("用户设置 avg 优先（响应时长）", () => {
    const c = col({
      name: "响应时长",
      type: "number",
      role: "metric",
      format: "duration",
      defaultAggregation: "avg",
    });
    expect(resolveAggregation(c, "trend")).toBe("avg");
  });

  it("金额 currency → sum", () => {
    const c = col({
      name: "金额",
      type: "number",
      role: "metric",
      format: "currency",
      defaultAggregation: "sum",
    });
    expect(resolveAggregation(c, "group")).toBe("sum");
  });

  it("客户 dimension → count", () => {
    const c = col({
      name: "客户",
      type: "string",
      role: "dimension",
      format: "plain",
      defaultAggregation: "count",
    });
    expect(resolveAggregation(c)).toBe("count");
  });

  it("满意度 max（用户设置生效）", () => {
    const c = col({
      name: "满意度",
      type: "number",
      role: "metric",
      format: "decimal",
      defaultAggregation: "max",
    });
    expect(resolveAggregation(c, "chart")).toBe("max");
  });

  it("duration 默认 avg（未设置 defaultAggregation）", () => {
    const c = col({
      name: "时长",
      type: "number",
      role: "metric",
      format: "duration",
    });
    expect(resolveAggregation(c)).toBe("avg");
  });

  it("percentage + sum 被拒绝 → 回退 avg", () => {
    const c = col({
      name: "转化率",
      type: "number",
      role: "metric",
      format: "percentage",
      defaultAggregation: "sum",
    });
    expect(isAllowedAgg(c, "sum")).toBe(false);
    expect(resolveAggregation(c)).toBe("avg");
  });

  it("identifier + avg 被拒绝 → count", () => {
    const c = col({
      name: "ID",
      type: "number",
      role: "identifier",
      format: "integer",
      defaultAggregation: "avg",
    });
    expect(isAllowedAgg(c, "avg")).toBe(false);
    expect(resolveAggregation(c)).toBe("count");
  });

  it("string + max 不允许", () => {
    const c = col({ name: "名", type: "string", format: "plain" });
    expect(isAllowedAgg(c, "max")).toBe(false);
  });

  it("count 对任意字段都允许", () => {
    expect(
      isAllowedAgg(col({ name: "x", type: "string" }), "count"),
    ).toBe(true);
    expect(
      isAllowedAgg(
        col({ name: "y", type: "number", role: "identifier" }),
        "count",
      ),
    ).toBe(true);
  });
});

describe("aggregate - SPEC 8.5", () => {
  it("sum / avg / count / max / min", () => {
    expect(aggregate([1, 2, 3], "sum")).toBe(6);
    expect(aggregate([1, 2, 3], "avg")).toBe(2);
    expect(aggregate([1, 2, 3], "count")).toBe(3);
    expect(aggregate([1, 2, 3], "max")).toBe(3);
    expect(aggregate([1, 2, 3], "min")).toBe(1);
    expect(aggregate([], "sum")).toBe(0);
  });
});

describe("聚合全链路 - SPEC 8.4 / 8.8", () => {
  it("computeMetricTrend 用 avg：值=均值", () => {
    const m = col({
      name: "响应时长",
      type: "number",
      role: "metric",
      format: "duration",
      defaultAggregation: "avg",
    });
    const rows: DatasetRow[] = [
      { d: "2026-07-01", 响应时长: 10 },
      { d: "2026-07-01", 响应时长: 20 }, // 同日两条 → avg 15
      { d: "2026-07-02", 响应时长: 30 },
    ];
    const t = computeMetricTrend(rows, "d", m);
    expect(t.agg).toBe("avg");
    const d1 = t.points.find((p) => p.label === "2026-07-01");
    expect(d1?.value).toBe(15); // (10+20)/2
  });

  it("computeGroupComparison 用 max", () => {
    const m = col({
      name: "满意度",
      type: "number",
      role: "metric",
      format: "decimal",
      defaultAggregation: "max",
    });
    const rows: DatasetRow[] = [
      { c: "甲", 满意度: 1 },
      { c: "甲", 满意度: 5 },
      { c: "乙", 满意度: 3 },
    ];
    const cmp = computeGroupComparison(rows, "c", m);
    expect(cmp.agg).toBe("max");
    expect(cmp.buckets.find((b) => b.label === "甲")?.value).toBe(5);
  });

  it("图表 agg 与 trend 计算的 agg 一致（SPEC 8.8）", () => {
    const cols = [
      col({
        name: "d",
        type: "date",
        role: "time",
        format: "date",
        defaultAggregation: "count",
      }),
      col({
        name: "响应时长",
        type: "number",
        role: "metric",
        format: "duration",
        defaultAggregation: "avg",
      }),
    ];
    const rows: DatasetRow[] = [{ d: "2026-07-01", 响应时长: 10 }];
    const { charts } = recommendAndValidate(rows, cols, 5);
    const trendChart = charts.find((c) => c.type === "line");
    expect(trendChart?.agg).toBe("avg");
    const t = computeMetricTrend(rows, "d", cols[1]);
    // 图表 agg 与同一字段的 trend agg 必须一致（不得图表 avg 而 evidence sum）
    expect(t.agg).toBe(trendChart!.agg);
  });

  it("percentage + sum 在图表推荐时被拦截为 avg（SPEC 8.6）", () => {
    const cols = [
      col({
        name: "客户",
        type: "string",
        role: "dimension",
        format: "plain",
        defaultAggregation: "count",
      }),
      col({
        name: "转化率",
        type: "number",
        role: "metric",
        format: "percentage",
        defaultAggregation: "sum", // 非法组合
      }),
    ];
    const rows: DatasetRow[] = [
      { 客户: "甲", 转化率: 0.5 },
      { 客户: "乙", 转化率: 0.6 },
    ];
    const { charts } = recommendAndValidate(rows, cols, 5);
    const bar = charts.find((c) => c.type === "bar" && c.yField === "转化率");
    expect(bar).toBeDefined();
    expect(bar!.agg).toBe("avg"); // sum 被拦截，回退 avg
  });

  it("count 聚合不要求 yField 为数值（分布图）", () => {
    const cols = [
      col({
        name: "客户",
        type: "string",
        role: "dimension",
        format: "plain",
        defaultAggregation: "count",
      }),
    ];
    const rows: DatasetRow[] = [{ 客户: "甲" }, { 客户: "乙" }, { 客户: "甲" }];
    const { charts } = recommendAndValidate(rows, cols, 5);
    // 字符串字段可用 count 聚合
    const c = col({ name: "客户", type: "string", role: "dimension" });
    expect(resolveAggregation(c)).toBe("count");
    expect(charts.length).toBeGreaterThan(0);
  });
});
