/**
 * lib/analysis/statistics.ts
 *
 * 确定性基础统计（SPEC 10.2）。纯函数,所有数值由代码计算,LLM 不得介入。
 *
 * 每个 metric 字段计算：
 * - 有效样本数
 * - 空值数与空值率
 * - sum / avg / min / max
 * - median / P25 / P75
 * - 标准差
 * - 零值数量 / 负值数量
 */

import type { DatasetRow } from "@/lib/types";

export interface NumericStats {
  field: string;
  count: number;
  nullCount: number;
  nullRate: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  median: number;
  p25: number;
  p75: number;
  std: number;
  zeroCount: number;
  negativeCount: number;
}

/**
 * 从行集中抽取一个字段的所有有限数值。
 * 非数字、null、undefined、空字符串一律视为缺失。
 */
export function extractNumbers(
  rows: DatasetRow[],
  field: string,
): { values: number[]; nullCount: number } {
  const values: number[] = [];
  let nullCount = 0;
  for (const r of rows) {
    const v = r[field];
    if (v === null || v === undefined || v === "") {
      nullCount++;
      continue;
    }
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) values.push(n);
    else nullCount++;
  }
  return { values, nullCount };
}

/** 计算分位数（线性插值法,与 numpy.percentile 默认一致) */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** 计算单个数值字段的全量统计 */
export function computeNumericStats(
  rows: DatasetRow[],
  field: string,
): NumericStats {
  const { values, nullCount } = extractNumbers(rows, field);
  const total = rows.length || 1;
  const count = values.length;

  if (count === 0) {
    return {
      field,
      count: 0,
      nullCount,
      nullRate: nullCount / total,
      sum: 0,
      avg: 0,
      min: 0,
      max: 0,
      median: 0,
      p25: 0,
      p75: 0,
      std: 0,
      zeroCount: 0,
      negativeCount: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / count;
  const min = sorted[0];
  const max = sorted[count - 1];
  const median = quantile(sorted, 0.5);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);

  // 样本标准差（除以 n-1,n=1 时为 0）
  let std = 0;
  if (count > 1) {
    let sqSum = 0;
    for (const v of sorted) {
      const d = v - avg;
      sqSum += d * d;
    }
    std = Math.sqrt(sqSum / (count - 1));
  }

  let zeroCount = 0;
  let negativeCount = 0;
  for (const v of sorted) {
    if (v === 0) zeroCount++;
    else if (v < 0) negativeCount++;
  }

  return {
    field,
    count,
    nullCount,
    nullRate: nullCount / total,
    sum,
    avg,
    min,
    max,
    median,
    p25,
    p75,
    std,
    zeroCount,
    negativeCount,
  };
}

/** 批量计算多个数值字段 */
export function computeNumericStatsBatch(
  rows: DatasetRow[],
  fields: string[],
): NumericStats[] {
  return fields.map((f) => computeNumericStats(rows, f));
}

/** 把数值格式化为简短字符串(供洞察文案使用) */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "N/A";
  if (Number.isInteger(n)) return String(n);
  // 小数保留 2 位,去掉尾零
  return Number(n.toFixed(2)).toString();
}

/** 格式化百分比(0.12 → "12.00%") */
export function formatRate(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}
