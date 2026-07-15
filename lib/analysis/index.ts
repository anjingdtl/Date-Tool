/**
 * lib/analysis/index.ts
 *
 * 确定性分析引擎总入口（SPEC 10）。
 *
 * 流程：
 * 1. profileFields 筛选字段角色
 * 2. 对每个 metric 做基础统计 + 异常值检测
 * 3. 对维度/状态字段做取值分布
 * 4. 若有 time 字段,对每个 metric 做时间趋势
 * 5. 若有主维度,对每个 metric 做分组对比
 * 6. 对状态字段做预警识别与占比
 * 7. 汇总 evidence + 生成 ComputedInsight[]
 *
 * 所有数值由代码计算,LLM 不得介入。
 * 每条 ComputedInsight 必须引用一个 evidenceId。
 */

import type {
  AnalysisEvidence,
  ChartSpec,
  ColumnMeta,
  ComputedInsight,
  DatasetRow,
  StoredDataset,
} from "@/lib/types";
import {
  computeCategoryStats,
  isLowCardinality,
  profileFields,
  type FieldProfile,
} from "./profile";
import {
  computeNumericStats,
  formatNumber,
  formatRate,
  type NumericStats,
} from "./statistics";
import { computeTrends, type MetricTrend } from "./trends";
import {
  computeGroupComparison,
  type GroupComparison,
} from "./comparisons";
import { detectOutliers, type OutlierResult } from "./outliers";
import {
  groupCompareEvidence,
  makeEvidence,
  missingnessEvidence,
  outlierEvidence,
  statusDistributionEvidence,
  summaryEvidence,
  topBottomEvidence,
  trendEvidence,
} from "./evidence";
import { recommendAndValidate, type SemanticIssue } from "./recommend-charts";

/* ------------------------- 状态分析(SPEC 10.6) ------------------------- */

/** 预警类状态关键词(与 parse.ts 保持一致) */
const WARN_KEYWORDS = [
  "预警", "异常", "风险", "告警", "不达标", "失败", "负", "warn", "fail", "risk", "alert", "lost",
];

function isWarnValue(v: unknown): boolean {
  const s = String(v ?? "").toLowerCase();
  return WARN_KEYWORDS.some((kw) => s.includes(kw.toLowerCase()));
}

export interface StatusAnalysis {
  field: string;
  distribution: Array<{ value: string; count: number; rate: number }>;
  warnCount: number;
  warnRate: number;
  total: number;
  /** 若存在核心 metric,比较预警组与正常组的均值差异 */
  metricDiff?:
    | {
        metric: string;
        normalAvg: number;
        warnAvg: number;
        diff: number;
      }
    | undefined;
}

function analyzeStatus(
  rows: DatasetRow[],
  statusField: string,
  metrics: ColumnMeta[],
): StatusAnalysis {
  const stats = computeCategoryStats(rows, statusField, 30, 10);
  const distribution = stats.top;
  const total = stats.total - stats.nullCount;

  let warnCount = 0;
  for (const r of rows) {
    const v = r[statusField];
    if (v === null || v === undefined || v === "") continue;
    if (isWarnValue(v)) warnCount++;
  }
  const warnRate = total > 0 ? warnCount / total : 0;

  let metricDiff: StatusAnalysis["metricDiff"];
  if (metrics.length > 0) {
    const m = metrics[0];
    const normalVals: number[] = [];
    const warnVals: number[] = [];
    for (const r of rows) {
      const sv = r[statusField];
      if (sv === null || sv === undefined || sv === "") continue;
      const mv = r[m.name];
      if (mv === null || mv === undefined || mv === "") continue;
      const n = typeof mv === "number" ? mv : Number(mv);
      if (!Number.isFinite(n)) continue;
      if (isWarnValue(sv)) warnVals.push(n);
      else normalVals.push(n);
    }
    if (normalVals.length > 0 || warnVals.length > 0) {
      const normalAvg =
        normalVals.length > 0
          ? normalVals.reduce((a, b) => a + b, 0) / normalVals.length
          : 0;
      const warnAvg =
        warnVals.length > 0
          ? warnVals.reduce((a, b) => a + b, 0) / warnVals.length
          : 0;
      metricDiff = {
        metric: m.name,
        normalAvg,
        warnAvg,
        diff: warnAvg - normalAvg,
      };
    }
  }

  return {
    field: statusField,
    distribution,
    warnCount,
    warnRate,
    total,
    metricDiff,
  };
}

/* ------------------------- 总入口 ------------------------- */

export interface LocalAnalysis {
  profile: FieldProfile;
  numericStats: NumericStats[];
  outliers: OutlierResult[];
  trends: MetricTrend[];
  comparisons: GroupComparison[];
  statusAnalyses: StatusAnalysis[];
  evidence: AnalysisEvidence[];
  insights: ComputedInsight[];
  /** v0.2 阶段 F:本地推荐 + 语义校验后的 ChartSpec */
  charts: ChartSpec[];
  /** 图表校验问题(用于调试/日志,不阻断分析) */
  chartIssues: SemanticIssue[];
}

function insightId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

/**
 * 本地确定性分析总入口。
 *
 * @param ds 数据集(含 rows + columns)
 * @returns LocalAnalysis,包含 evidence + ComputedInsight,所有数值由代码计算
 */
export function runLocalAnalysis(ds: StoredDataset): LocalAnalysis {
  const rows = ds.rows;
  const columns = ds.columns;
  const profile = profileFields(columns);

  const evidence: AnalysisEvidence[] = [];
  const insights: ComputedInsight[] = [];

  /* —— 1. 基础统计 + 异常值(SPEC 10.2 / 10.7) —— */
  const numericStats: NumericStats[] = [];
  const outliers: OutlierResult[] = [];

  for (const m of profile.metricFields) {
    const stats = computeNumericStats(rows, m.name);
    numericStats.push(stats);

    const ev = summaryEvidence(m.name, stats);
    evidence.push(ev);

    // 基础统计洞察
    insights.push({
      id: insightId("stat"),
      level: "info",
      title: `${m.name} 基础统计`,
      statement:
        `「${m.name}」共 ${stats.count} 条有效数据,` +
        `均值 ${formatNumber(stats.avg)},` +
        `范围 ${formatNumber(stats.min)}~${formatNumber(stats.max)},` +
        `中位数 ${formatNumber(stats.median)}。` +
        (stats.negativeCount > 0
          ? `含 ${stats.negativeCount} 个负值;`
          : "") +
        (stats.zeroCount > 0 ? `含 ${stats.zeroCount} 个零值。` : ""),
      evidenceId: ev.id,
      fields: [m.name],
    });

    // 高空值率洞察
    if (stats.nullRate > 0.3) {
      const missEv = missingnessEvidence(
        m.name,
        stats.nullCount,
        stats.nullRate,
        rows.length,
      );
      evidence.push(missEv);
      insights.push({
        id: insightId("miss"),
        level: "warning",
        title: `${m.name} 缺失较多`,
        statement: `字段「${m.name}」空值率 ${formatRate(stats.nullRate)},共 ${stats.nullCount} 条空值,可能影响分析结论的可靠性。`,
        evidenceId: missEv.id,
        fields: [m.name],
      });
    }

    // 异常值检测
    const outlier = detectOutliers(rows, m.name);
    outliers.push(outlier);
    const outEv = outlierEvidence(m.name, outlier);
    evidence.push(outEv);
    if (outlier.detected && outlier.outlierCount > 0) {
      insights.push({
        id: insightId("out"),
        level: "warning",
        title: `${m.name} 存在统计异常值`,
        statement: `使用 IQR 方法检测到 ${outlier.outlierCount} 个统计异常值(下界 ${formatNumber(outlier.lowerBound)},上界 ${formatNumber(outlier.upperBound)})。注意:这是统计异常,不一定是业务错误,需结合场景判断。`,
        evidenceId: outEv.id,
        fields: [m.name],
      });
    }
  }

  /* —— 2. 维度统计(SPEC 10.3) —— */
  const dimensionFields = [
    ...profile.statusFields,
    ...profile.activeFields.filter(
      (c) => c.role === "dimension" && c.name !== profile.primaryDimension?.name,
    ),
  ].slice(0, 5);

  for (const d of dimensionFields) {
    const catStats = computeCategoryStats(rows, d.name, 10, 10);
    if (catStats.distinctCount === 0) continue;

    const ev = topBottomEvidence(
      d.name,
      catStats.top,
      catStats.bottom,
      catStats.distinctCount,
      rows.length,
    );
    evidence.push(ev);

    // 长尾洞察
    if (catStats.longTailRate > 0.5 && catStats.distinctCount > 5) {
      insights.push({
        id: insightId("tail"),
        level: "info",
        title: `${d.name} 取值长尾`,
        statement: `字段「${d.name}」共 ${catStats.distinctCount} 个不同取值,Top 3 之外的长尾占比 ${formatRate(catStats.longTailRate)},分布较分散。`,
        evidenceId: ev.id,
        fields: [d.name],
      });
    }

    // Top 1 洞察
    if (catStats.top.length > 0) {
      const top1 = catStats.top[0];
      insights.push({
        id: insightId("top"),
        level: "info",
        title: `${d.name} 占比最高`,
        statement: `「${d.name}」中「${top1.value}」出现 ${top1.count} 次,占比 ${formatRate(top1.rate)},是占比最高的取值。`,
        evidenceId: ev.id,
        fields: [d.name],
      });
    }
  }

  /* —— 3. 时间趋势(SPEC 10.4) —— */
  const trends: MetricTrend[] = [];
  if (profile.timeField) {
    const trendMetrics = profile.metricFields.slice(0, 3);
    for (const m of trendMetrics) {
      const trend = computeMetricTrendSafe(rows, profile.timeField.name, m);
      trends.push(trend);

      const ev = trendEvidence(m.name, trend);
      evidence.push(ev);

      // 变化率洞察(样本足够且分母非 0 时)
      if (
        trend.points.length >= 2 &&
        trend.absoluteChange !== null &&
        trend.changeRate !== null
      ) {
        const direction = trend.absoluteChange > 0 ? "上升" : "下降";
        const level =
          Math.abs(trend.changeRate) > 0.2 ? "warning" : "info";
        insights.push({
          id: insightId("trend"),
          level,
          title: `${m.name} 趋势${direction}`,
          statement: `按${trend.granularity}粒度,「${m.name}」从 ${formatNumber(trend.first!)} 变化为 ${formatNumber(trend.last!)},${direction} ${formatNumber(Math.abs(trend.absoluteChange))},变化率 ${formatRate(Math.abs(trend.changeRate))}。`,
          evidenceId: ev.id,
          fields: [m.name, profile.timeField.name],
        });
      }
    }
  }

  /* —— 4. 分组对比(SPEC 10.5) —— */
  const comparisons: GroupComparison[] = [];
  if (profile.primaryDimension) {
    const dimStats = computeCategoryStats(rows, profile.primaryDimension.name);
    if (isLowCardinality(dimStats)) {
      const cmpMetrics = profile.metricFields.slice(0, 3);
      for (const m of cmpMetrics) {
        const cmp = computeGroupComparison(
          rows,
          profile.primaryDimension.name,
          m,
          dimStats.distinctCount,
        );
        comparisons.push(cmp);

        const ev = groupCompareEvidence(
          m.name,
          profile.primaryDimension.name,
          cmp.agg,
          cmp.top10,
          cmp.sampleSize,
        );
        evidence.push(ev);

        // Top 1 vs 倒数第 1 洞察
        if (cmp.top10.length >= 2) {
          const top = cmp.top10[0];
          const bottom = cmp.top10[cmp.top10.length - 1];
          if (top.value !== bottom.value && bottom.value !== 0) {
            const ratio = top.value / Math.abs(bottom.value);
            insights.push({
              id: insightId("cmp"),
              level: Math.abs(ratio) > 2 ? "warning" : "info",
              title: `${m.name} 分组差异`,
              statement: `按「${profile.primaryDimension.name}」分组,「${m.name}」(${cmp.agg}) 最高「${top.label}」(${formatNumber(top.value)}) 与最低「${bottom.label}」(${formatNumber(bottom.value)}) 相差约 ${formatNumber(Math.abs(ratio))} 倍。`,
              evidenceId: ev.id,
              fields: [m.name, profile.primaryDimension.name],
            });
          }
        }
      }
    }
  }

  /* —— 5. 状态分析(SPEC 10.6) —— */
  const statusAnalyses: StatusAnalysis[] = [];
  for (const s of profile.statusFields) {
    const sa = analyzeStatus(rows, s.name, profile.metricFields);
    statusAnalyses.push(sa);

    const ev = statusDistributionEvidence(
      s.name,
      sa.distribution,
      sa.warnCount,
      sa.warnRate,
      sa.total,
    );
    evidence.push(ev);

    // 预警占比洞察
    if (sa.warnCount > 0) {
      const level = sa.warnRate > 0.15 ? "warning" : "info";
      insights.push({
        id: insightId("warn"),
        level,
        title: `${s.name} 预警占比需关注`,
        statement: `状态字段「${s.name}」中预警类取值共 ${sa.warnCount} 条,占有效记录的 ${formatRate(sa.warnRate)}。`,
        evidenceId: ev.id,
        fields: [s.name],
      });
    }

    // 预警组与正常组均值差异洞察
    if (sa.metricDiff) {
      const md = sa.metricDiff;
      insights.push({
        id: insightId("mdiff"),
        level: "info",
        title: `${s.name} 预警组 ${md.metric} 差异`,
        statement: `「${md.metric}」在预警组的均值 ${formatNumber(md.warnAvg)} 与正常组的均值 ${formatNumber(md.normalAvg)} 相差 ${formatNumber(md.diff)}(预警组 - 正常组)。`,
        evidenceId: ev.id,
        fields: [s.name, md.metric],
      });
    }
  }

  /* —— 6. 数据质量概览洞察 —— */
  if (ds.quality) {
    const q = ds.quality;
    if (q.duplicateRowCount > 0) {
      const ev = makeEvidence({
        title: "数据集重复行",
        description: `检测到 ${q.duplicateRowCount} 行完全重复。`,
        fields: [],
        method: "summary",
        result: { duplicateRowCount: q.duplicateRowCount },
        sampleSize: q.storedRowCount,
      });
      evidence.push(ev);
      insights.push({
        id: insightId("dup"),
        level: "warning",
        title: "存在重复行",
        statement: `数据集存在 ${q.duplicateRowCount} 行完全重复,建议在导入前清理。`,
        evidenceId: ev.id,
        fields: [],
      });
    }
    if (q.storedRowCount < q.originalRowCount) {
      const ev = makeEvidence({
        title: "数据集已截断",
        description: `原始 ${q.originalRowCount} 行,实际载入 ${q.storedRowCount} 行。`,
        fields: [],
        method: "summary",
        result: {
          originalRowCount: q.originalRowCount,
          storedRowCount: q.storedRowCount,
        },
        sampleSize: q.storedRowCount,
      });
      evidence.push(ev);
      insights.push({
        id: insightId("trunc"),
        level: "warning",
        title: "数据已截断",
        statement: `原始数据共 ${q.originalRowCount} 行,已截断为前 ${q.storedRowCount} 行进行分析,结论基于已载入数据。`,
        evidenceId: ev.id,
        fields: [],
      });
    }
  }

  /* —— 7. 本地图表推荐 + 语义校验(SPEC 11) —— */
  const maxCharts = ds.config?.maxCharts ?? 8;
  const { charts, issues: chartIssues } = recommendAndValidate(
    rows,
    columns,
    maxCharts,
  );

  return {
    profile,
    numericStats,
    outliers,
    trends,
    comparisons,
    statusAnalyses,
    evidence,
    insights,
    charts,
    chartIssues,
  };
}

/** computeMetricTrend 的安全包装,捕获异常避免单字段失败拖垮整分析 */
function computeMetricTrendSafe(
  rows: DatasetRow[],
  timeField: string,
  metric: ColumnMeta,
): MetricTrend {
  try {
    return computeTrends(rows, timeField, [metric])[0];
  } catch {
    // 失败时返回空趋势,不阻断
    return {
      field: metric.name,
      granularity: "day",
      agg: "sum",
      points: [],
      first: null,
      last: null,
      absoluteChange: null,
      changeRate: null,
      sampleSize: 0,
    };
  }
}

/* —— 重新导出子模块,便于外部按需引用 —— */
export * from "./profile";
export * from "./statistics";
export * from "./trends";
export * from "./comparisons";
export * from "./outliers";
export * from "./evidence";
export * from "./recommend-charts";
