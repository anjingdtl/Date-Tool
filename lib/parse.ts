import Papa from "papaparse";
import * as XLSX from "xlsx";
import type {
  Aggregation,
  ColumnMeta,
  ColumnType,
  DataQualityReport,
  DatasetRow,
  FieldFormat,
  FieldRole,
} from "./types";
import {
  cleanColumnNames,
  normalizeRowsByColumns,
  parseDateValue,
  parseNumberValue,
} from "./normalize";
import { generateDataQuality } from "./quality";

const MAX_STORED_ROWS = 50000;
const SAMPLE_SIZE = 500;

export interface ParsedData {
  source: "csv" | "excel";
  rows: DatasetRow[];
  columns: ColumnMeta[];
  truncated: boolean;
  originalRowCount: number;
  storedRowCount: number;
  quality: DataQualityReport;
  sheetName?: string;
}

/* ----------------------------- 字段角色推断 ----------------------------- */

const TIME_KW = ["日期", "时间", "date", "time", "月份", "周", "日", "创建", "更新"];
const STATUS_KW = [
  "状态", "预警", "风险", "等级", "健康", "flag", "status", "是否正常", "是否达标", "告警",
];
const DIM_KW = [
  "客户", "地区", "区域", "渠道", "群", "负责", "部门", "门店", "产品", "类目", "来源", "城市", "行业", "类型", "标签",
];
const RATE_KW = ["率", "占比", "比例", "百分", "roi", "留存", "转化"];
const ID_KW = ["id", "编号", "序号", "姓名", "手机号", "手机", "账号", "邮箱"];

function inferRole(
  name: string,
  type: ColumnType,
  distinctCount: number,
  rowCount: number,
  format: FieldFormat,
): FieldRole {
  const lower = name.toLowerCase();
  const has = (kw: string) => lower.includes(kw.toLowerCase());
  if (type === "date" || TIME_KW.some(has)) return "time";
  if (STATUS_KW.some(has)) return "status";
  if (type === "number") {
    if (ID_KW.some(has)) return "identifier";
    if (format === "percentage" || RATE_KW.some(has)) return "metric";
    // 全唯一数值且行数较多 → 可能是标识
    if (rowCount > 10 && distinctCount === rowCount) return "identifier";
    return "metric";
  }
  if (DIM_KW.some(has)) return "dimension";
  if (ID_KW.some(has)) return "identifier";
  return "dimension";
}

function inferDefaultAgg(
  type: ColumnType,
  role: FieldRole,
  format: FieldFormat,
): Aggregation {
  if (type !== "number") return "count";
  if (role === "identifier") return "count";
  if (format === "percentage") return "avg";
  return "sum";
}

interface ColumnProfile {
  type: ColumnType;
  format: FieldFormat;
  nullCount: number;
  distinctCount: number;
  confidence: number;
  sampleValues: unknown[];
}

/**
 * 采样推断列类型 / 格式 / 空值率 / 去重数 / 置信度。
 */
function profileColumn(
  rows: DatasetRow[],
  name: string,
): ColumnProfile {
  const probeCount = Math.min(SAMPLE_SIZE, rows.length);
  let nullCount = 0;
  let numberCount = 0;
  let dateCount = 0;
  let boolCount = 0;
  let nonNull = 0;
  const distinctSet = new Set<string>();
  const sampleValues: unknown[] = [];
  let detectedFormat: FieldFormat = "plain";

  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][name];
    const isNull =
      v === null || v === undefined || v === "";
    if (isNull) {
      nullCount++;
      continue;
    }
    nonNull++;
    // distinctCount 用全量（≤ MAX_STORED_ROWS，可接受）
    distinctSet.add(typeof v === "object" ? JSON.stringify(v) : String(v));
    if (sampleValues.length < 5) sampleValues.push(v);

    if (i < probeCount) {
      if (v === true || v === false || v === "true" || v === "false") {
        boolCount++;
        continue;
      }
      const np = parseNumberValue(v);
      if (np.value !== null) {
        numberCount++;
        if (np.format !== "plain") detectedFormat = np.format;
        continue;
      }
      const dp = parseDateValue(v);
      if (dp) {
        dateCount++;
        continue;
      }
    }
  }

  const total = rows.length || 1;
  let type: ColumnType = "string";
  let format: FieldFormat = "plain";
  let confidence = nonNull > 0 ? nonNull / total : 0;

  if (nonNull > 0) {
    const sampleNonNull = Math.min(probeCount, nonNull);
    if (sampleNonNull > 0 && boolCount === sampleNonNull) {
      type = "boolean";
      format = "plain";
      confidence = boolCount / sampleNonNull;
    } else if (dateCount / sampleNonNull >= 0.8) {
      type = "date";
      format = "date";
      confidence = dateCount / sampleNonNull;
    } else if (numberCount / sampleNonNull >= 0.8) {
      type = "number";
      format = detectedFormat === "plain" ? "decimal" : detectedFormat;
      // 整数判定：采样所有数值是否整数
      confidence = numberCount / sampleNonNull;
    } else {
      type = "string";
      format = "plain";
      confidence = 1 - numberCount / sampleNonNull - dateCount / sampleNonNull;
      if (confidence < 0) confidence = 0;
    }
  }

  // 整数格式修正
  if (type === "number" && format === "decimal") {
    let allInt = true;
    for (const s of sampleValues) {
      const np = parseNumberValue(s);
      if (np.value !== null && !Number.isInteger(np.value)) {
        allInt = false;
        break;
      }
    }
    if (allInt && sampleValues.length > 0) format = "integer";
  }

  return {
    type,
    format,
    nullCount,
    distinctCount: distinctSet.size,
    confidence,
    sampleValues,
  };
}

function buildColumns(
  rows: DatasetRow[],
  rawNames: string[],
  cleanedNames: string[],
): ColumnMeta[] {
  const out: ColumnMeta[] = [];
  for (let i = 0; i < cleanedNames.length; i++) {
    const name = cleanedNames[i];
    const originalName = rawNames[i] ?? name;
    const p = profileColumn(rows, name);
    const role = inferRole(name, p.type, p.distinctCount, rows.length, p.format);
    const defaultAggregation = inferDefaultAgg(p.type, role, p.format);
    const nullRate = rows.length ? p.nullCount / rows.length : 0;
    out.push({
      name,
      originalName,
      type: p.type,
      role,
      format: p.format,
      sampleValues: p.sampleValues,
      nullable: p.nullCount > 0,
      nullCount: p.nullCount,
      nullRate,
      distinctCount: p.distinctCount,
      confidence: p.confidence,
      includeInAnalysis: true,
      defaultAggregation,
      userModified: false,
    });
  }
  return out;
}

/* 行规范化已提取到 lib/normalize.ts::normalizeRowsByColumns（与 confirm 阶段共用，SPEC 7.2） */

/* 质量报告已提取到 lib/quality.ts::generateDataQuality（与 confirm 阶段共用，SPEC 7.6 / 24） */

/* ----------------------------- 解析入口 ----------------------------- */

interface RawSheet {
  fields: string[];
  matrix: unknown[][];
  sheetName?: string;
}

function parseExcel(buffer: Buffer): RawSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error("Excel 中没有可读取的工作表");
  const ws = wb.Sheets[firstSheet];
  const matrix = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];
  if (matrix.length === 0) return { fields: [], matrix: [], sheetName: firstSheet };
  const fields = (matrix[0] as unknown[]).map((c) =>
    c == null ? "" : String(c),
  );
  return { fields, matrix: matrix.slice(1), sheetName: firstSheet };
}

function parseCsv(text: string): RawSheet {
  // 空内容：papaparse 会报 Delimiter error，这里直接返回空，由上层判断
  if (!text.trim()) return { fields: [], matrix: [] };
  const res = Papa.parse<unknown[]>(text, { skipEmptyLines: true });
  if (res.errors.length > 0) {
    const fatal = res.errors.find((e) => e.type === "Delimiter");
    if (fatal) throw new Error(`CSV 解析失败：${fatal.message}`);
  }
  const data = res.data as unknown[][];
  if (data.length === 0) return { fields: [], matrix: [] };
  const fields = (data[0] as unknown[]).map((c) =>
    c == null ? "" : String(c),
  );
  return { fields, matrix: data.slice(1) };
}

/** 保留非 __EMPTY 列的索引，丢弃 SheetJS 空列占位 */
function keepColumnIndices(fields: string[]): number[] {
  return fields
    .map((n, i) => (/^__EMPTY(_\d+)?$/.test(n) ? -1 : i))
    .filter((i) => i >= 0);
}

export function parseBuffer(buffer: Buffer, fileName: string): ParsedData {
  const lower = fileName.toLowerCase();
  let raw: RawSheet;
  let source: "csv" | "excel";

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    source = "excel";
    raw = parseExcel(buffer);
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    source = "csv";
    raw = parseCsv(buffer.toString("utf-8"));
  } else {
    source = "csv";
    raw = parseCsv(buffer.toString("utf-8"));
  }

  const originalRowCount = raw.matrix.length;

  // 过滤 __EMPTY 列占位
  const keepIdx = keepColumnIndices(raw.fields);
  const rawNames = keepIdx.map((i) => raw.fields[i]);

  // 列名清理（BOM / 空白 / 重名）
  const { names: cleanedNames, duplicateRenamed } = cleanColumnNames(rawNames);

  // 截断
  const truncated = originalRowCount > MAX_STORED_ROWS;
  const usedMatrix = truncated
    ? raw.matrix.slice(0, MAX_STORED_ROWS)
    : raw.matrix;
  const storedRowCount = usedMatrix.length;

  // 构造行对象（保留重复列名各自值）
  let rows: DatasetRow[] = usedMatrix.map((arr) => {
    const obj: DatasetRow = {};
    for (let ci = 0; ci < keepIdx.length; ci++) {
      obj[cleanedNames[ci]] = arr[keepIdx[ci]] ?? null;
    }
    return obj;
  });

  // 推断列元数据
  const columns = buildColumns(rows, rawNames, cleanedNames);

  // 规范化行值（数字/日期/布尔），收集无法解析的计数供质量报告使用
  const norm = normalizeRowsByColumns(rows, columns);
  rows = norm.rows;

  const quality = generateDataQuality({
    rows,
    columns,
    originalRowCount,
    storedRowCount,
    truncated,
    duplicateRenamed,
    invalidNumberCounts: norm.invalidNumberCounts,
    invalidDateCounts: norm.invalidDateCounts,
  });

  return {
    source,
    rows,
    columns,
    truncated,
    originalRowCount,
    storedRowCount,
    quality,
    sheetName: raw.sheetName,
  };
}
