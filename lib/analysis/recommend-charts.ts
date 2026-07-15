/**
 * lib/analysis/recommend-charts.ts
 *
 * 本地图表推荐(ChartSpec)生成。
 *
 * 阶段 E 先实现「按字段角色生成 ChartSpec 草案」,
 * 阶段 F 会在此基础上叠加 Zod 严格校验 + 语义校验 + TopN + 日期排序 + percentage 聚合 + 局部容错。
 *
 * 本模块只负责「生成」,校验与容错留给阶段 F 的 filterValidCharts。
 */

import type { ChartSpec, ColumnMeta, DatasetRow } from "@/lib/types";
import type { FieldProfile } from "./profile";

function uid(prefix = "chart"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

/** 根据字段角色与统计结果生成本地 ChartSpec 草案列表 */
export function recommendCharts(
  rows: DatasetRow[],
  profile: FieldProfile,
  maxCharts = 8,
): ChartSpec[] {
  const charts: ChartSpec[] = [];
  const { timeField, primaryDimension, statusFields, metricFields } = profile;

  // 1) 每个核心 metric 随时间趋势(若有 time 字段),最多 3 张
  if (timeField) {
    const trendMetrics = metricFields.slice(0, 3);
    for (const m of trendMetrics) {
      const agg = m.format === "percentage" ? "avg" : "sum";
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

  // 2) 每个核心 metric 按主维度对比,最多 2 张
  if (primaryDimension) {
    const dimMetrics = metricFields.slice(0, 2);
    for (const m of dimMetrics) {
      const agg = m.format === "percentage" ? "avg" : "sum";
      charts.push({
        id: uid(),
        title: `对比 · 各${primaryDimension.name}的${m.name}`,
        type: "bar",
        xField: primaryDimension.name,
        yField: m.name,
        agg,
        limit: 10,
        description: `按「${primaryDimension.name}」分组,对比各主体的「${m.name}」(Top 10)。`,
      });
    }
  }

  // 3) 状态分布,最多 1 张
  if (statusFields.length > 0) {
    const s = statusFields[0];
    charts.push({
      id: uid(),
      title: `构成 · ${s.name}分布`,
      type: "pie",
      xField: s.name,
      yField: "__count__",
      agg: "count",
      description: `各「${s.name}」取值占比,快速识别异常比例。`,
    });
  }

  // 4) 原始数据表
  charts.push({
    id: uid(),
    title: "原始数据预览(前 10 行)",
    type: "table",
    xField: profile.activeFields[0]?.name ?? "index",
    yField: "__rows__",
    description: "表格形式查看导入的原始数据。",
  });

  return charts.slice(0, maxCharts);
}

/** 根据现有 columns 与 rows 推断字段画像并生成 ChartSpec(便捷入口) */
export function recommendChartsFromColumns(
  rows: DatasetRow[],
  columns: ColumnMeta[],
  maxCharts = 8,
): ChartSpec[] {
  // 复用 profile.profileFields,避免循环依赖
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { profileFields } = require("./profile") as typeof import("./profile");
  const profile = profileFields(columns);
  return recommendCharts(rows, profile, maxCharts);
}
