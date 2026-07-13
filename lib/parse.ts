import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ColumnMeta, ColumnType, DatasetRow } from "./types";

const MAX_STORED_ROWS = 50000;

export interface ParsedData {
  source: "csv" | "excel";
  rows: DatasetRow[];
  columns: ColumnMeta[];
  truncated: boolean;
}

function isLikelyDate(v: unknown): boolean {
  if (v instanceof Date) return true;
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  // 常见日期形态：2024-01-31 / 2024/01/31 / 2024-01-31 12:00 / 31/01/2024
  const re = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;
  return re.test(s);
}

function inferType(values: unknown[]): ColumnType {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (sample.length === 0) return "string";

  const bools = sample.filter(
    (v) => v === true || v === false || v === "true" || v === "false",
  );
  if (bools.length === sample.length) return "boolean";

  const dates = sample.filter(isLikelyDate);
  if (dates.length / sample.length >= 0.8) return "date";

  const nums = sample.filter((v) => {
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "string") {
      const n = Number(v);
      return v.trim() !== "" && Number.isFinite(n);
    }
    return false;
  });
  if (nums.length / sample.length >= 0.8) return "number";

  return "string";
}

function buildColumns(rows: DatasetRow[]): ColumnMeta[] {
  if (rows.length === 0) return [];
  const names = Object.keys(rows[0]).filter(
    // 过滤 SheetJS 生成的空列占位符（Excel 合并单元格/隐藏列导致）
    (n) => !/^__EMPTY(_\d+)?$/.test(n),
  );
  const probeCount = Math.min(50, rows.length);
  return names.map((name) => {
    const probe: unknown[] = [];
    for (let i = 0; i < probeCount; i++) probe.push(rows[i][name]);
    const sample = probe.filter((v) => v !== null && v !== undefined).slice(0, 5);
    return {
      name,
      type: inferType(probe),
      sampleValues: sample,
    } as ColumnMeta;
  });
}

function parseExcel(buffer: Buffer): DatasetRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error("Excel 中没有可读取的工作表");
  const ws = wb.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
  });
  return rows;
}

function parseCsv(text: string): DatasetRow[] {
  const res = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (res.errors.length > 0) {
    const fatal = res.errors.find((e) => e.type === "Delimiter");
    if (fatal) throw new Error(`CSV 解析失败：${fatal.message}`);
  }
  return res.data;
}

/** 从行对象中移除 SheetJS 空列占位符 */
function stripEmptyColumns(rows: DatasetRow[]): DatasetRow[] {
  return rows.map((row) => {
    const clean: DatasetRow = {};
    for (const [k, v] of Object.entries(row)) {
      if (!/^__EMPTY(_\d+)?$/.test(k)) clean[k] = v;
    }
    return clean;
  });
}

export function parseBuffer(buffer: Buffer, fileName: string): ParsedData {
  const lower = fileName.toLowerCase();
  let rows: DatasetRow[];
  let source: "csv" | "excel";

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    source = "excel";
    rows = parseExcel(buffer);
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    source = "csv";
    rows = parseCsv(buffer.toString("utf-8"));
  } else {
    // 兜底：当 CSV 尝试
    source = "csv";
    rows = parseCsv(buffer.toString("utf-8"));
  }

  // 过滤空列
  rows = stripEmptyColumns(rows);

  const truncated = rows.length > MAX_STORED_ROWS;
  if (truncated) rows = rows.slice(0, MAX_STORED_ROWS);

  const columns = buildColumns(rows);
  return { source, rows, columns, truncated };
}
