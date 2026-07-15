/**
 * lib/analysis/recommend-charts.ts
 *
 * 本地图表推荐引擎（SPEC 11）。
 *
 * 阶段 F 完成:
 * - 按字段角色生成 ChartSpec(line/bar/pie/table)
 * - Zod 结构校验(SPEC 11.4)
 * - 8 条语义校验 + pie 降级 + TopN + 局部容错
 * - 图表显示顺序(SPEC 11.5): 趋势 → 对比 → 状态 → 异常 → 原始表
 * - percentage 用 avg, currency/integer 用 sum
 */

import type { ChartSpec, ColumnMeta, DatasetRow, FieldFormat } from "@/lib/types";
import type { FieldProfile } from "./profile";
import { computeCategoryStats, profileFields } from "./profile";
import {
  filterValidCharts,
  validateChartSpec,
} from "@/lib/schemas/chart";

/* ------------------------- ID 生成 ------------------------- */

function uid(prefix = "chart"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

/* ------------------------- 聚合选择 ------------------------- */

/** 根据 metric 的 format 选择聚合方式(SPEC 10.4 / 11.3) */
export function pickAgg(format: FieldFormat | undefined): "sum" | "avg" {
  if (format === "percentage") return "avg";
  // count / currency / integer / decimal 默认 sum
  return "sum";
}

/* ------------------------- 图表推荐 ------------------------- */

/** 根据字段角色与统计结果生成本地 ChartSpec 草案列表 */
export function recommendCharts(
  rows: DatasetRow[],
  profile: FieldProfile,
  maxCharts = 8,
): ChartSpec[] {
  const charts: ChartSpec[] = [];
  const { timeField, primaryDimension, statusFields, metricFields } = profile;

  // 1) 每个核心 metric 随时间趋势(若有 time 字段),最多 3 张(SPEC 11.2)
  if (timeField) {
    const trendMetrics = metricFields.slice(0, 3);
    for (const m of trendMetrics) {
      const agg = pickAgg(m.format);
      charts.push({
        id: uid(),
        title: `趋势 · ${m.name} 随${timeField.name}变化`,
        type: "line",
        xField: timeField.name,
        yField: m.name,
        agg,
        description: `以「${timeField.name}」为横轴,观察「${m.name}」的${agg === "avg" ? "均值" : "累计"}走势。`,
      });
    }
  }

  // 2) 每个核心 metric 按主维度对比,最多 2 张(SPEC 11.2)
  if (primaryDimension) {
    const dimStats = computeCategoryStats(rows, primaryDimension.name);
    // 高基数字段不直接生成全量图(SPEC 10.5),但这里仍生成,语义校验会加 TopN limit
    if (dimStats.distinctCount >= 2) {
      const dimMetrics = metricFields.slice(0, 2);
      for (const m of dimMetrics) {
        const agg = pickAgg(m.format);
        charts.push({
          id: uid(),
          title: `对比 · 各${primaryDimension.name}的${m.name}`,
          type: "bar",
          xField: primaryDimension.name,
          yField: m.name,
          agg,
          limit: 10, // SPEC 11.3 bar 类别超过 10 默认 Top 10
          description: `按「${primaryDimension.name}」分组,对比各主体的「${m.name}」(Top 10)。`,
        });
      }
    }
  }

  // 3) 状态分布,最多 1 张(SPEC 11.2)
  if (statusFields.length > 0) {
    const s = statusFields[0];
    const sStats = computeCategoryStats(rows, s.name);
    // SPEC 11.3 pie 仅适用类别 2~6,超过 6 降级 bar
    const type: ChartSpec["type"] =
      sStats.distinctCount >= 2 && sStats.distinctCount <= 6
        ? "pie"
        : "bar";
    charts.push({
      id: uid(),
      title: `构成 · ${s.name}分布`,
      type,
      xField: s.name,
      yField: "__count__",
      agg: "count",
      limit: type === "bar" ? 10 : undefined,
      description: `各「${s.name}」取值占比,快速识别异常比例。`,
    });
  }

  // 4) 原始数据表(SPEC 11.2 / 11.3)
  charts.push({
    id: uid(),
    title: "原始数据预览(前 10 行)",
    type: "table",
    xField: profile.activeFields[0]?.name ?? "index",
    yField: "__rows__",
    agg: "count",
    limit: 10,
    description: "表格形式查看导入的原始数据。",
  });

  return charts.slice(0, maxCharts);
}

/* ------------------------- 语义校验(SPEC 11.4) ------------------------- */

/** 系统保留的 yField 特殊值 */
const SYSTEM_YFIELDS = new Set(["__count__", "__rows__"]);

export interface SemanticIssue {
  /** null 表示整图级别错误,否则是字段名 */
  field: string | null;
  message: string;
  /** error 跳过该图, warning 仅记录 */
  level: "error" | "warning";
}

export interface SemanticResult {
  /** 校验通过的图表(可能经过降级/TopN 调整) */
  charts: ChartSpec[];
  /** 所有图表的校验问题(含被跳过的) */
  issues: SemanticIssue[];
}

/**
 * 语义校验单个 ChartSpec(SPEC 11.4 8 条规则)。
 *
 * 1. xField 必须存在于 columns;
 * 2. yField 必须存在,或为系统保留值(__count__/__rows__);
 * 3. groupBy 必须存在(若提供);
 * 4. line 的 yField 必须可数值化(非系统保留时必须是 number 类型);
 * 5. percentage 默认不能 sum;
 * 6. identifier 不能作为 metric(line/bar 的 yField 不能是 identifier);
 * 7. pie 类别超过 6 时自动降级为 bar;
 * 8. 不合法 ChartSpec 只跳过该图,不得导致分析失败。
 *
 * 返回 null 表示通过(可能经过降级/TopN 调整),返回 SemanticIssue[] 表示失败。
 */
function semanticValidateOne(
  spec: ChartSpec,
  columns: ColumnMeta[],
  rows: DatasetRow[],
): { ok: true; spec: ChartSpec; issues: SemanticIssue[] } | { ok: false; issues: SemanticIssue[] } {
  const issues: SemanticIssue[] = [];
  const colMap = new Map(columns.map((c) => [c.name, c]));
  const has = (name: string) => colMap.has(name);

  // 1. xField 必须存在
  if (!has(spec.xField)) {
    issues.push({
      field: spec.xField,
      level: "error",
      message: `xField「${spec.xField}」不存在于字段列表`,
    });
  }

  // 2. yField 必须存在,或为系统保留值
  if (!SYSTEM_YFIELDS.has(spec.yField) && !has(spec.yField)) {
    issues.push({
      field: spec.yField,
      level: "error",
      message: `yField「${spec.yField}」不存在且非系统保留值`,
    });
  }

  // 3. groupBy 必须存在(若提供)
  if (spec.groupBy && !has(spec.groupBy)) {
    issues.push({
      field: spec.groupBy,
      level: "error",
      message: `groupBy「${spec.groupBy}」不存在于字段列表`,
    });
  }

  // 4. line 的 yField 必须可数值化(非系统保留时必须是 number)
  if (
    spec.type === "line" &&
    !SYSTEM_YFIELDS.has(spec.yField)
  ) {
    const yCol = colMap.get(spec.yField);
    if (yCol && yCol.type !== "number") {
      issues.push({
        field: spec.yField,
        level: "error",
        message: `line 图的 yField「${spec.yField}」类型为 ${yCol.type},不可数值化`,
      });
    }
  }

  // 5. percentage 默认不能 sum
  if (!SYSTEM_YFIELDS.has(spec.yField)) {
    const yCol = colMap.get(spec.yField);
    if (yCol?.format === "percentage" && spec.agg === "sum") {
      issues.push({
        field: spec.yField,
        level: "error",
        message: `字段「${spec.yField}」为百分比格式,不得使用 sum 聚合`,
      });
    }
  }

  // 6. identifier 不能作为 metric(line/bar 的 yField)
  if (
    (spec.type === "line" || spec.type === "bar") &&
    !SYSTEM_YFIELDS.has(spec.yField)
  ) {
    const yCol = colMap.get(spec.yField);
    if (yCol?.role === "identifier") {
      issues.push({
        field: spec.yField,
        level: "error",
        message: `字段「${spec.yField}」为 identifier,不能作为 metric`,
      });
    }
  }

  // 7. pie 类别超过 6 时自动降级为 bar
  let finalSpec = spec;
  if (spec.type === "pie") {
    const xCol = colMap.get(spec.xField);
    if (xCol) {
      const catStats = computeCategoryStats(rows, spec.xField, 100, 0);
      if (catStats.distinctCount > 6) {
        finalSpec = {
          ...spec,
          type: "bar",
          limit: spec.limit ?? 10,
          description: `${spec.description ?? ""}(原 pie 图,因类别 ${catStats.distinctCount} 超过 6,降级为 bar)`,
        };
        issues.push({
          field: spec.xField,
          level: "warning",
          message: `pie 图「${spec.title}」类别 ${catStats.distinctCount} 超过 6,已降级为 bar`,
        });
      }
    }
  }

  // 8. TopN 处理:bar/pie 类别超过 limit 时,标记 limit(实际截断在 buildChartOption)
  //    这里只确保 limit 合理
  if (
    (finalSpec.type === "bar" || finalSpec.type === "pie") &&
    finalSpec.limit === undefined
  ) {
    const xCol = colMap.get(finalSpec.xField);
    if (xCol) {
      const catStats = computeCategoryStats(rows, finalSpec.xField, 100, 0);
      if (catStats.distinctCount > 10) {
        finalSpec = { ...finalSpec, limit: 10 };
      }
    }
  }

  const hasError = issues.some((i) => i.level === "error");
  if (hasError) {
    return { ok: false, issues };
  }
  return { ok: true, spec: finalSpec, issues };
}

/**
 * 批量语义校验 + 过滤(SPEC 11.4 局部容错)。
 *
 * - 先做 Zod 结构校验(filterValidCharts);
 * - 再做语义校验(semanticValidateOne);
 * - 不合法的只跳过该图,不抛错;
 * - 返回校验通过的图表 + 所有 issues(用于调试/日志)。
 */
export function semanticValidateCharts(
  raws: ChartSpec[],
  columns: ColumnMeta[],
  rows: DatasetRow[],
): SemanticResult {
  const issues: SemanticIssue[] = [];
  const out: ChartSpec[] = [];

  // 先 Zod 结构校验
  const structValid = filterValidCharts(raws);

  for (const spec of structValid) {
    const r = semanticValidateOne(spec, columns, rows);
    // 无论通过与否,都收集 issues(通过的也可能有 warning,如 pie 降级)
    issues.push(...r.issues);
    if (r.ok) {
      out.push(r.spec);
    }
  }

  // 按显示顺序排序(SPEC 11.5): 趋势 → 对比 → 状态 → 异常 → 原始表
  out.sort((a, b) => chartOrder(a) - chartOrder(b));

  return { charts: out, issues };
}

/** 图表显示顺序优先级(SPEC 11.5) */
function chartOrder(spec: ChartSpec): number {
  switch (spec.type) {
    case "line":
      return 1; // 核心趋势
    case "bar":
      // 难以区分对比 vs 异常,统一放第 2
      return 2;
    case "pie":
      return 3; // 状态和构成
    case "table":
      // 原始数据表放最后
      return 5;
    default:
      return 4;
  }
}

/* ------------------------- 便捷入口 ------------------------- */

/** 根据现有 columns 与 rows 推断字段画像并生成 + 校验 ChartSpec */
export function recommendAndValidate(
  rows: DatasetRow[],
  columns: ColumnMeta[],
  maxCharts = 8,
): SemanticResult {
  const profile = profileFields(columns);
  const raw = recommendCharts(rows, profile, maxCharts);
  return semanticValidateCharts(raw, columns, rows);
}

// 重新导出便于外部使用
export { validateChartSpec };
