/**
 * lib/analysis/comparisons.ts
 *
 * 分组对比（SPEC 10.5）。纯函数,确定性计算。
 *
 * 规则：
 * - 对每个核心 metric 按主维度聚合；
 * - 生成 Top 10；
 * - 高基数字段不直接生成全量图(由调用方判断,本模块只负责计算)；
 * - 根据 metric 格式选择 sum 或 avg；
 * - 记录聚合方法和样本数。
 */

import type { ColumnMeta, DatasetRow, FieldFormat } from "@/lib/types";

export interface GroupBucket {
  /** 维度取值(规范化为字符串) */
  label: string;
  /** 聚合后的数值 */
  value: number;
  /** 该桶样本数 */
  count: number;
}

export interface GroupComparison {
  metric: string;
  dimension: string;
  agg: "sum" | "avg";
  buckets: GroupBucket[];
  top10: GroupBucket[];
  sampleSize: number;
  /** 高基数标记(distinctCount > 30) */
  highCardinality: boolean;
}

/** 根据 metric 的 format 选择聚合方式 */
export function pickComparisonAgg(
  format: FieldFormat | undefined,
): "sum" | "avg" {
  if (format === "percentage") return "avg";
  return "sum";
}

function toKey(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * 按主维度对单个 metric 聚合。
 *
 * @param rows 行集
 * @param dimension 维度字段名
 * @param metric metric ColumnMeta
 * @param distinctCount 维度的 distinctCount(用于高基数判断,可选)
 */
export function computeGroupComparison(
  rows: DatasetRow[],
  dimension: string,
  metric: ColumnMeta,
  distinctCount?: number,
): GroupComparison {
  const agg = pickComparisonAgg(metric.format);
  const groups = new Map<string, number[]>();

  for (const r of rows) {
    const key = toKey(r[dimension]);
    if (!key) continue; // 空维度值跳过
    const v = r[metric.name];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }

  const buckets: GroupBucket[] = [];
  for (const [label, arr] of groups) {
    const value =
      agg === "sum"
        ? arr.reduce((a, b) => a + b, 0)
        : arr.reduce((a, b) => a + b, 0) / arr.length;
    buckets.push({ label, value, count: arr.length });
  }

  // 默认按 value 降序
  buckets.sort((a, b) => b.value - a.value);
  const top10 = buckets.slice(0, 10);
  const sampleSize = buckets.reduce((s, b) => s + b.count, 0);

  return {
    metric: metric.name,
    dimension,
    agg,
    buckets,
    top10,
    sampleSize,
    highCardinality: (distinctCount ?? buckets.length) > 30,
  };
}

/** 批量计算多个 metric 在同一维度下的对比 */
export function computeComparisons(
  rows: DatasetRow[],
  dimension: string,
  metrics: ColumnMeta[],
  distinctCount?: number,
): GroupComparison[] {
  return metrics.map((m) =>
    computeGroupComparison(rows, dimension, m, distinctCount),
  );
}
