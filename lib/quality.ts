/**
 * lib/quality.ts
 *
 * 数据质量报告生成（SPEC 7.6 / 11）。
 * 从 parse.ts 提取为可复用纯函数，供 parse 阶段与 confirm 阶段重复生成。
 *
 * 阶段 6 会增强 MIXED_TYPE（基于 typeDistribution）与采样；
 * 本阶段先接入 invalidNumberCounts / invalidDateCounts，产生
 * INVALID_NUMBER / INVALID_DATE 警告（SPEC 11.2 / 11.3 方案 A）。
 */
import type {
  ColumnMeta,
  DataQualityReport,
  DataQualityWarning,
  DatasetRow,
} from "./types";

/** 行存储上限，用于 TRUNCATED 文案（与 parse.ts MAX_STORED_ROWS 保持一致） */
const MAX_STORED_ROWS = 50000;

export interface QualityInput {
  rows: DatasetRow[];
  columns: ColumnMeta[];
  originalRowCount: number;
  storedRowCount: number;
  truncated: boolean;
  duplicateRenamed: boolean;
  invalidNumberCounts?: Record<string, number>;
  invalidDateCounts?: Record<string, number>;
}

export function generateDataQuality(input: QualityInput): DataQualityReport {
  const {
    rows,
    columns,
    originalRowCount,
    storedRowCount,
    truncated,
    duplicateRenamed,
    invalidNumberCounts = {},
    invalidDateCounts = {},
  } = input;

  const warnings: DataQualityWarning[] = [];

  if (truncated) {
    warnings.push({
      code: "TRUNCATED",
      level: "warning",
      message: `数据超过 ${MAX_STORED_ROWS} 行上限，仅保留前 ${storedRowCount} 行进行分析（共 ${originalRowCount} 行）。`,
    });
  }

  if (duplicateRenamed) {
    warnings.push({
      code: "DUPLICATE_COLUMN_NAME",
      level: "warning",
      message: "存在重名列，已自动加后缀（_2、_3…）以区分。",
    });
  }

  // 列级警告
  for (const c of columns) {
    const nullRate = c.nullRate ?? 0;
    if (rows.length > 0 && nullRate >= 1) {
      warnings.push({
        code: "EMPTY_COLUMN",
        level: "error",
        field: c.name,
        message: `列「${c.name}」全部为空。`,
      });
    } else if (nullRate > 0.3) {
      warnings.push({
        code: "HIGH_NULL_RATE",
        level: "warning",
        field: c.name,
        message: `列「${c.name}」空值率 ${(nullRate * 100).toFixed(0)}%，可能影响分析。`,
      });
    }
    // MIXED_TYPE（SPEC 11.1）：基于 typeDistribution 真实判断，不依赖最终推断类型
    const td = c.typeDistribution;
    if (td) {
      const counts = [td.number, td.date, td.boolean, td.string].sort(
        (a, b) => b - a,
      );
      const total = counts.reduce((a, b) => a + b, 0);
      if (total >= 5) {
        const main = counts[0] ?? 0;
        const second = counts[1] ?? 0;
        if (second / total >= 0.1 || main / total < 0.9) {
          const parts: string[] = [];
          if (td.number) parts.push("数字");
          if (td.date) parts.push("日期");
          if (td.boolean) parts.push("布尔");
          if (td.string) parts.push("文本");
          warnings.push({
            code: "MIXED_TYPE",
            level: "warning",
            field: c.name,
            message: `字段「${c.name}」包含混合类型（${parts.join("与")}），建议检查或拆分。`,
          });
        }
      }
    } else if (c.confidence !== undefined && c.confidence < 0.8) {
      // 旧数据无 typeDistribution 时回退
      warnings.push({
        code: "MIXED_TYPE",
        level: "info",
        field: c.name,
        message: `列「${c.name}」类型推断置信度 ${((c.confidence ?? 0) * 100).toFixed(0)}%，存在混合类型。`,
      });
    }
    if (
      c.type === "string" &&
      (c.distinctCount ?? 0) > 50 &&
      (c.distinctCount ?? 0) < rows.length
    ) {
      warnings.push({
        code: "HIGH_CARDINALITY",
        level: "info",
        field: c.name,
        message: `列「${c.name}」取值 ${c.distinctCount} 类，基数较高。`,
      });
    }
    if (
      rows.length > 10 &&
      c.distinctCount === rows.length &&
      c.role !== "identifier"
    ) {
      warnings.push({
        code: "POSSIBLE_IDENTIFIER",
        level: "info",
        field: c.name,
        message: `列「${c.name}」每行取值唯一，可能是标识字段。`,
      });
    }

    // INVALID_DATE（SPEC 11.2）
    const invalidDate = invalidDateCounts[c.name] ?? 0;
    if (invalidDate > 0) {
      warnings.push({
        code: "INVALID_DATE",
        level: "warning",
        field: c.name,
        message: `字段「${c.name}」有 ${invalidDate} 个值无法解析为日期，已转为空值。`,
      });
    }
    // INVALID_NUMBER（SPEC 11.3 方案 A）
    const invalidNum = invalidNumberCounts[c.name] ?? 0;
    if (invalidNum > 0) {
      warnings.push({
        code: "INVALID_NUMBER",
        level: "warning",
        field: c.name,
        message: `字段「${c.name}」有 ${invalidNum} 个值无法解析为数字，已转为空值。`,
      });
    }
  }

  // 重复行 / 空行
  const seen = new Set<string>();
  let duplicateRowCount = 0;
  let emptyRowCount = 0;
  for (const row of rows) {
    const vals = Object.values(row);
    const allEmpty = vals.every(
      (v) => v === null || v === undefined || v === "",
    );
    if (allEmpty) {
      emptyRowCount++;
      continue;
    }
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicateRowCount++;
    else seen.add(key);
  }
  if (duplicateRowCount > 0) {
    warnings.push({
      code: "DUPLICATE_ROWS",
      level: "warning",
      message: `检测到 ${duplicateRowCount} 行完全重复。`,
    });
  }

  return {
    originalRowCount,
    storedRowCount,
    columnCount: columns.length,
    duplicateRowCount,
    emptyRowCount,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}
