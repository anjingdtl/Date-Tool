/**
 * lib/analysis/trends.ts
 *
 * 时间趋势分析（SPEC 10.4）。纯函数,确定性计算。
 *
 * 规则：
 * - 按自然粒度决定日/周/月；
 * - 默认按时间升序；
 * - 对每个核心 metric 生成趋势；
 * - 计算首期值、末期值、绝对变化、变化率；
 * - 样本不足 2 个周期时不生成变化率；
 * - 分母为 0 时不得生成无穷值；
 * - percentage 用 avg；count/currency 默认 sum。
 */

import type { Aggregation, ColumnMeta, DatasetRow, FieldFormat } from "@/lib/types";
import { quantile } from "./statistics";
import { resolveAggregation, aggregate } from "./aggregation";

export type TrendGranularity = "day" | "week" | "month";

export interface TrendPoint {
  /** 周期标签,如 "2026-07-01" 或 "2026-W27" 或 "2026-07" */
  label: string;
  /** 该周期聚合后的数值 */
  value: number;
  /** 该周期样本数 */
  count: number;
}

export interface MetricTrend {
  field: string;
  granularity: TrendGranularity;
  agg: Aggregation;
  points: TrendPoint[];
  first: number | null;
  last: number | null;
  /** 末期 - 首期 */
  absoluteChange: number | null;
  /** (last - first) / |first|,分母为 0 时为 null */
  changeRate: number | null;
  sampleSize: number;
}

/** 把日期值规范化为 ISO 8601 YYYY-MM-DD(已规范化的原样返回) */
function toDateStr(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v);
  // 已是 ISO 日期
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // 兼容 2026/7/3 这类(理论上 parse 阶段已规范化,这里兜底)
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** ISO 周号计算(返回 YYYY-Www) */
function isoWeek(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO 周:周四决定年份
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum =
    Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * 根据时间跨度自动选择粒度：
 * - ≤ 31 天 → day
 * - ≤ 365 天 → week
 * - 否则 → month
 */
export function pickGranularity(
  dateStrs: string[],
): TrendGranularity {
  if (dateStrs.length === 0) return "day";
  const sorted = [...dateStrs].sort();
  const first = new Date(sorted[0]);
  const last = new Date(sorted[sorted.length - 1]);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) {
    return "day";
  }
  const spanDays = (last.getTime() - first.getTime()) / 86400000;
  if (spanDays <= 31) return "day";
  if (spanDays <= 365) return "week";
  return "month";
}

function periodLabel(dateStr: string, g: TrendGranularity): string {
  switch (g) {
    case "day":
      return dateStr;
    case "week":
      return isoWeek(dateStr);
    case "month":
      return monthKey(dateStr);
  }
}

/** 根据 metric 的 format 选择聚合（兼容入口，规则统一委托 resolveAggregation，SPEC 8.4） */
export function pickTrendAgg(format: FieldFormat | undefined): Aggregation {
  return resolveAggregation(
    { name: "", type: "number", sampleValues: [], format } as ColumnMeta,
    "trend",
  );
}

/**
 * 计算单个 metric 的时间趋势。
 *
 * @param rows 行集
 * @param timeField 时间字段名
 * @param metric 要计算的 metric ColumnMeta
 * @returns MetricTrend,样本不足 2 周期时 first/last/change 仍返回但 changeRate 可能为 null
 */
export function computeMetricTrend(
  rows: DatasetRow[],
  timeField: string,
  metric: ColumnMeta,
): MetricTrend {
  const agg = resolveAggregation(metric, "trend");
  const buckets = new Map<string, number[]>();

  for (const r of rows) {
    const dstr = toDateStr(r[timeField]);
    if (!dstr) continue;
    const v = r[metric.name];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    const label = periodLabel(dstr, "day"); // 先按日分桶,后面再聚合
    const arr = buckets.get(label);
    if (arr) arr.push(n);
    else buckets.set(label, [n]);
  }

  // 决定粒度
  const dayLabels = [...buckets.keys()].sort();
  const granularity = pickGranularity(dayLabels);

  // 按目标粒度再聚合
  const periodMap = new Map<string, number[]>();
  for (const dayLabel of dayLabels) {
    const target = periodLabel(dayLabel, granularity);
    const arr = buckets.get(dayLabel);
    if (!arr) continue;
    const prev = periodMap.get(target);
    if (prev) prev.push(...arr);
    else periodMap.set(target, [...arr]);
  }

  const sortedPeriods = [...periodMap.keys()].sort();
  const points: TrendPoint[] = sortedPeriods.map((label) => {
    const arr = periodMap.get(label)!;
    const value = aggregate(arr, agg);
    return { label, value, count: arr.length };
  });

  const sampleSize = points.reduce((s, p) => s + p.count, 0);
  const first = points.length > 0 ? points[0].value : null;
  const last = points.length > 0 ? points[points.length - 1].value : null;

  let absoluteChange: number | null = null;
  let changeRate: number | null = null;
  if (points.length >= 2 && first !== null && last !== null) {
    absoluteChange = last - first;
    // 分母为 0 时不生成无穷值
    if (first !== 0) {
      changeRate = (last - first) / Math.abs(first);
    }
  }

  return {
    field: metric.name,
    granularity,
    agg,
    points,
    first,
    last,
    absoluteChange,
    changeRate,
    sampleSize,
  };
}

/** 批量计算多个 metric 的趋势 */
export function computeTrends(
  rows: DatasetRow[],
  timeField: string,
  metrics: ColumnMeta[],
): MetricTrend[] {
  return metrics.map((m) => computeMetricTrend(rows, timeField, m));
}

// 重新导出 quantile 供其它模块使用
export { quantile };
