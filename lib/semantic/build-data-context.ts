/**
 * lib/semantic/build-data-context.ts
 *
 * 构建发给 LLM 的客观数据上下文（SPEC 9）。
 *
 * 原则（SPEC 9.1）：只提供客观数据候选（类型、分布、空值率、统计、样本、
 * Sheet 结构、质量警告）；绝不把「主维度 / 核心指标 / 业务角色 / 聚合 /
 * 图表类型」当作不可更改事实——那些由 LLM Understanding 决定。
 *
 * 采样（SPEC 9.3）：固定种子（datasetId + rowsHash）→ 头/中/尾 + 随机，
 * 覆盖低基数分类与数值极值，去重上限 40；敏感字段脱敏。
 */
import type {
  ColumnDataContext,
  ColumnType,
  ColumnMeta,
  DataContext,
  DataQualityReport,
  DatasetRow,
  StoredDataset,
} from "@/lib/types";
import { createHash } from "node:crypto";
import { computeNumericStats } from "@/lib/analysis/statistics";
import { computeCategoryStats } from "@/lib/analysis/profile";
import {
  createValueMasker,
  detectSensitiveFields,
  maskRow,
  type ValueMasker,
} from "./detect-sensitive";

const MAX_SAMPLE_ROWS = 40;
const MAX_REPRESENTATIVE = 10;
const HEAD_N = 8;
const MID_N = 6;
const TAIL_N = 6;
const RAND_N = 12;
const MAX_ANOMALY = 10;
const LOW_CARD_THRESHOLD = 50;
const DEFAULT_TOKEN_BUDGET = 12_000;

/* ----------------------- 确定性哈希与 PRNG ----------------------- */

/** djb2 字符串哈希 → 32 位无符号整数（确定性，不依赖 Math.random / crypto） */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/** mulberry32：给定 32 位种子，返回确定性 [0,1) 伪随机函数 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 计算完整 rows hash（覆盖每行每列），用于固定采样种子与任务缓存。
 * 任意已载入单元格变化都会使缓存键失效。
 */
export function computeRowsHash(
  rows: DatasetRow[],
  columns: ColumnMeta[],
): string {
  const hash = createHash("sha256");
  hash.update(String(rows.length));
  for (const column of columns) hash.update(`\u001f${column.name}`);
  for (const row of rows) {
    hash.update("\u001e");
    for (const column of columns) {
      const value = row[column.name];
      hash.update(`\u001f${typeof value}:`);
      if (value instanceof Date) hash.update(value.toISOString());
      else if (value !== null && value !== undefined) hash.update(String(value));
    }
  }
  return hash.digest("hex");
}

/* ----------------------- 采样 ----------------------- */

/** 头/中/尾/随机采样，按行 index 去重，上限 MAX_SAMPLE_ROWS */
function sampleRows(
  rows: DatasetRow[],
  columns: ColumnMeta[],
  rng: () => number,
): { rows: DatasetRow[]; truncated: boolean } {
  const n = rows.length;
  if (n === 0) return { rows: [], truncated: false };
  const picked = new Map<number, DatasetRow>();
  const add = (idx: number) => {
    if (idx < 0 || idx >= n) return;
    if (!picked.has(idx)) picked.set(idx, rows[idx]);
  };
  // 头部
  for (let i = 0; i < Math.min(HEAD_N, n); i++) add(i);
  // 尾部
  if (n > HEAD_N) {
    for (let i = Math.max(HEAD_N, n - TAIL_N); i < n; i++) add(i);
  }
  // 中部等距
  if (n > HEAD_N + TAIL_N) {
    const lo = HEAD_N;
    const hi = n - TAIL_N;
    const span = hi - lo;
    for (let i = 0; i < MID_N; i++) {
      add(lo + Math.floor((span * i) / MID_N));
    }
  }
  // 低基数字段类别覆盖：按原始顺序选择尚未出现的分类，保持确定性。
  for (const column of columns.filter(
    (item) =>
      (item.distinctCount ?? 0) > 1 &&
      (item.distinctCount ?? 0) <= LOW_CARD_THRESHOLD,
  ).slice(0, 3)) {
    const seen = new Set<string>();
    for (let i = 0; i < rows.length && seen.size < 8; i++) {
      const value = rows[i][column.name];
      if (value === null || value === undefined || value === "") continue;
      const key = `${typeof value}:${String(value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(i);
    }
  }
  // 固定种子随机
  for (let i = 0; i < RAND_N; i++) {
    add(Math.floor(rng() * n));
  }
  const all = [...picked.entries()];
  const total = all.length;
  const sliced = all
    .slice(0, MAX_SAMPLE_ROWS)
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => r);
  return { rows: sliced, truncated: total > MAX_SAMPLE_ROWS };
}

/** 数值字段极值附近行（min/max/p25/p75）→ boundaryRows（SPEC 9.3 规则 6） */
function pickBoundaryRows(
  rows: DatasetRow[],
  numericFields: string[],
): DatasetRow[] {
  if (numericFields.length === 0 || rows.length === 0) return [];
  const want = new Set<number>();
  for (const f of numericFields.slice(0, 5)) {
    const iv: Array<{ idx: number; v: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][f];
      if (v === null || v === undefined || v === "") continue;
      const num = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(num)) iv.push({ idx: i, v: num });
    }
    if (iv.length === 0) continue;
    iv.sort((a, b) => a.v - b.v);
    const at = (q: number) =>
      iv[Math.min(iv.length - 1, Math.floor(q * iv.length))].idx;
    want.add(at(0));
    want.add(at(1));
    want.add(at(0.25));
    want.add(at(0.75));
  }
  return [...want]
    .sort((a, b) => a - b)
    .slice(0, MAX_SAMPLE_ROWS)
    .map((i) => rows[i]);
}

/** IQR 异常候选行 → anomalyCandidateRows（SPEC 9.3 规则 7，最多 MAX_ANOMALY） */
function pickAnomalyRows(
  rows: DatasetRow[],
  numericFields: string[],
): DatasetRow[] {
  const want = new Set<number>();
  for (const f of numericFields.slice(0, 5)) {
    const iv: Array<{ idx: number; v: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][f];
      if (v === null || v === undefined || v === "") continue;
      const num = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(num)) iv.push({ idx: i, v: num });
    }
    if (iv.length < 8) continue;
    const sorted = iv.map((x) => x.v).sort((a, b) => a - b);
    const q = (p: number) => {
      const pos = (sorted.length - 1) * p;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return lo === hi
        ? sorted[lo]
        : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    for (const e of iv) {
      if (e.v < lo || e.v > hi) want.add(e.idx);
    }
  }
  return [...want]
    .sort((a, b) => a - b)
    .slice(0, MAX_ANOMALY)
    .map((i) => rows[i]);
}

/* ----------------------- 列上下文 ----------------------- */

function buildColumnContext(
  col: ColumnMeta,
  rows: DatasetRow[],
  sensitive: Set<string>,
  masker: ValueMasker,
): ColumnDataContext {
  const name = col.name;
  const detectedType = col.type;
  const detectedFormat = col.format ?? "plain";

  const sv = (col.sampleValues ?? []).filter(
    (v) => v !== null && v !== undefined && v !== "",
  );
  const safeValue = (value: unknown) => masker.mask(name, value);
  const representativeValues = sv.slice(0, MAX_REPRESENTATIVE).map(safeValue);
  const sampleValues = sv.slice(0, MAX_REPRESENTATIVE).map(safeValue);

  const typeDistribution: Record<ColumnType, number> = {
    number: 0,
    string: 0,
    date: 0,
    boolean: 0,
    ...(col.typeDistribution ?? {}),
  };

  const nullCount = col.nullCount ?? 0;
  const sampleNonNullCount =
    col.sampleNonNullCount ?? Math.max(0, sv.length);
  const nullRate =
    col.nullRate ?? (rows.length > 0 ? nullCount / rows.length : 0);
  const distinctCount = col.distinctCount ?? 0;

  // topValues：低基数时算分类分布
  let topValues: ColumnDataContext["topValues"];
  if (distinctCount > 0 && distinctCount <= LOW_CARD_THRESHOLD) {
    const cat = computeCategoryStats(rows, name, 8, 0);
    if (cat.distinctCount > 0) {
      topValues = cat.top.map((t) => ({
        value: safeValue(t.value),
        count: t.count,
        rate: t.rate,
      }));
    }
  }

  // numericStats：数值列
  let numericStats: ColumnDataContext["numericStats"];
  if (detectedType === "number") {
    const ns = computeNumericStats(rows, name);
    if (ns.count > 0) {
      numericStats = {
        count: ns.count,
        min: ns.min,
        max: ns.max,
        mean: ns.avg,
        median: ns.median,
        p25: ns.p25,
        p75: ns.p75,
        std: ns.std,
        zeroCount: ns.zeroCount,
        negativeCount: ns.negativeCount,
      };
    }
  }

  // dateStats：日期/时间列
  let dateStats: ColumnDataContext["dateStats"];
  if (detectedType === "date" || col.role === "time") {
    const days = new Set<string>();
    const times: number[] = [];
    for (const r of rows) {
      const v = r[name];
      if (v === null || v === undefined || v === "") continue;
      const d = v instanceof Date ? v : new Date(String(v));
      const t = d.getTime();
      if (!Number.isFinite(t)) continue;
      days.add(d.toISOString().slice(0, 10));
      times.push(t);
    }
    if (times.length > 0) {
      let minT = Infinity;
      let maxT = -Infinity;
      for (const t of times) {
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
      }
      const min = new Date(minT);
      const max = new Date(maxT);
      dateStats = {
        min: min.toISOString().slice(0, 10),
        max: max.toISOString().slice(0, 10),
        distinctDays: days.size,
      };
    }
  }

  // heuristicHints：客观候选（非最终事实）
  const heuristicHints: string[] = [];
  if (col.role) heuristicHints.push(`role=${col.role}`);
  if (
    distinctCount > 0 &&
    rows.length > 0 &&
    distinctCount / rows.length > 0.9
  ) {
    heuristicHints.push("high_cardinality_candidate");
  }
  if (detectedFormat !== "plain") heuristicHints.push(`format=${detectedFormat}`);
  if (nullRate > 0.3) heuristicHints.push("high_null_rate");

  return {
    name,
    originalName: col.originalName,
    detectedType,
    detectedFormat,
    typeDistribution,
    sampleNonNullCount,
    nullCount,
    nullRate,
    distinctCount,
    sampleValues,
    representativeValues,
    topValues,
    numericStats,
    dateStats,
    possibleSensitive: sensitive.has(name),
    heuristicHints,
  };
}

/* ----------------------- 主入口 ----------------------- */

export interface BuildDataContextOptions {
  userDescription?: string;
  /** 是否发送行样本（SPEC 9.4 用户可关闭，只发统计） */
  sendRowSamples?: boolean;
  /** LLM 上下文预算；超限时按异常候选→边界样本→普通样本顺序裁剪。 */
  tokenBudget?: number;
}

/**
 * 构建 DataContext。同一 StoredDataset 多次构建，采样与统计结果稳定
 * （仅 generatedAt 随当前时间变化）。
 */
export function buildDataContext(
  ds: StoredDataset,
  options: BuildDataContextOptions = {},
): DataContext {
  const rows = ds.rows ?? [];
  const columns = ds.columns ?? [];
  const rowsHash = computeRowsHash(rows, columns);
  const seed = hashStr(`${ds.id} ${rowsHash}`);
  const rng = mulberry32(seed);

  const sensitive = detectSensitiveFields(columns);
  const masker = createValueMasker(sensitive);

  const colContexts = columns.map((c) =>
    buildColumnContext(c, rows, sensitive, masker),
  );
  const numericFieldNames = colContexts
    .filter((c) => c.numericStats)
    .map((c) => c.name);

  const sendRowSamples = options.sendRowSamples ?? true;

  let sampled: DatasetRow[] = [];
  if (sendRowSamples) {
    sampled = sampleRows(rows, columns, rng).rows;
  }
  // 数据行数超过发给 LLM 的样本上限时标记截断（SPEC 9.3 规则 9）
  const truncated = sendRowSamples && rows.length > MAX_SAMPLE_ROWS;
  const boundary = sendRowSamples
    ? pickBoundaryRows(rows, numericFieldNames)
    : [];
  const anomaly = sendRowSamples
    ? pickAnomalyRows(rows, numericFieldNames)
    : [];

  const maskAll = (rs: DatasetRow[]) => rs.map((r) => maskRow(r, masker));

  let safeSampled = maskAll(sampled);
  let safeBoundary = maskAll(boundary);
  let safeAnomaly = maskAll(anomaly);
  const omittedSections: string[] = [];
  if (!sendRowSamples) {
    omittedSections.push(
      "sampledRows",
      "boundaryRows",
      "anomalyCandidateRows",
    );
  }

  const budget = Math.max(1_000, options.tokenBudget ?? DEFAULT_TOKEN_BUDGET);
  const estimateTokens = () =>
    Math.ceil(
      JSON.stringify({
        columns: colContexts,
        sampledRows: safeSampled,
        boundaryRows: safeBoundary,
        anomalyCandidateRows: safeAnomaly,
        quality: ds.quality,
        userDescription: options.userDescription,
      }).length / 4,
    );
  if (estimateTokens() > budget && safeAnomaly.length > 0) {
    safeAnomaly = [];
    omittedSections.push("anomalyCandidateRows:token_budget");
  }
  if (estimateTokens() > budget && safeBoundary.length > 0) {
    safeBoundary = [];
    omittedSections.push("boundaryRows:token_budget");
  }
  while (estimateTokens() > budget && safeSampled.length > 8) {
    safeSampled = safeSampled.filter((_, index) => index % 2 === 0);
    if (!omittedSections.includes("sampledRows:token_budget")) {
      omittedSections.push("sampledRows:token_budget");
    }
  }

  const workbook = {
    fileName: ds.fileName,
    source: ds.source,
    sheetCount: 1,
    sheets: [
      {
        name: ds.sheetName ?? "Sheet1",
        rawRowCount: ds.originalRowCount ?? rows.length,
        rawColumnCount: columns.length,
        headerCandidates: [
          {
            startRow: 0,
            rowCount: 1,
            generatedNames: columns.map((c) => c.name),
            confidence: 0.9,
          },
        ],
        previewMatrix: safeSampled.slice(0, 5).map((r) =>
          columns.map((c) => r[c.name] ?? null),
        ),
        likelyDataStartRow: 1,
        likelyHeaderRowCount: 1,
        notes: [],
      },
    ],
    selectedSheetNames: [ds.sheetName ?? "Sheet1"],
  };

  const estimatedTokens = estimateTokens();

  const quality: DataQualityReport = ds.quality ?? {
    originalRowCount: ds.originalRowCount ?? rows.length,
    storedRowCount: ds.storedRowCount ?? rows.length,
    columnCount: columns.length,
    duplicateRowCount: 0,
    emptyRowCount: 0,
    warnings: [],
    generatedAt: new Date().toISOString(),
  };

  return {
    version: "v1",
    datasetId: ds.id,
    datasetName: ds.name,
    workbook,
    rowCount: ds.originalRowCount ?? rows.length,
    storedRowCount: ds.storedRowCount ?? rows.length,
    columns: colContexts,
    sampledRows: safeSampled,
    boundaryRows: safeBoundary,
    anomalyCandidateRows: safeAnomaly,
    quality,
    userDescription: options.userDescription,
    tokenBudget: {
      estimatedTokens,
      truncated: truncated || omittedSections.some((item) => item.includes("token_budget")),
      omittedSections,
    },
    generatedAt: new Date().toISOString(),
  };
}
