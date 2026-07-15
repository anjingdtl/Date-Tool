/**
 * lib/analysis/aggregation.ts
 *
 * 聚合方式的单一解析入口（SPEC 8.2 / 8.3）。
 *
 * 优先级：用户明确设置的 defaultAggregation（须通过合法性校验）
 *       → 字段格式 / 类型默认规则。
 * trends / comparisons / recommend-charts / chart / evidence 都调用
 * resolveAggregation，不得各自复制规则（SPEC 8.4）。
 */
import type { Aggregation, ColumnMeta } from "@/lib/types";

export type AggContext = "summary" | "trend" | "group" | "chart";

/** SPEC 8.6：拦截不适合的 字段×聚合 组合 */
export function isAllowedAgg(
  column: Pick<ColumnMeta, "type" | "format" | "role">,
  agg: Aggregation,
): boolean {
  if (agg === "count") return true; // count 可用于任意字段的非空计数
  // sum / avg / max / min 要求数值类型
  if (column.type !== "number") return false;
  // percentage + sum 阻断（百分比求和无业务意义）
  if (column.format === "percentage" && agg === "sum") return false;
  // identifier 不该求和 / 平均（即便它是数值）
  if (column.role === "identifier" && (agg === "avg" || agg === "sum")) {
    return false;
  }
  return true;
}

/** 格式 / 类型默认聚合（SPEC 8.3 表） */
function fallbackAgg(
  column: Pick<ColumnMeta, "type" | "role" | "format">,
): Aggregation {
  if (column.type !== "number") return "count";
  if (column.role === "identifier") return "count";
  switch (column.format) {
    case "percentage":
    case "duration":
      return "avg";
    case "currency":
    case "integer":
    case "decimal":
      return "sum";
    default:
      return "sum";
  }
}

/**
 * 解析字段最终聚合方式（SPEC 8.2）。
 * 用户设置优先（须合法），否则用格式 / 类型默认。
 */
export function resolveAggregation(
  column: ColumnMeta,
  context: AggContext = "summary",
): Aggregation {
  void context; // 当前规则不区分 context，保留参数供未来扩展
  const userSet = column.defaultAggregation;
  if (userSet && isAllowedAgg(column, userSet)) {
    return userSet;
  }
  return fallbackAgg(column);
}

/**
 * 对一组有效数值执行聚合（SPEC 8.5）。
 * count 返回非空有效值数量；空数组返回 0。
 */
export function aggregate(values: number[], agg: Aggregation): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "count":
      return values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "sum":
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

/** 聚合方式对应的中文动词，用于图表标题 / 说明（SPEC 8.7） */
export function aggLabel(agg: Aggregation): string {
  switch (agg) {
    case "sum":
      return "累计";
    case "avg":
      return "平均";
    case "count":
      return "计数";
    case "max":
      return "最大";
    case "min":
      return "最小";
    default:
      return "聚合";
  }
}
