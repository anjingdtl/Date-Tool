/**
 * lib/analysis/outliers.ts
 *
 * IQR 异常值检测（SPEC 10.7）。纯函数,确定性计算。
 *
 * 规则：
 * - P0 使用 IQR 方法: 下界 = Q1 - 1.5×IQR, 上界 = Q3 + 1.5×IQR
 * - 样本少于 8 条时不做异常值判断
 * - 标识符和比率型离散编码不做异常值(由调用方判断,本模块只对传入的数值字段计算)
 * - 返回异常数量和最多 5 个异常样本
 * - 不得将统计异常自动描述为业务错误
 */

import type { DatasetRow } from "@/lib/types";
import { extractNumbers, quantile } from "./statistics";

export interface OutlierSample {
  /** 异常值 */
  value: number;
  /** 该值在原行集中的索引(便于回溯) */
  rowIndex: number;
  /** 越界方向 */
  direction: "lower" | "upper";
}

export interface OutlierResult {
  field: string;
  /** 是否执行了检测(样本 < 8 时为 false) */
  detected: boolean;
  /** 参与检测的样本数 */
  sampleSize: number;
  q1: number;
  q3: number;
  iqr: number;
  lowerBound: number;
  upperBound: number;
  outlierCount: number;
  /** 最多 5 个异常样本 */
  samples: OutlierSample[];
}

const MIN_SAMPLES = 8;
const MAX_SAMPLES = 5;
const IQR_COEFFICIENT = 1.5;

/**
 * 对单个数值字段做 IQR 异常值检测。
 *
 * @param rows 行集
 * @param field 字段名
 */
export function detectOutliers(
  rows: DatasetRow[],
  field: string,
): OutlierResult {
  const { values } = extractNumbers(rows, field);
  const sampleSize = values.length;

  // 样本少于 8 条时不做异常值判断
  if (sampleSize < MIN_SAMPLES) {
    return {
      field,
      detected: false,
      sampleSize,
      q1: 0,
      q3: 0,
      iqr: 0,
      lowerBound: 0,
      upperBound: 0,
      outlierCount: 0,
      samples: [],
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerBound = q1 - IQR_COEFFICIENT * iqr;
  const upperBound = q3 + IQR_COEFFICIENT * iqr;

  const samples: OutlierSample[] = [];
  let outlierCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][field];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;

    let direction: "lower" | "upper" | null = null;
    if (n < lowerBound) direction = "lower";
    else if (n > upperBound) direction = "upper";

    if (direction) {
      outlierCount++;
      if (samples.length < MAX_SAMPLES) {
        samples.push({ value: n, rowIndex: i, direction });
      }
    }
  }

  return {
    field,
    detected: true,
    sampleSize,
    q1,
    q3,
    iqr,
    lowerBound,
    upperBound,
    outlierCount,
    samples,
  };
}

/** 批量检测多个字段 */
export function detectOutliersBatch(
  rows: DatasetRow[],
  fields: string[],
): OutlierResult[] {
  return fields.map((f) => detectOutliers(rows, f));
}
