/**
 * tests/executor-fixtures.ts
 *
 * 工具执行器测试共享夹具：KPI 宽表数据集 + 已确认理解 + 执行上下文。
 * 非 *.test.ts，不被 vitest 收集。
 */
import type {
  AnalysisTask,
  ColumnMeta,
  DatasetRow,
  DatasetUnderstanding,
  StoredDataset,
  ToolExecutionContext,
} from "@/lib/types";

const columns: ColumnMeta[] = [
  { name: "月份", type: "date", role: "time", format: "date", sampleValues: ["2025-01"] },
  { name: "地市", type: "string", role: "dimension", sampleValues: ["南宁", "柳州"], distinctCount: 2 },
  { name: "业务收入", type: "number", role: "metric", format: "currency", sampleValues: [1000] },
  { name: "目标收入", type: "number", role: "metric", format: "currency", sampleValues: [1200] },
  { name: "用户数", type: "number", role: "metric", sampleValues: [100] },
  { name: "满意度", type: "number", role: "metric", format: "percentage", sampleValues: [0.9] },
];

const rows: DatasetRow[] = [
  { 月份: "2025-01", 地市: "南宁", 业务收入: 1000, 目标收入: 1200, 用户数: 100, 满意度: 0.9 },
  { 月份: "2025-01", 地市: "柳州", 业务收入: 800, 目标收入: 1000, 用户数: 80, 满意度: 0.85 },
  { 月份: "2025-02", 地市: "南宁", 业务收入: 1100, 目标收入: 1200, 用户数: 110, 满意度: 0.92 },
  { 月份: "2025-02", 地市: "柳州", 业务收入: 900, 目标收入: 1000, 用户数: 85, 满意度: 0.88 },
  { 月份: "2025-03", 地市: "南宁", 业务收入: 1200, 目标收入: 1200, 用户数: 105, 满意度: 0.91 },
  { 月份: "2025-03", 地市: "柳州", 业务收入: 950, 目标收入: 1000, 用户数: 88, 满意度: 0.87 },
  { 月份: "2025-04", 地市: "南宁", 业务收入: 1300, 目标收入: 1200, 用户数: 108, 满意度: 0.93 },
  { 月份: "2025-04", 地市: "柳州", 业务收入: 980, 目标收入: 1000, 用户数: 90, 满意度: 0.89 },
];

export function makeKpiDataset(over: Partial<StoredDataset> = {}): StoredDataset {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    name: "通信运营KPI",
    fileName: "kpi.csv",
    source: "csv",
    rowCount: rows.length,
    originalRowCount: rows.length,
    storedRowCount: rows.length,
    columns,
    rows,
    createdAt: "2026-07-16T00:00:00.000Z",
    status: "ready",
    analysis: null,
    quality: {
      originalRowCount: rows.length,
      storedRowCount: rows.length,
      columnCount: columns.length,
      duplicateRowCount: 0,
      emptyRowCount: 0,
      warnings: [],
      generatedAt: "2026-07-16T00:00:00.000Z",
    },
    ...over,
  };
}

export function makeKpiUnderstanding(): DatasetUnderstanding {
  return {
    version: "v1",
    id: "und_kpi",
    datasetId: "44444444-4444-4444-8444-444444444444",
    datasetKind: "kpi_wide",
    tableShape: "wide_metrics",
    businessDomain: "通信运营",
    businessDescription: "各地市月度经营指标",
    grainDescription: "每行表示某地市某月的一组经营指标",
    rowMeaning: "地市月度经营记录",
    selectedSheets: ["Sheet1"],
    fields: [
      { field: "月份", semanticName: "月份", role: "time", measureBehavior: "unknown", subRole: "time_part", businessMeaning: "统计月份", recommendedAggregation: "none", confidence: 0.9, reason: "日期" },
      { field: "地市", semanticName: "地市", role: "dimension", measureBehavior: "unknown", subRole: "none", businessMeaning: "地市", recommendedAggregation: "none", confidence: 0.9, reason: "地区" },
      { field: "业务收入", semanticName: "业务收入", role: "metric", measureBehavior: "flow", subRole: "actual", businessMeaning: "当月收入", recommendedAggregation: "sum", confidence: 0.85, reason: "金额流量" },
      { field: "目标收入", semanticName: "目标收入", role: "metric", measureBehavior: "flow", subRole: "target", businessMeaning: "目标收入", recommendedAggregation: "sum", confidence: 0.85, reason: "目标" },
      { field: "用户数", semanticName: "用户数", role: "metric", measureBehavior: "stock", subRole: "actual", businessMeaning: "月末用户存量", recommendedAggregation: "last", confidence: 0.8, reason: "存量" },
      { field: "满意度", semanticName: "满意度", role: "metric", measureBehavior: "rate", subRole: "actual", businessMeaning: "满意度", recommendedAggregation: "avg", confidence: 0.8, reason: "比率" },
    ],
    relationships: [
      { id: "rel_1", fields: ["业务收入", "目标收入"], relation: "actual_target", description: "实际与目标", confidence: 0.8 },
    ],
    derivedMetrics: [],
    recommendedObjectives: ["收入趋势", "完成率"],
    ambiguities: [],
    confidence: 0.8,
    status: "confirmed",
    createdAt: "2026-07-16T00:00:00.000Z",
    confirmedAt: "2026-07-16T00:00:00.000Z",
  };
}

export function makeExecutorContext(
  over: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    dataset: makeKpiDataset(),
    understanding: makeKpiUnderstanding(),
    priorResults: {},
    requestId: "req-test",
    ...over,
  };
}

export function makeTask(over: Partial<AnalysisTask>): AnalysisTask {
  return {
    id: "t1",
    operator: "aggregate",
    title: "测试任务",
    purpose: "测试",
    dimensions: [],
    metrics: [],
    filters: [],
    dependsOn: [],
    expectedOutput: "category_table",
    priority: 1,
    ...over,
  };
}
