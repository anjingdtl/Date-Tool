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

/** 分析证据（v0.2 新增） */
export interface AnalysisEvidence {
  id: string;
  title: string;
  description: string;
  fields: string[];
  method:
    | "summary"
    | "group_compare"
    | "trend"
    | "top_bottom"
    | "status_distribution"
    | "missingness"
    | "outlier"
    | "change_rate";
  result: Record<string, unknown>;
  sampleSize: number;
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

export type ChartType = "bar" | "line" | "pie" | "table";

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
}

export type EChartsOption = Record<string, unknown>;

export interface AnalysisResult {
  /** v0.2：local 表示纯本地计算，local+llm 表示本地计算 + LLM 解读 */
  provider: "local" | "local+llm" | "mock" | "llm";
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

/** LLM 解读输出（v0.2 新增） */
export interface LLMInterpretation {
  summary: string;
  narrative: string;
  actions: string[];
  renamedChartTitles?: Record<string, string>;
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
