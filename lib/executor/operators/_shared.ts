/**
 * lib/executor/operators/_shared.ts
 *
 * 操作符共享工具：filter / sort / 数值提取 / 聚合（含 median/last）/ evidence 工厂。
 * 复用 lib/analysis 的 quantile，不复制统计逻辑。
 */
import type {
  AnalysisEvidence,
  AnalysisOperator,
  DatasetRow,
  TaskFilter,
  TaskSort,
} from "@/lib/types";
import { quantile } from "@/lib/analysis/statistics";

export function toKey(v: unknown): string {
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

export function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export type TaskAgg =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "median"
  | "last";

/** 聚合（支持 task 的 7 种：含 median/last）。count 只数有效值。 */
export function aggregateValues(values: number[], agg: TaskAgg): number {
  if (values.length === 0) {
    return agg === "count" ? 0 : 0;
  }
  switch (agg) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "count":
      return values.length;
    case "min":
      return values.reduce((a, b) => (a < b ? a : b), Infinity);
    case "max":
      return values.reduce((a, b) => (a > b ? a : b), -Infinity);
    case "median":
      return quantile([...values].sort((a, b) => a - b), 0.5);
    case "last":
      return values[values.length - 1];
  }
}

export function aggLabel(agg: TaskAgg): string {
  switch (agg) {
    case "sum":
      return "求和";
    case "avg":
      return "均值";
    case "count":
      return "计数";
    case "min":
      return "最小";
    case "max":
      return "最大";
    case "median":
      return "中位数";
    case "last":
      return "末值";
  }
}

export function matchFilter(value: unknown, f: TaskFilter): boolean {
  switch (f.operator) {
    case "eq":
      return toKey(value) === String(f.value);
    case "neq":
      return toKey(value) !== String(f.value);
    case "in":
      return (
        Array.isArray(f.value) &&
        f.value.some((x) => toKey(value) === String(x))
      );
    case "not_in":
      return (
        Array.isArray(f.value) &&
        !f.value.some((x) => toKey(value) === String(x))
      );
    case "gt": {
      const n = asNumber(value);
      const t = asNumber(f.value);
      return n !== null && t !== null && n > t;
    }
    case "gte": {
      const n = asNumber(value);
      const t = asNumber(f.value);
      return n !== null && t !== null && n >= t;
    }
    case "lt": {
      const n = asNumber(value);
      const t = asNumber(f.value);
      return n !== null && t !== null && n < t;
    }
    case "lte": {
      const n = asNumber(value);
      const t = asNumber(f.value);
      return n !== null && t !== null && n <= t;
    }
    case "between": {
      const n = asNumber(value);
      if (n === null || !Array.isArray(f.value) || f.value.length < 2) return false;
      const lo = asNumber(f.value[0]);
      const hi = asNumber(f.value[1]);
      return lo !== null && hi !== null && n >= lo && n <= hi;
    }
    case "contains":
      return toKey(value).includes(String(f.value));
  }
}

export function applyFilters(
  rows: DatasetRow[],
  filters: TaskFilter[],
): DatasetRow[] {
  if (!filters || filters.length === 0) return rows;
  return rows.filter((r) => filters.every((f) => matchFilter(r[f.field], f)));
}

export function applySort<T extends Record<string, unknown>>(
  rows: T[],
  sort: TaskSort | undefined,
): T[] {
  if (!sort) return rows;
  const dir = sort.direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sort.field];
    const bv = b[sort.field];
    if (av === bv) return 0;
    if (av === null || av === undefined || av === "") return 1;
    if (bv === null || bv === undefined || bv === "") return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return (String(av) < String(bv) ? -1 : 1) * dir;
  });
}

let evCounter = 0;

/** 重置 evidence 计数器（测试用，保证 id 可复现） */
export function resetEvidenceCounter(): void {
  evCounter = 0;
}

/** 构造任务 evidence（SPEC 13.4 扩展字段） */
export function makeTaskEvidence(opts: {
  taskId: string;
  operator: AnalysisOperator;
  title: string;
  description: string;
  fields: string[];
  method: AnalysisEvidence["method"];
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  sampleSize: number;
  resultHash: string;
}): AnalysisEvidence {
  evCounter++;
  return {
    id: `ev_${opts.taskId}_${evCounter}`,
    title: opts.title,
    description: opts.description,
    fields: opts.fields,
    method: opts.method,
    parameters: opts.parameters,
    result: opts.result,
    sampleSize: opts.sampleSize,
    taskId: opts.taskId,
    operator: opts.operator,
    inputHash: "",
    resultHash: opts.resultHash,
    generatedAt: new Date().toISOString(),
  };
}

/** 通用字段存在性校验（多个 operator 复用） */
export function validateFieldsExist(
  fields: string[],
  available: Set<string>,
): Array<{ code: string; field?: string; message: string; level: "warning" | "error" }> {
  const issues = [];
  for (const f of fields) {
    if (!available.has(f)) {
      issues.push({
        code: "UNKNOWN_FIELD",
        field: f,
        message: `字段「${f}」不存在`,
        level: "error" as const,
      });
    }
  }
  return issues;
}
