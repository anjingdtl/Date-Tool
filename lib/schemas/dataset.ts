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

/* ---------------------- 字段配置更新（预检阶段 D，SPEC 9.7） ---------------------- */

/** 单个字段配置更新项：只允许用户修改这些字段，其余元数据由服务端保留 */
export const FieldConfigItemSchema = z.object({
  name: z.string().min(1),
  type: ColumnTypeSchema,
  role: FieldRoleSchema,
  format: FieldFormatSchema,
  defaultAggregation: AggregationSchema,
  includeInAnalysis: z.boolean(),
});

export const FieldConfigUpdateSchema = z.object({
  columns: z.array(FieldConfigItemSchema).min(1),
  analysisConfig: DatasetAnalysisConfigSchema.optional(),
});

export type FieldConfigItem = z.infer<typeof FieldConfigItemSchema>;
export type FieldConfigUpdate = z.infer<typeof FieldConfigUpdateSchema>;

/** 校验失败的诊断信息（前端据此定位到具体字段） */
export interface FieldConfigIssue {
  level: "error" | "warning";
  field?: string;
  message: string;
}

/**
 * 服务端字段配置校验（SPEC 9.7）。
 *
 * 6 条规则：
 * 1. 至少一个参与分析的字段；
 * 2. metric 角色必须为 number 类型；
 * 3. time 角色最多一个；
 * 4. percentage 不得默认使用 sum；
 * 5. identifier 不得默认使用 sum 或 avg；
 * 6. 字段名必须唯一。
 *
 * 阻断错误（level=error）禁止 confirm；warning 仅提示。
 */
export function validateFieldConfig(
  input: FieldConfigUpdate,
): FieldConfigIssue[] {
  const issues: FieldConfigIssue[] = [];
  const cols = input.columns;

  // 1. 至少一个参与分析的字段
  const included = cols.filter((c) => c.includeInAnalysis && c.role !== "ignored");
  if (included.length === 0) {
    issues.push({
      level: "error",
      message: "至少需要保留一个参与分析的字段。",
    });
  }

  // 2. metric 角色必须为 number 类型
  for (const c of cols) {
    if (c.role === "metric" && c.type !== "number") {
      issues.push({
        level: "error",
        field: c.name,
        message: `字段「${c.name}」被设为 metric，但类型不是 number，无法聚合。`,
      });
    }
  }

  // 3. time 角色最多一个
  const timeFields = cols.filter((c) => c.role === "time" && c.includeInAnalysis);
  if (timeFields.length > 1) {
    issues.push({
      level: "error",
      field: timeFields[1].name,
      message: `time 角色最多一个主时间字段，但当前有 ${timeFields.length} 个：${timeFields
        .map((t) => t.name)
        .join("、")}。`,
    });
  }

  // 4. percentage 不得默认使用 sum
  for (const c of cols) {
    if (c.format === "percentage" && c.defaultAggregation === "sum") {
      issues.push({
        level: "error",
        field: c.name,
        message: `字段「${c.name}」为百分比格式，不得使用 sum 聚合（建议 avg）。`,
      });
    }
  }

  // 5. identifier 不得默认使用 sum 或 avg
  for (const c of cols) {
    if (
      c.role === "identifier" &&
      (c.defaultAggregation === "sum" || c.defaultAggregation === "avg")
    ) {
      issues.push({
        level: "error",
        field: c.name,
        message: `字段「${c.name}」为 identifier，不得使用 ${c.defaultAggregation} 聚合（建议 count）。`,
      });
    }
  }

  // 6. 字段名必须唯一
  const seen = new Map<string, number>();
  for (const c of cols) {
    seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      issues.push({
        level: "error",
        field: name,
        message: `字段名「${name}」重复出现 ${count} 次，字段名必须唯一。`,
      });
    }
  }

  return issues;
}

/** 是否存在阻断错误 */
export function hasBlockingIssues(issues: FieldConfigIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
