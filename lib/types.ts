export type ColumnType = "number" | "string" | "date" | "boolean";

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  sampleValues: unknown[];
}

export interface Dataset {
  id: string;
  name: string;
  fileName: string;
  source: "csv" | "excel";
  rowCount: number;
  columns: ColumnMeta[];
  createdAt: string;
}

export type DatasetRow = Record<string, unknown>;

export interface StoredDataset extends Dataset {
  rows: DatasetRow[];
  analysis: AnalysisResult | null;
}

export type ChartType = "bar" | "line" | "pie" | "table";

export type Aggregation = "sum" | "avg" | "count" | "max" | "min";

export interface ChartSpec {
  id: string;
  title: string;
  type: ChartType;
  xField: string;
  yField: string;
  groupBy?: string;
  agg?: Aggregation;
  description?: string;
}

export type EChartsOption = Record<string, unknown>;

export interface AnalysisResult {
  provider: "mock" | "llm";
  summary: string;
  insights: string[];
  charts: ChartSpec[];
  /** 服务端预计算好的 ECharts 配置，前端直接渲染，无需搬运原始数据 */
  options: EChartsOption[];
  narrative: string;
  createdAt: string;
}

/** 数据集公开投影（不含原始行，用于列表/详情摘要） */
export type PublicDataset = Dataset & { hasAnalysis: boolean };

/** 数据集详情（含前 N 行预览与已缓存的分析结果） */
export type DatasetDetail = PublicDataset & {
  previewRows: DatasetRow[];
  analysis: AnalysisResult | null;
};

/** 上传接口返回 */
export type UploadResult = PublicDataset & { truncated: boolean };
