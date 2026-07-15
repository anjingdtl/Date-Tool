/**
 * lib/analysis/evidence.ts
 *
 * 分析证据(AnalysisEvidence)构造器（SPEC 10.8）。
 *
 * 每条本地洞察(ComputedInsight)必须引用一个 evidenceId。
 * evidence 携带可追溯的：涉及字段、计算方法、样本数、关键计算结果。
 */

import type { AnalysisEvidence } from "@/lib/types";

function uid(prefix = "ev"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

/** evidence 工厂：统一构造,确保 id 唯一 */
export function makeEvidence(
  input: Omit<AnalysisEvidence, "id"> & { id?: string },
): AnalysisEvidence {
  return {
    id: input.id ?? uid(),
    title: input.title,
    description: input.description,
    fields: input.fields,
    method: input.method,
    result: input.result,
    sampleSize: input.sampleSize,
  };
}

/* ------------------------- 预定义 evidence 构造器 ------------------------- */

/** 基础统计 evidence */
export function summaryEvidence(
  field: string,
  stats: {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    median: number;
    nullCount: number;
  },
): AnalysisEvidence {
  return makeEvidence({
    title: `${field} 基础统计`,
    description: `对字段「${field}」做全量数值统计,包含有效样本数、求和、均值、最值、中位数与空值情况。`,
    fields: [field],
    method: "summary",
    result: {
      count: stats.count,
      sum: stats.sum,
      avg: stats.avg,
      min: stats.min,
      max: stats.max,
      median: stats.median,
      nullCount: stats.nullCount,
    },
    sampleSize: stats.count,
  });
}

/** 趋势 evidence */
export function trendEvidence(
  field: string,
  trend: {
    granularity: string;
    agg: string;
    points: Array<{ label: string; value: number; count: number }>;
    first: number | null;
    last: number | null;
    absoluteChange: number | null;
    changeRate: number | null;
    sampleSize: number;
  },
): AnalysisEvidence {
  return makeEvidence({
    title: `${field} 时间趋势`,
    description: `按${trend.granularity}粒度聚合,首期 ${trend.first ?? "N/A"} → 末期 ${trend.last ?? "N/A"},聚合方式 ${trend.agg}。`,
    fields: [field],
    method: "trend",
    result: {
      granularity: trend.granularity,
      agg: trend.agg,
      periodCount: trend.points.length,
      first: trend.first,
      last: trend.last,
      absoluteChange: trend.absoluteChange,
      changeRate: trend.changeRate,
      points: trend.points,
    },
    sampleSize: trend.sampleSize,
  });
}

/** 分组对比 evidence */
export function groupCompareEvidence(
  metric: string,
  dimension: string,
  agg: string,
  top10: Array<{ label: string; value: number; count: number }>,
  sampleSize: number,
): AnalysisEvidence {
  return makeEvidence({
    title: `${metric} 按 ${dimension} 分组对比`,
    description: `按维度「${dimension}」分组,对指标「${metric}」做 ${agg} 聚合,取 Top 10。`,
    fields: [metric, dimension],
    method: "group_compare",
    result: {
      agg,
      top10,
    },
    sampleSize,
  });
}

/** 状态分布 evidence */
export function statusDistributionEvidence(
  statusField: string,
  top: Array<{ value: string; count: number; rate: number }>,
  warnCount: number,
  warnRate: number,
  total: number,
): AnalysisEvidence {
  return makeEvidence({
    title: `${statusField} 状态分布`,
    description: `对状态字段「${statusField}」做取值计数与占比统计,并识别预警类取值。`,
    fields: [statusField],
    method: "status_distribution",
    result: {
      distribution: top,
      warnCount,
      warnRate,
      total,
    },
    sampleSize: total,
  });
}

/** 异常值 evidence */
export function outlierEvidence(
  field: string,
  outlier: {
    detected: boolean;
    sampleSize: number;
    q1: number;
    q3: number;
    iqr: number;
    lowerBound: number;
    upperBound: number;
    outlierCount: number;
    samples: Array<{ value: number; rowIndex: number; direction: string }>;
  },
): AnalysisEvidence {
  return makeEvidence({
    title: `${field} 异常值检测(IQR)`,
    description: outlier.detected
      ? `使用 IQR 方法检测,下界 ${outlier.lowerBound.toFixed(2)},上界 ${outlier.upperBound.toFixed(2)},共发现 ${outlier.outlierCount} 个统计异常值。`
      : `样本数 ${outlier.sampleSize} 不足 ${8} 条,未执行异常值检测。`,
    fields: [field],
    method: "outlier",
    result: {
      detected: outlier.detected,
      q1: outlier.q1,
      q3: outlier.q3,
      iqr: outlier.iqr,
      lowerBound: outlier.lowerBound,
      upperBound: outlier.upperBound,
      outlierCount: outlier.outlierCount,
      samples: outlier.samples,
    },
    sampleSize: outlier.sampleSize,
  });
}

/** 缺失值 evidence */
export function missingnessEvidence(
  field: string,
  nullCount: number,
  nullRate: number,
  total: number,
): AnalysisEvidence {
  return makeEvidence({
    title: `${field} 缺失情况`,
    description: `字段「${field}」共 ${nullCount} 个空值,空值率 ${(nullRate * 100).toFixed(1)}%。`,
    fields: [field],
    method: "missingness",
    result: {
      nullCount,
      nullRate,
      total,
    },
    sampleSize: total,
  });
}

/** Top/Bottom 排名 evidence */
export function topBottomEvidence(
  field: string,
  top: Array<{ value: string; count: number; rate: number }>,
  bottom: Array<{ value: string; count: number; rate: number }>,
  distinctCount: number,
  total: number,
): AnalysisEvidence {
  return makeEvidence({
    title: `${field} 取值排名`,
    description: `字段「${field}」共 ${distinctCount} 个不同取值,展示 Top ${top.length} 与 Bottom ${bottom.length}。`,
    fields: [field],
    method: "top_bottom",
    result: {
      distinctCount,
      top,
      bottom,
    },
    sampleSize: total,
  });
}
