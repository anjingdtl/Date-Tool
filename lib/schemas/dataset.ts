import { z } from "zod";

/** 数据集 ID：必须是 UUID，防路径遍历与非法输入 */
export const DatasetIdSchema = z.string().uuid();

export function isValidDatasetId(id: string): boolean {
  return DatasetIdSchema.safeParse(id).success;
}

export const ColumnTypeSchema = z.enum(["number", "string", "date", "boolean"]);
export const FieldRoleSchema = z.enum([
  "time",
  "metric",
  "dimension",
  "status",
  "identifier",
  "ignored",
]);
export const FieldFormatSchema = z.enum([
  "plain",
  "integer",
  "decimal",
  "percentage",
  "currency",
  "duration",
  "date",
  "datetime",
]);
export const AggregationSchema = z.enum([
  "sum",
  "avg",
  "count",
  "max",
  "min",
]);

/** 字段元数据（可选字段宽松校验，兼容旧数据） */
export const ColumnMetaSchema = z.object({
  name: z.string().min(1),
  originalName: z.string().optional(),
  type: ColumnTypeSchema,
  role: FieldRoleSchema.optional(),
  format: FieldFormatSchema.optional(),
  sampleValues: z.array(z.unknown()),
  nullable: z.boolean().optional(),
  nullCount: z.number().int().min(0).optional(),
  nullRate: z.number().min(0).max(1).optional(),
  distinctCount: z.number().int().min(0).optional(),
  confidence: z.number().min(0).max(1).optional(),
  includeInAnalysis: z.boolean().optional(),
  defaultAggregation: AggregationSchema.optional(),
  userModified: z.boolean().optional(),
});

export const DatasetStatusSchema = z.enum([
  "draft",
  "ready",
  "analyzing",
  "completed",
  "error",
]);

export const DataQualityWarningSchema = z.object({
  code: z.enum([
    "TRUNCATED",
    "HIGH_NULL_RATE",
    "MIXED_TYPE",
    "DUPLICATE_ROWS",
    "INVALID_DATE",
    "POSSIBLE_IDENTIFIER",
    "HIGH_CARDINALITY",
    "EMPTY_COLUMN",
    "DUPLICATE_COLUMN_NAME",
  ]),
  level: z.enum(["info", "warning", "error"]),
  field: z.string().optional(),
  message: z.string(),
});

export const DataQualityReportSchema = z.object({
  originalRowCount: z.number().int().min(0),
  storedRowCount: z.number().int().min(0),
  columnCount: z.number().int().min(0),
  duplicateRowCount: z.number().int().min(0),
  emptyRowCount: z.number().int().min(0),
  warnings: z.array(DataQualityWarningSchema),
  generatedAt: z.string(),
});

export const DatasetAnalysisConfigSchema = z.object({
  timeField: z.string().optional(),
  primaryDimension: z.string().optional(),
  statusFields: z.array(z.string()),
  metricFields: z.array(z.string()),
  ignoredFields: z.array(z.string()),
  maxCharts: z.number().int().min(1).max(20),
});
