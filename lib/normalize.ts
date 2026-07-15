/**
 * 数据规范化纯函数（spec 9.2）
 *
 * - parseNumberValue：千分位、百分比、金额（¥ ￥ $ € £）、整数/小数
 * - parseDateValue：多格式日期 → ISO 8601 (YYYY-MM-DD)
 * - cleanColumnName：去 BOM / 首尾空白 / 重名加后缀
 *
 * 全部为纯函数，无副作用，便于单元测试。
 */
import type { ColumnMeta, DatasetRow, FieldFormat } from "./types";

export interface NumberParseResult {
  value: number | null;
  format: FieldFormat;
}

/** 货币符号前缀（全角/半角） */
const CURRENCY_PREFIX = /^[￥¥$€£\s]+/;

/**
 * 把单元格值解析为数字。
 * 支持：1,234 / 1,234.56 / 65% / 65.5% / ¥1,200 / ￥800 / $1,500 / -3.14 / 100
 * 返回 { value, format }；无法解析返回 { value: null, format: "plain" }。
 */
export function parseNumberValue(v: unknown): NumberParseResult {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { value: null, format: "plain" };
    return { value: v, format: Number.isInteger(v) ? "integer" : "decimal" };
  }
  if (typeof v !== "string") return { value: null, format: "plain" };
  const s = v.trim();
  if (!s) return { value: null, format: "plain" };

  // 1) 百分比：65% / 65.5%
  if (s.endsWith("%") || s.endsWith("％")) {
    const inner = s.slice(0, -1).replace(/[,，]/g, "");
    const n = Number(inner);
    if (Number.isFinite(n)) return { value: n / 100, format: "percentage" };
  }

  // 2) 货币：¥1,200 / ￥800 / $1,500.50 / €100
  if (CURRENCY_PREFIX.test(s)) {
    const cleaned = s.replace(CURRENCY_PREFIX, "").replace(/[,，\s]/g, "");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return { value: n, format: "currency" };
  }

  // 3) 千分位数字：1,234 / 12,345.67 / -1,234
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    const n = Number(s.replace(/,/g, ""));
    if (Number.isFinite(n)) return { value: n, format: "decimal" };
  }

  // 4) 普通数字：100 / 3.14 / -5
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) {
      return { value: n, format: Number.isInteger(n) ? "integer" : "decimal" };
    }
  }

  // 5) 全角逗号千分位：1，234
  if (/^-?\d{1,3}(，\d{3})+$/.test(s)) {
    const n = Number(s.replace(/，/g, ""));
    if (Number.isFinite(n)) return { value: n, format: "decimal" };
  }

  return { value: null, format: "plain" };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 把日期值解析为 ISO 8601 字符串 (YYYY-MM-DD)。
 * 支持：Date 对象、2026-07-01、2026/7/3、2026.7.5、2026年7月5日、含时分秒。
 * 无法解析返回 null。
 */
export function parseDateValue(v: unknown): string | null {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(
      v.getUTCDate(),
    )}`;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  // 2026-07-01 / 2026/7/3 / 2026.7.5（可选时分秒）
  const m1 = s.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/,
  );
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    const d = Number(m1[3]);
    if (validYmd(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  // 2026年7月5日 / 2026年07月05日
  const m2 = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
  if (m2) {
    const y = Number(m2[1]);
    const mo = Number(m2[2]);
    const d = Number(m2[3]);
    if (validYmd(y, mo, d)) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  return null;
}

function validYmd(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > 2100) return false;
  // 真实日历校验（SPEC 11.4）：用 UTC 构造后回查三个分量，
  // 拒绝 2026-02-31 这类语法合法但日历不存在的溢出日期。
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * 清理列名：去 BOM、去首尾空白、空名占位、重名加后缀 _2/_3。
 * 返回 { cleaned, hadDuplicate } 供质量报告使用。
 */
export function cleanColumnNames(
  raw: string[],
): { names: string[]; duplicateRenamed: boolean } {
  const seen = new Map<string, number>();
  const names: string[] = [];
  let duplicateRenamed = false;
  for (let i = 0; i < raw.length; i++) {
    let n = (raw[i] ?? "").replace(/^\uFEFF/, "").trim();
    if (!n) n = `列${i + 1}`;
    if (seen.has(n)) {
      duplicateRenamed = true;
      let k = 2;
      while (seen.has(`${n}_${k}`)) k++;
      n = `${n}_${k}`;
    }
    seen.set(n, 1);
    names.push(n);
  }
  return { names, duplicateRenamed };
}

/* ----------------------------- 行规范化（可复用，SPEC 7.2） ----------------------------- */

export interface NormalizeRowsResult {
  rows: DatasetRow[];
  /** 每列无法解析为数字的非空原始值数量 */
  invalidNumberCounts: Record<string, number>;
  /** 每列无法解析为日期的非空原始值数量 */
  invalidDateCounts: Record<string, number>;
  /** 每列值因规范化发生改变的计数 */
  changedValueCounts: Record<string, number>;
}

const BOOL_TRUE = new Set(["true", "是", "1", "yes", "y", "t"]);
const BOOL_FALSE = new Set(["false", "否", "0", "no", "n", "f"]);

function toBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (BOOL_TRUE.has(s)) return true;
  if (BOOL_FALSE.has(s)) return false;
  return null;
}

/**
 * 按最终字段配置（columns）重新规范化行值（SPEC 7.2 / 7.3）。
 *
 * - number 列：parseNumberValue，无法解析设 null 并记 invalidNumberCounts；
 * - date 列：parseDateValue（真实日历校验），无法解析设 null 并记 invalidDateCounts；
 * - boolean 列：支持 true/false/是/否/1/0，无法识别设 null；
 * - string 列：null→null，数字/布尔→字符串，字符串原样（不丢前导零标识字段）；
 * - ignored/未知列：原样保留。
 *
 * 纯函数，parse 阶段与 confirm 阶段复用，确保 rows 与最终 columns 一致。
 */
export function normalizeRowsByColumns(
  rows: DatasetRow[],
  columns: ColumnMeta[],
): NormalizeRowsResult {
  const colByName = new Map(columns.map((c) => [c.name, c]));
  const invalidNumberCounts: Record<string, number> = {};
  const invalidDateCounts: Record<string, number> = {};
  const changedValueCounts: Record<string, number> = {};

  const out = rows.map((row) => {
    const o: DatasetRow = {};
    for (const [k, v] of Object.entries(row)) {
      const type = colByName.get(k)?.type;
      if (type === "number") {
        if (v === null || v === undefined || v === "") {
          o[k] = null;
        } else if (typeof v === "number") {
          if (Number.isFinite(v)) {
            o[k] = v;
          } else {
            o[k] = null;
            invalidNumberCounts[k] = (invalidNumberCounts[k] ?? 0) + 1;
          }
        } else {
          const np = parseNumberValue(v);
          if (np.value !== null) {
            if (String(np.value) !== String(v).trim()) {
              changedValueCounts[k] = (changedValueCounts[k] ?? 0) + 1;
            }
            o[k] = np.value;
          } else {
            o[k] = null;
            invalidNumberCounts[k] = (invalidNumberCounts[k] ?? 0) + 1;
          }
        }
      } else if (type === "date") {
        if (v === null || v === undefined || v === "") {
          o[k] = null;
        } else {
          const dp = parseDateValue(v);
          if (dp) {
            o[k] = dp;
          } else {
            o[k] = null;
            invalidDateCounts[k] = (invalidDateCounts[k] ?? 0) + 1;
          }
        }
      } else if (type === "boolean") {
        if (v === null || v === undefined || v === "") {
          o[k] = null;
        } else {
          // 无法识别的布尔值统一设 null（SPEC 7.3）
          o[k] = toBoolean(v);
        }
      } else if (type === "string") {
        if (v === null || v === undefined) {
          o[k] = null;
        } else if (typeof v === "number" || typeof v === "boolean") {
          o[k] = String(v);
        } else {
          // 字符串原样保留（含前导零的标识字段不丢失）
          o[k] = v;
        }
      } else {
        // ignored 或未知列：原样保留
        o[k] = v;
      }
    }
    return o;
  });

  return { rows: out, invalidNumberCounts, invalidDateCounts, changedValueCounts };
}

/**
 * 基于已规范化的 rows 重算字段元数据（SPEC 7.5）。
 *
 * 更新 nullCount / nullRate / distinctCount / sampleValues / nullable；
 * confidence 与 userModified 保留原值（用户确认前的推断结果不因重算丢失）。
 */
export function recomputeColumnStats(
  rows: DatasetRow[],
  columns: ColumnMeta[],
): ColumnMeta[] {
  const total = rows.length || 1;
  return columns.map((c) => {
    let nullCount = 0;
    const distinctSet = new Set<string>();
    const sampleValues: unknown[] = [];
    for (const row of rows) {
      const v = row[c.name];
      const isNull = v === null || v === undefined || v === "";
      if (isNull) {
        nullCount++;
        continue;
      }
      distinctSet.add(typeof v === "object" ? JSON.stringify(v) : String(v));
      if (sampleValues.length < 5) sampleValues.push(v);
    }
    return {
      ...c,
      nullCount,
      nullRate: nullCount / total,
      distinctCount: distinctSet.size,
      sampleValues,
      nullable: nullCount > 0,
    };
  });
}
