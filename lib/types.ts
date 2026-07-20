/**
 * Date-Tool 数据模型
 *
 * v0.2 扩展：字段角色 / 格式 / 数据质量报告 / 数据集状态 / 分析配置 / 分析证据。
 * 为保证旧数据集与现有 analyzer/chart 代码在渐进改造中不破坏，
 * 新增字段多为可选；阶段 C（parse 重写）与阶段 E（analyzer 重写）会填全并收紧。
 */

export type ColumnType = "number" | "string" | "date" | "boolean";

/** 字段业务角色（v0.2 新增） */
export type FieldRole =
  | "time"
  | "metric"
  | "dimension"
  | "status"
  | "identifier"
  | "ignored";

/** 字段格式（v0.2 新增） */
export type FieldFormat =
  | "plain"
  | "integer"
  | "decimal"
  | "percentage"
  | "currency"
  | "duration"
  | "date"
  | "datetime";

export type Aggregation = "sum" | "avg" | "count" | "max" | "min";

export interface ColumnMeta {
  name: string;
  /** 原始列名（清理前），v0.2 新增 */
  originalName?: string;
  type: ColumnType;
  /** 业务角色，v0.2 新增（旧数据可能缺失） */
  role?: FieldRole;
  /** 字段格式，v0.2 新增（旧数据可能缺失） */
  format?: FieldFormat;
  sampleValues: unknown[];
  /** 是否允许空值，v0.2 新增 */
  nullable?: boolean;
  /** 空值数量，v0.2 新增 */
  nullCount?: number;
  /** 空值率 0~1，v0.2 新增 */
  nullRate?: number;
  /** 去重后取值数，v0.2 新增 */
  distinctCount?: number;
  /** 推断置信度 0~1，v0.2 新增 */
  confidence?: number;
  /** 采样类型分布（v0.2.1 新增，用于 MIXED_TYPE 真实判断，SPEC 10.4 / 11.1） */
  typeDistribution?: Record<ColumnType, number>;
  /** 采样非空数（v0.2.1 新增，confidence 的分母，SPEC 10.3） */
  sampleNonNullCount?: number;
  /** 是否参与分析，v0.2 新增（默认 true） */
  includeInAnalysis?: boolean;
  /** 默认聚合方式，v0.2 新增 */
  defaultAggregation?: Aggregation;
  /** 用户是否手动修改过，v0.2 新增 */
  userModified?: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  fileName: string;
  source: "csv" | "excel";
  rowCount: number;
  /** 原文件解析出的总行数（截断前），v0.2 新增 */
  originalRowCount?: number;
  /** 实际存储行数，v0.2 新增 */
  storedRowCount?: number;
  /** 选中工作表名，v0.2 新增 */
  sheetName?: string;
  /** Excel 文件中所有可用工作表名（仅 Excel 来源）；用于 UI 提示用户切换需重新上传。 */
  availableSheets?: string[];
  columns: ColumnMeta[];
  createdAt: string;
}

export type DatasetRow = Record<string, unknown>;

/** 数据集状态（v0.2 新增） */
export type DatasetStatus =
  | "draft"
  | "ready"
  | "analyzing"
  | "completed"
  | "error";

/** 数据质量警告（v0.2 新增） */
export interface DataQualityWarning {
  code:
    | "TRUNCATED"
    | "HIGH_NULL_RATE"
    | "MIXED_TYPE"
    | "DUPLICATE_ROWS"
    | "INVALID_DATE"
    | "INVALID_NUMBER"
    | "POSSIBLE_IDENTIFIER"
    | "HIGH_CARDINALITY"
    | "EMPTY_COLUMN"
    | "DUPLICATE_COLUMN_NAME";
  level: "info" | "warning" | "error";
  field?: string;
  message: string;
}

/** 数据质量报告（v0.2 新增） */
export interface DataQualityReport {
  originalRowCount: number;
  storedRowCount: number;
  columnCount: number;
  duplicateRowCount: number;
  emptyRowCount: number;
  warnings: DataQualityWarning[];
  generatedAt: string;
}

/** 分析配置（v0.2 新增） */
export interface DatasetAnalysisConfig {
  timeField?: string;
  primaryDimension?: string;
  statusFields: string[];
  metricFields: string[];
  ignoredFields: string[];
  maxCharts: number;
}

/**
 * 证据计算方法（v0.3 扩展，SPEC 13.4）。
 *
 * v0.2 原有 8 种保留；v0.3 工具注册表新增 7 种，与 AnalysisOperator 对应。
 */
export type EvidenceMethod =
  | "summary"
  | "group_compare"
  | "trend"
  | "top_bottom"
  | "status_distribution"
  | "missingness"
  | "outlier"
  | "change_rate"
  | "aggregate"
  | "distribution"
  | "ranking"
  | "ratio"
  | "growth"
  | "correlation"
  | "pivot";

/** 分析证据（v0.2 新增；v0.3 扩展任务关联字段，SPEC 13.4） */
export interface AnalysisEvidence {
  id: string;
  title: string;
  description: string;
  fields: string[];
  method: EvidenceMethod;
  result: Record<string, unknown>;
  sampleSize: number;
  /** v0.3：产生该证据的分析任务 ID */
  taskId?: string;
  /** v0.3：产生该证据的操作符 */
  operator?: AnalysisOperator;
  /** v0.3：任务参数快照 */
  parameters?: Record<string, unknown>;
  /** v0.3：任务输入哈希（用于缓存与可复现） */
  inputHash?: string;
  /** v0.3：任务结果哈希 */
  resultHash?: string;
  /** v0.3：生成时间 */
  generatedAt?: string;
}

/** 本地确定性洞察（v0.2 新增） */
export interface ComputedInsight {
  id: string;
  level: "info" | "positive" | "warning";
  title: string;
  statement: string;
  evidenceId: string;
  fields: string[];
}

export interface StoredDataset extends Dataset {
  rows: DatasetRow[];
  /** v0.2 新增：数据集状态 */
  status?: DatasetStatus;
  /** v0.2 新增：数据质量报告 */
  quality?: DataQualityReport;
  /** v0.2 新增：分析配置 */
  config?: DatasetAnalysisConfig;
  /** 最近一次分析结果（向后兼容字段） */
  analysis: AnalysisResult | null;
  /** v0.2 新增：分析历史（最近 3 次） */
  analyses?: AnalysisResult[];
}

export type ChartType =
  | "bar"
  | "line"
  | "pie"
  | "table"
  | "area"
  | "stacked_bar"
  | "scatter"
  | "heatmap"
  | "kpi";

export interface ChartSpec {
  id: string;
  title: string;
  type: ChartType;
  xField: string;
  yField: string;
  groupBy?: string;
  agg?: Aggregation;
  description?: string;
  /** v0.2 新增：关联证据 ID */
  evidenceId?: string;
  /** v0.2 新增：Top N 限制 */
  limit?: number;
  /** v0.3 编译后的表格行；只含确定性任务输出，不是原始全量数据。 */
  dataRows?: DatasetRow[];
  /** v0.3 KPI 卡片值。 */
  scalar?: number | string | null;
}

export type EChartsOption = Record<string, unknown>;

export interface AnalysisResult {
  /** v0.2.1：统一为 local（纯本地）/ local+llm（本地 + LLM 解读），旧 mock/llm 读取时迁移 */
  provider: "local" | "local+llm";
  summary: string;
  insights: string[];
  charts: ChartSpec[];
  /** 服务端预计算好的 ECharts 配置，前端直接渲染，无需搬运原始数据 */
  options: EChartsOption[];
  narrative: string;
  createdAt: string;
  /** v0.2 新增：分析证据 */
  evidence?: AnalysisEvidence[];
  /** v0.2 新增：本地确定性洞察 */
  computedInsights?: ComputedInsight[];
  /** v0.2 新增：警告 */
  warnings?: string[];
  /** v0.2 新增：分析引擎版本 */
  version?: string;
}

/** 数据集公开投影（不含原始行，用于列表/详情摘要） */
export type PublicDataset = Dataset & {
  hasAnalysis: boolean;
  /** v0.2 新增 */
  status?: DatasetStatus;
};

/** 数据集详情（含前 N 行预览与已缓存的分析结果） */
export type DatasetDetail = PublicDataset & {
  previewRows: DatasetRow[];
  analysis: AnalysisResult | null;
  /** v0.2 新增 */
  quality?: DataQualityReport;
  /** v0.2 新增 */
  config?: DatasetAnalysisConfig;
  /** v0.2 新增：分析历史 */
  analyses?: AnalysisResult[];
};

/** 上传接口返回 */
export type UploadResult = PublicDataset & { truncated: boolean };

/** 预检详情（v0.2 新增） */
export type PreviewDetail = DatasetDetail & {
  originalRowCount: number;
  storedRowCount: number;
};

/* ============================================================ *
 * v0.3.0 —— LLM 指挥中枢数据分析 Agent
 *
 * 以下类型均为纯 TS 契约，对应运行时 Zod schema 见 lib/schemas/*。
 * 分区：状态机 / 语义 / 公式 / 计划 / 执行 / Review / Patch /
 *       Session·Revision / DataContext / 最终结果。
 * SPEC：docs/Date-Tool v0.3.0-LLM 指挥中枢数据分析 Agent 改造规格.md
 * ============================================================ */

/* ----------------------- 状态机（SPEC 8） ----------------------- */

/** 数据集理解流程状态（SPEC 8.2） */
export type UnderstandingStatus =
  | "not_started"
  | "building_context"
  | "understanding"
  | "needs_user_input"
  | "ready_for_confirmation"
  | "confirmed"
  | "failed"
  | "fallback";

/** 分析会话状态（SPEC 8.3） */
export type AnalysisSessionStatus =
  | "planning"
  | "validating_plan"
  | "executing"
  | "reviewing"
  | "needs_user_input"
  | "revising"
  | "completed"
  | "error"
  | "cancelled";

/** 单次 Revision 状态（SPEC 8.4） */
export type RevisionStatus =
  | "draft"
  | "executing"
  | "reviewing"
  | "approved"
  | "needs_user_input"
  | "failed";

/** 分析模式（SPEC 17.1）：区分 LLM 编排与本地规则降级 */
export type AnalysisMode = "rule_fallback" | "llm_orchestrated";

/* ----------------------- 语义层（SPEC 10） ----------------------- */

/** 数据集业务类型（SPEC 10.2） */
export type DatasetKind =
  | "time_series"
  | "transaction"
  | "event_log"
  | "cross_section"
  | "survey"
  | "inventory"
  | "kpi_wide"
  | "kpi_long"
  | "matrix"
  | "mixed"
  | "unknown";

/** 表格结构（SPEC 10.2） */
export type TableShape =
  | "tidy_rows"
  | "wide_metrics"
  | "long_metrics"
  | "cross_table"
  | "multi_header"
  | "summary_with_subtotals"
  | "multi_sheet"
  | "unknown";

/** 语义字段角色（SPEC 10.2）：与物理 ColumnMeta.role 分离的业务角色 */
export type SemanticFieldRole =
  | "time"
  | "dimension"
  | "metric"
  | "status"
  | "identifier"
  | "text"
  | "ignored";

/** 指标度量行为（SPEC 10.2） */
export type MeasureBehavior =
  | "flow"
  | "stock"
  | "rate"
  | "duration"
  | "score"
  | "currency"
  | "count"
  | "unknown";

/** 语义子角色（SPEC 10.2） */
export type SemanticSubRole =
  | "actual"
  | "target"
  | "numerator"
  | "denominator"
  | "category_code"
  | "category_label"
  | "time_part"
  | "unit"
  | "none";

/** 计划操作符（SPEC 12.2） */
export type AnalysisOperator =
  | "profile"
  | "aggregate"
  | "timeseries"
  | "compare"
  | "distribution"
  | "ranking"
  | "ratio"
  | "growth"
  | "correlation"
  | "anomaly"
  | "pivot";

/** 语义聚合建议（SPEC 10.2）：比物理 Aggregation 多 median/last/none */
export type SemanticAggregation =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "median"
  | "last"
  | "none";

/* ----------------------- 安全公式 AST（SPEC 11） ----------------------- */

/**
 * 结构化公式表达式（SPEC 11.2）。
 *
 * 禁止字符串动态执行（eval / new Function）；所有派生指标必须用此 AST。
 * 限制：最大深度 8、最大节点 40、字段必须存在、除零显式处理。
 */
export type FormulaExpression =
  | { op: "field"; field: string }
  | { op: "const"; value: number }
  | {
      op: "add" | "subtract" | "multiply" | "divide";
      left: FormulaExpression;
      right: FormulaExpression;
    }
  | {
      op: "safe_divide";
      numerator: FormulaExpression;
      denominator: FormulaExpression;
      whenZero: "null" | "zero";
    }
  | {
      op: "abs" | "round";
      value: FormulaExpression;
      digits?: number;
    };

/* ----------------------- 数据理解（SPEC 10.2） ----------------------- */

/** 单字段语义理解（SPEC 10.2） */
export interface FieldUnderstanding {
  field: string;
  semanticName: string;
  role: SemanticFieldRole;
  measureBehavior: MeasureBehavior;
  subRole: SemanticSubRole;
  businessMeaning: string;
  recommendedAggregation: SemanticAggregation;
  naturalOrder?: string[];
  confidence: number;
  reason: string;
  /** 语义事实来源；用户修正拥有最高优先级。 */
  source?: "llm" | "user" | "fallback";
}

/** 字段间关系（SPEC 10.2） */
export interface FieldRelationship {
  id: string;
  fields: string[];
  relation:
    | "actual_target"
    | "numerator_denominator"
    | "hierarchy"
    | "code_label"
    | "time_parts"
    | "unit_binding"
    | "same_measure_different_period"
    | "other";
  description: string;
  confidence: number;
}

/** 派生指标建议（SPEC 10.2） */
export interface DerivedMetricSuggestion {
  id: string;
  name: string;
  formula: FormulaExpression;
  description: string;
  unit?: string;
  confidence: number;
  requiresUserConfirmation: boolean;
}

/** 理解歧义（SPEC 10.2） */
export interface UnderstandingAmbiguity {
  id: string;
  fields: string[];
  question: string;
  choices?: Array<{
    id: string;
    label: string;
    patch: Partial<FieldUnderstanding>[];
  }>;
  blocking: boolean;
}

/** 数据集理解状态值（DatasetUnderstanding.status，SPEC 10.2，4 值子集） */
export type UnderstandingStateValue =
  | "needs_user_input"
  | "ready_for_confirmation"
  | "confirmed"
  | "fallback";

/** 数据集语义理解（SPEC 10.2）—— 业务语义权威来源 */
export interface DatasetUnderstanding {
  version: "v1";
  id: string;
  datasetId: string;
  datasetKind: DatasetKind;
  tableShape: TableShape;
  businessDomain: string;
  businessDescription: string;
  grainDescription: string;
  rowMeaning: string;
  selectedSheets: string[];
  fields: FieldUnderstanding[];
  relationships: FieldRelationship[];
  derivedMetrics: DerivedMetricSuggestion[];
  recommendedObjectives: string[];
  ambiguities: UnderstandingAmbiguity[];
  confidence: number;
  status: UnderstandingStateValue;
  createdAt: string;
  confirmedAt?: string;
}

/* ----------------------- DataContext（SPEC 9.2） ----------------------- */

/** 表头候选（SPEC 9.2） */
export interface HeaderCandidate {
  startRow: number;
  rowCount: number;
  generatedNames: string[];
  confidence: number;
}

/** 工作表上下文（SPEC 9.2） */
export interface SheetContext {
  name: string;
  rawRowCount: number;
  rawColumnCount: number;
  headerCandidates: HeaderCandidate[];
  mergedRanges?: string[];
  previewMatrix: unknown[][];
  likelyDataStartRow: number;
  likelyHeaderRowCount: number;
  notes: string[];
}

/** 工作簿上下文（SPEC 9.2） */
export interface WorkbookContext {
  fileName: string;
  source: "csv" | "excel";
  sheetCount: number;
  sheets: SheetContext[];
  selectedSheetNames: string[];
}

/** 列数值统计（SPEC 9.2） */
export interface ColumnNumericStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  std: number;
  zeroCount: number;
  negativeCount: number;
}

/** 列日期统计（SPEC 9.2） */
export interface ColumnDateStats {
  min: string;
  max: string;
  distinctDays: number;
}

/** 单列数据上下文（SPEC 9.2）—— 只含客观数据，不含业务角色结论 */
export interface ColumnDataContext {
  name: string;
  originalName?: string;
  detectedType: ColumnType;
  detectedFormat: FieldFormat;
  typeDistribution: Record<ColumnType, number>;
  sampleNonNullCount: number;
  nullCount: number;
  nullRate: number;
  distinctCount: number;
  sampleValues: unknown[];
  representativeValues: unknown[];
  topValues?: Array<{ value: unknown; count: number; rate: number }>;
  numericStats?: ColumnNumericStats;
  dateStats?: ColumnDateStats;
  possibleSensitive: boolean;
  heuristicHints: string[];
}

/** LLM 首轮理解的客观数据上下文（SPEC 9.2） */
export interface DataContext {
  version: "v1";
  datasetId: string;
  datasetName: string;
  workbook: WorkbookContext;
  rowCount: number;
  storedRowCount: number;
  columns: ColumnDataContext[];
  sampledRows: DatasetRow[];
  boundaryRows: DatasetRow[];
  anomalyCandidateRows: DatasetRow[];
  quality: DataQualityReport;
  userDescription?: string;
  tokenBudget: {
    estimatedTokens: number;
    truncated: boolean;
    omittedSections: string[];
  };
  generatedAt: string;
}

/* ----------------------- 分析计划（SPEC 12） ----------------------- */

/** 任务筛选条件（SPEC 12.3） */
export interface TaskFilter {
  field: string;
  operator:
    | "eq"
    | "neq"
    | "in"
    | "not_in"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "between"
    | "contains";
  value: unknown;
}

/** 任务排序（SPEC 12.3） */
export interface TaskSort {
  field: string;
  direction: "asc" | "desc";
}

/** 任务内联公式（SPEC 12.3） */
export interface TaskFormula {
  outputField: string;
  expression: FormulaExpression;
  format?: FieldFormat;
}

/** 任务时间配置（SPEC 12.3） */
export interface TaskTimeConfig {
  field: string;
  grain: "day" | "week" | "month" | "quarter" | "year";
}

/** 受控分析任务（SPEC 12.3）—— LLM 规划、本地执行 */
export interface AnalysisTask {
  id: string;
  operator: AnalysisOperator;
  title: string;
  purpose: string;
  dimensions: string[];
  metrics: string[];
  filters: TaskFilter[];
  aggregation?: "sum" | "avg" | "count" | "min" | "max" | "median" | "last";
  time?: TaskTimeConfig;
  formula?: TaskFormula;
  compareMode?: "absolute" | "difference" | "rate";
  anomalyMethod?: "iqr" | "zscore";
  sort?: TaskSort;
  limit?: number;
  dependsOn: string[];
  expectedOutput:
    | "scalar"
    | "series"
    | "category_table"
    | "matrix"
    | "records";
  priority: number;
}

/** 计划图表类型（SPEC 12.4） */
export type PlannedChartType =
  | "line"
  | "bar"
  | "pie"
  | "area"
  | "stacked_bar"
  | "scatter"
  | "heatmap"
  | "table"
  | "kpi";

/** 看板单项计划（SPEC 12.4） */
export interface DashboardItemPlan {
  id: string;
  taskId: string;
  type: PlannedChartType;
  title: string;
  description: string;
  rationale: string;
  priority: number;
  width: "full" | "half" | "third";
  visible: boolean;
}

/** 看板分区（SPEC 12.4） */
export interface DashboardSectionPlan {
  id: string;
  title: string;
  description?: string;
  itemIds: string[];
  order: number;
}

/** 看板计划（SPEC 12.4） */
export interface DashboardPlan {
  items: DashboardItemPlan[];
  sections: DashboardSectionPlan[];
}

/** 分析计划（SPEC 12.5） */
export interface AnalysisPlan {
  version: "v1";
  id: string;
  datasetId: string;
  understandingId: string;
  objectives: string[];
  assumptions: string[];
  tasks: AnalysisTask[];
  dashboard: DashboardPlan;
  questionsForUser: string[];
  createdAt: string;
}

/* ----------------------- 任务执行（SPEC 13） ----------------------- */

/** 执行结果列定义（SPEC 13.3） */
export interface ResultColumn {
  name: string;
  type: "string" | "number" | "date" | "boolean";
  format?: FieldFormat;
}

/** 任务执行结果（SPEC 13.3）—— 本地确定性计算输出，含 Evidence */
export interface TaskExecutionResult {
  taskId: string;
  operator: AnalysisOperator;
  status: "success" | "partial" | "skipped" | "failed";
  columns: ResultColumn[];
  rows: DatasetRow[];
  scalar?: number | string | null;
  summary: {
    rowCount: number;
    nullCount: number;
    truncated: boolean;
  };
  warnings: string[];
  evidence: AnalysisEvidence[];
  inputHash: string;
  resultHash: string;
  durationMs: number;
}

/** 计划执行汇总（SPEC 14.3） */
export interface PlanExecutionResult {
  results: Record<string, TaskExecutionResult>;
  taskOrder: string[];
  cacheHits: number;
  durationMs: number;
}

/** 工具校验结果（SPEC 13.2） */
export interface ToolValidationResult {
  ok: boolean;
  issues: Array<{
    code: string;
    field?: string;
    message: string;
    level: "warning" | "error";
  }>;
}

/** 工具执行上下文（SPEC 13.2） */
export interface ToolExecutionContext {
  dataset: StoredDataset;
  understanding: DatasetUnderstanding;
  priorResults: Record<string, TaskExecutionResult>;
  requestId: string;
}

/** 确定性工具定义（SPEC 13.2）—— 注册表分派入口 */
export interface ToolDefinition {
  operator: AnalysisOperator;
  validate(
    task: AnalysisTask,
    context: ToolExecutionContext,
  ): ToolValidationResult;
  execute(
    task: AnalysisTask,
    context: ToolExecutionContext,
  ): Promise<TaskExecutionResult>;
}

/* ----------------------- LLM 终审（SPEC 15） ----------------------- */

/** 终审发现（SPEC 15.3） */
export interface ReviewFinding {
  id: string;
  level: "info" | "positive" | "warning" | "possible_error";
  title: string;
  statement: string;
  evidenceIds: string[];
  taskIds: string[];
}

/** 图表终审决策（SPEC 15.3） */
export interface ChartReviewDecision {
  itemId: string;
  action: "keep" | "remove" | "replace" | "reorder" | "rename";
  reason: string;
  replacement?: Partial<DashboardItemPlan>;
}

/** LLM 终审结果（SPEC 15.3） */
export interface AnalysisReview {
  version: "v1";
  status: "approved" | "revise" | "needs_user_input";
  executiveSummary: string;
  narrative: string;
  findings: ReviewFinding[];
  chartDecisions: ChartReviewDecision[];
  planPatch?: AnalysisPlanPatch;
  questionsForUser: string[];
  assumptions: string[];
  createdAt: string;
}

/* ----------------------- 用户微调 Patch（SPEC 16） ----------------------- */

/** 理解层 Patch（SPEC 16.2） */
export interface UnderstandingPatch {
  datasetKind?: DatasetKind;
  tableShape?: TableShape;
  businessDescription?: string;
  grainDescription?: string;
  rowMeaning?: string;
  selectedSheets?: string[];
  fields?: Array<{
    field: string;
    changes: Partial<FieldUnderstanding>;
  }>;
  relationshipsToAdd?: FieldRelationship[];
  relationshipsToRemove?: string[];
  derivedMetricsToAdd?: DerivedMetricSuggestion[];
  derivedMetricsToRemove?: string[];
}

/** 看板变更（SPEC 16.2） */
export interface DashboardChanges {
  removeItems: string[];
  updateItems: Array<{
    itemId: string;
    changes: Partial<DashboardItemPlan>;
  }>;
  reorderItems?: string[];
  sectionChanges?: DashboardSectionPlan[];
}

/** 用户自然语言微调的结构化 Patch（SPEC 16.2） */
export interface AnalysisPlanPatch {
  version: "v1";
  baseRevisionId: string;
  intentSummary: string;
  understandingPatch?: UnderstandingPatch;
  removeTasks: string[];
  updateTasks: Array<{
    taskId: string;
    changes: Partial<AnalysisTask>;
  }>;
  addTasks: AnalysisTask[];
  dashboardChanges: DashboardChanges;
  userHardConstraints: string[];
  explanation: string;
}

/* ----------------------- Session 与 Revision（SPEC 16.5 / 19） ----------------------- */

/** 分析会话（SPEC 19.1） */
export interface AnalysisSession {
  id: string;
  datasetId: string;
  status: AnalysisSessionStatus;
  activeRevisionId: string;
  revisionIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** 单次分析 Revision（SPEC 16.5） */
export interface AnalysisRevision {
  id: string;
  sessionId: string;
  parentRevisionId?: string;
  sequence: number;
  status: RevisionStatus;
  source: "initial" | "review" | "user";
  userInstruction?: string;
  understandingSnapshot: DatasetUnderstanding;
  plan: AnalysisPlan;
  execution: PlanExecutionResult | null;
  review: AnalysisReview | null;
  finalResult: FinalAnalysisResult | null;
  createdAt: string;
}

/* ----------------------- 最终结果（SPEC 17） ----------------------- */

/** 最终结果中的计划摘要（SPEC 17.2） */
export interface PlanSummary {
  objectiveCount: number;
  taskCount: number;
  succeededTaskCount: number;
  failedTaskCount: number;
}

/** 终审状态（SPEC 17.2） */
export type ReviewStatus =
  | "approved"
  | "approved_with_warnings"
  | "needs_user_input"
  | "unavailable";

/**
 * v0.3 最终分析结果（SPEC 17.2）。
 *
 * 继承 AnalysisResult 以保持旧 UI 与旧缓存可读；新增 analysisMode 区分
 * LLM 编排（llm_orchestrated）与本地规则降级（rule_fallback）。
 */
export interface FinalAnalysisResult extends AnalysisResult {
  version: "v0.3.0";
  analysisMode: AnalysisMode;
  sessionId?: string;
  revisionId?: string;
  understandingId?: string;
  reviewStatus?: ReviewStatus;
  planSummary?: PlanSummary;
  findings?: ReviewFinding[];
  questionsForUser?: string[];
}
