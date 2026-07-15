/**
 * lib/analysis/profile.ts
 *
 * 字段画像与维度统计（SPEC 10.3）。
 *
 * 维度/状态字段计算：
 * - distinctCount
 * - Top 10 / Bottom 10
 * - 各取值计数与占比
 * - 空值数量
 * - 长尾比例（Top 3 之外的占比）
 */

import type { ColumnMeta, DatasetRow } from "@/lib/types";

export interface CategoryEntry {
  value: string;
  count: number;
  rate: number;
}

export interface CategoryStats {
  field: string;
  distinctCount: number;
  nullCount: number;
  total: number;
  top: CategoryEntry[];
  bottom: CategoryEntry[];
  /** Top 3 之外的长尾占比 */
  longTailRate: number;
}

/** 把任意值规范化为可比较的字符串键 */
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

export function computeCategoryStats(
  rows: DatasetRow[],
  field: string,
  topN = 10,
  bottomN = 10,
): CategoryStats {
  const counts = new Map<string, { value: string; count: number }>();
  let nullCount = 0;
  const total = rows.length;

  for (const r of rows) {
    const v = r[field];
    if (v === null || v === undefined || v === "") {
      nullCount++;
      continue;
    }
    const key = toKey(v);
    const prev = counts.get(key);
    if (prev) prev.count++;
    else counts.set(key, { value: key, count: 1 });
  }

  const entries = [...counts.values()].sort((a, b) => b.count - a.count);
  const validTotal = total - nullCount || 1;

  const toCat = (e: { value: string; count: number }): CategoryEntry => ({
    value: e.value,
    count: e.count,
    rate: e.count / validTotal,
  });

  const top = entries.slice(0, topN).map(toCat);
  // Bottom：计数升序,但只在 distinctCount > topN 时才有意义
  const bottom =
    entries.length > topN
      ? [...entries].sort((a, b) => a.count - b.count).slice(0, bottomN).map(toCat)
      : [];

  // 长尾比例：Top 3 之外的占比
  const top3Count = entries
    .slice(0, 3)
    .reduce((sum, e) => sum + e.count, 0);
  const longTailRate = (validTotal - top3Count) / validTotal;

  return {
    field,
    distinctCount: entries.length,
    nullCount,
    total,
    top,
    bottom,
    longTailRate,
  };
}

/** 判断字段是否低基数(适合作为分组维度) */
export function isLowCardinality(stats: CategoryStats, max = 30): boolean {
  return stats.distinctCount <= max;
}

/* ------------------------- 字段角色筛选 ------------------------- */

export interface FieldProfile {
  /** 时间字段(最多取第一个) */
  timeField: ColumnMeta | null;
  /** 主维度(低基数的 dimension,取第一个) */
  primaryDimension: ColumnMeta | null;
  /** 状态字段列表 */
  statusFields: ColumnMeta[];
  /** 指标字段列表(纳入分析的 metric) */
  metricFields: ColumnMeta[];
  /** 标识字段列表 */
  identifierFields: ColumnMeta[];
  /** 忽略字段列表 */
  ignoredFields: ColumnMeta[];
  /** 所有纳入分析的字段 */
  activeFields: ColumnMeta[];
}

/** 根据 ColumnMeta.role 筛选并组织字段画像 */
export function profileFields(
  columns: ColumnMeta[],
): FieldProfile {
  const active = columns.filter((c) => c.includeInAnalysis !== false);

  const timeFields = active.filter((c) => c.role === "time");
  const dims = active.filter((c) => c.role === "dimension");
  const statuses = active.filter((c) => c.role === "status");
  const metrics = active.filter((c) => c.role === "metric");
  const identifiers = active.filter((c) => c.role === "identifier");
  const ignored = columns.filter((c) => c.role === "ignored");

  return {
    timeField: timeFields[0] ?? null,
    // 主维度优先选低基数的 dimension,具体筛选留给调用方根据 CategoryStats 判断
    primaryDimension: dims[0] ?? null,
    statusFields: statuses,
    metricFields: metrics,
    identifierFields: identifiers,
    ignoredFields: ignored,
    activeFields: active,
  };
}
