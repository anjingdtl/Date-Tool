import fs from "fs/promises";
import path from "path";
import { config } from "./config";
import {
  DatasetIdSchema,
  isValidDatasetId,
} from "./schemas/dataset";
import type {
  AnalysisResult,
  ColumnMeta,
  DatasetAnalysisConfig,
  DataQualityReport,
  DatasetRow,
  DatasetStatus,
  PublicDataset,
  StoredDataset,
} from "./types";
import { normalizeRowsByColumns, recomputeColumnStats } from "./normalize";
import { generateDataQuality } from "./quality";

// re-export 保持向后兼容（其它模块从 @/lib/store 导入）
export { DatasetIdSchema, isValidDatasetId };

const DATASET_DIR = path.join(config.dataDir, "datasets");

async function ensureBaseDir(): Promise<void> {
  await fs.mkdir(DATASET_DIR, { recursive: true });
}

function datasetDir(id: string): string {
  return path.join(DATASET_DIR, id);
}
function metaPath(id: string): string {
  return path.join(datasetDir(id), "meta.json");
}
function rowsPath(id: string): string {
  return path.join(datasetDir(id), "rows.json");
}
function analysesPath(id: string): string {
  return path.join(datasetDir(id), "analyses.json");
}
function legacyPath(id: string): string {
  return path.join(DATASET_DIR, `${id}.json`);
}
function legacyBakPath(id: string): string {
  return path.join(DATASET_DIR, `${id}.json.bak`);
}

/** meta 文件结构（不含 rows / analysis / analyses） */
interface DatasetMeta {
  id: string;
  name: string;
  fileName: string;
  source: "csv" | "excel";
  rowCount: number;
  originalRowCount?: number;
  storedRowCount?: number;
  sheetName?: string;
  columns: StoredDataset["columns"];
  createdAt: string;
  status?: DatasetStatus;
  quality?: DataQualityReport;
  config?: DatasetAnalysisConfig;
}

function toMeta(ds: StoredDataset): DatasetMeta {
  return {
    id: ds.id,
    name: ds.name,
    fileName: ds.fileName,
    source: ds.source,
    rowCount: ds.rowCount,
    originalRowCount: ds.originalRowCount,
    storedRowCount: ds.storedRowCount,
    sheetName: ds.sheetName,
    columns: ds.columns,
    createdAt: ds.createdAt,
    status: ds.status,
    quality: ds.quality,
    config: ds.config,
  };
}

function toPublic(meta: DatasetMeta, hasAnalysis: boolean): PublicDataset {
  return {
    id: meta.id,
    name: meta.name,
    fileName: meta.fileName,
    source: meta.source,
    rowCount: meta.rowCount,
    originalRowCount: meta.originalRowCount,
    storedRowCount: meta.storedRowCount,
    sheetName: meta.sheetName,
    columns: meta.columns,
    createdAt: meta.createdAt,
    status: meta.status,
    hasAnalysis,
  };
}

/**
 * 原子写入 JSON：先写同目录临时文件，再 rename，失败清理临时文件。
 */
export async function saveJsonAtomic(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), "utf-8");
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {
      /* 清理临时文件失败不阻断主流程 */
    });
    throw err;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 旧格式迁移：{id}.json 单文件 → {id}/meta.json + rows.json + analyses.json
 * 保留旧文件为 .bak；迁移失败时不删旧文件（spec 16.5）。
 */
async function migrateLegacy(id: string): Promise<boolean> {
  const legacy = legacyPath(id);
  const targetDir = datasetDir(id);
  if (!(await pathExists(legacy))) return false;
  if (await pathExists(targetDir)) {
    // 新目录已存在，说明已迁移过；旧文件冗余，改 bak
    await fs.rename(legacy, legacyBakPath(id)).catch(() => {});
    return true;
  }
  try {
    const raw = await fs.readFile(legacy, "utf-8");
    const ds = JSON.parse(raw) as StoredDataset;
    await fs.mkdir(targetDir, { recursive: true });
    await saveJsonAtomic(metaPath(id), toMeta(ds));
    await saveJsonAtomic(rowsPath(id), ds.rows ?? []);
    const analyses =
      ds.analyses ?? (ds.analysis ? [ds.analysis] : []);
    await saveJsonAtomic(analysesPath(id), analyses);
    // 保留旧文件为 .bak
    await fs.rename(legacy, legacyBakPath(id));
    return true;
  } catch {
    // 迁移失败：保留旧文件只读，不丢失数据
    return false;
  }
}

export async function saveDataset(ds: StoredDataset): Promise<void> {
  if (!isValidDatasetId(ds.id)) {
    throw new Error(`[store] 拒绝保存：数据集 ID 不是合法 UUID：${ds.id}`);
  }
  await ensureBaseDir();
  await fs.mkdir(datasetDir(ds.id), { recursive: true });
  await saveJsonAtomic(metaPath(ds.id), toMeta(ds));
  await saveJsonAtomic(rowsPath(ds.id), ds.rows ?? []);
  const analyses =
    ds.analyses ?? (ds.analysis ? [ds.analysis] : []);
  await saveJsonAtomic(analysesPath(ds.id), analyses);
}

export async function getDataset(id: string): Promise<StoredDataset | null> {
  if (!isValidDatasetId(id)) return null;

  // 新目录不存在时尝试迁移旧格式
  if (!(await pathExists(datasetDir(id)))) {
    const migrated = await migrateLegacy(id);
    if (!migrated) return null;
  }

  try {
    const metaRaw = await fs.readFile(metaPath(id), "utf-8");
    const meta = JSON.parse(metaRaw) as DatasetMeta;
    let rows: DatasetRow[] = [];
    try {
      const rowsRaw = await fs.readFile(rowsPath(id), "utf-8");
      rows = JSON.parse(rowsRaw) as DatasetRow[];
    } catch {
      /* rows 损坏 → 空数组，不阻断 */
    }
    let analyses: AnalysisResult[] = [];
    try {
      const anRaw = await fs.readFile(analysesPath(id), "utf-8");
      const parsed = JSON.parse(anRaw);
      if (Array.isArray(parsed)) analyses = parsed as AnalysisResult[];
    } catch {
      /* analyses 损坏或不存在 → 空数组 */
    }
    const analysis = analyses.length ? analyses[analyses.length - 1] : null;
    return { ...meta, rows, analysis, analyses };
  } catch {
    return null;
  }
}

export async function getPublicDataset(id: string): Promise<PublicDataset | null> {
  const ds = await getDataset(id);
  if (!ds) return null;
  return toPublic(toMeta(ds), !!ds.analysis);
}

export async function listDatasets(): Promise<PublicDataset[]> {
  await ensureBaseDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(DATASET_DIR);
  } catch {
    return [];
  }
  const out: PublicDataset[] = [];
  for (const entry of entries) {
    // 跳过备份文件
    if (entry.endsWith(".bak")) continue;

    if (entry.endsWith(".json")) {
      // 旧格式单文件：尝试迁移后读 meta
      const id = entry.slice(0, -5);
      if (!isValidDatasetId(id)) continue;
      const migrated = await migrateLegacy(id);
      if (!migrated) {
        // 迁移失败：直接读旧文件（容忍性能开销，保证不丢数据）
        try {
          const raw = await fs.readFile(path.join(DATASET_DIR, entry), "utf-8");
          const ds = JSON.parse(raw) as StoredDataset;
          out.push(toPublic(toMeta(ds), !!ds.analysis));
        } catch {
          /* 损坏文件跳过 */
        }
        continue;
      }
      // 迁移成功：读 meta
      try {
        const meta = JSON.parse(
          await fs.readFile(metaPath(id), "utf-8"),
        ) as DatasetMeta;
        const hasAnalysis = await readHasAnalysis(id);
        out.push(toPublic(meta, hasAnalysis));
      } catch {
        /* meta 损坏跳过 */
      }
      continue;
    }

    // 子目录：读 meta.json（不读 rows，性能优化 spec 16.2/22）
    const dir = path.join(DATASET_DIR, entry);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (!isValidDatasetId(entry)) continue;
    const id = entry;
    try {
      const meta = JSON.parse(
        await fs.readFile(metaPath(id), "utf-8"),
      ) as DatasetMeta;
      const hasAnalysis = await readHasAnalysis(id);
      out.push(toPublic(meta, hasAnalysis));
    } catch {
      /* 子目录无 meta 或损坏 → 跳过 */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function readHasAnalysis(id: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(analysesPath(id), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export async function deleteDataset(id: string): Promise<boolean> {
  if (!isValidDatasetId(id)) return false;
  const dirExists = await pathExists(datasetDir(id));
  const legacyExists = await pathExists(legacyPath(id));
  const bakExists = await pathExists(legacyBakPath(id));
  if (!dirExists && !legacyExists && !bakExists) return false;

  let deleted = false;
  // 删新目录
  if (dirExists) {
    try {
      await fs.rm(datasetDir(id), { recursive: true, force: true });
      deleted = true;
    } catch {
      /* ignore */
    }
  }
  // 删旧文件与备份
  if (legacyExists) {
    try {
      await fs.unlink(legacyPath(id));
      deleted = true;
    } catch {
      /* ignore */
    }
  }
  if (bakExists) {
    try {
      await fs.unlink(legacyBakPath(id));
      deleted = true;
    } catch {
      /* ignore */
    }
  }
  return deleted;
}

export async function updateAnalysis(
  id: string,
  analysis: AnalysisResult,
): Promise<void> {
  const ds = await getDataset(id);
  if (!ds) return;
  // 追加到历史，保留最近 3 次（spec 14.4）
  const histories = ds.analyses ?? (ds.analysis ? [ds.analysis] : []);
  ds.analyses = [...histories, analysis].slice(-3);
  ds.analysis = analysis;
  if (ds.status === "analyzing" || !ds.status) {
    ds.status = "completed";
  }
  await saveDataset(ds);
}

/** 字段配置更新项（预检阶段用户可修改的字段） */
export interface ColumnConfigUpdate {
  name: string;
  type: ColumnMeta["type"];
  role: ColumnMeta["role"];
  format: ColumnMeta["format"];
  defaultAggregation: ColumnMeta["defaultAggregation"];
  includeInAnalysis: boolean;
}

/**
 * 把用户提交的字段配置合并进现有 columns（纯函数，SPEC 9.7 / 17.3）。
 *
 * - 只覆盖 type/role/format/defaultAggregation/includeInAnalysis；
 * - 任一字段变化则标记 userModified=true；
 * - 保留 name/originalName/sampleValues/nullCount 等其它元数据。
 */
export function mergeColumnsInto(
  existing: ColumnMeta[],
  updates: ColumnConfigUpdate[],
): ColumnMeta[] {
  const byName = new Map(updates.map((c) => [c.name, c]));
  return existing.map((c) => {
    const upd = byName.get(c.name);
    if (!upd) return c;
    const changed =
      upd.type !== c.type ||
      upd.role !== c.role ||
      upd.format !== c.format ||
      upd.defaultAggregation !== c.defaultAggregation ||
      upd.includeInAnalysis !== (c.includeInAnalysis ?? true);
    return {
      ...c,
      type: upd.type,
      role: upd.role,
      format: upd.format,
      defaultAggregation: upd.defaultAggregation,
      includeInAnalysis: upd.includeInAnalysis,
      userModified: changed ? true : c.userModified,
    };
  });
}

/**
 * 更新数据集字段配置（预检草稿，SPEC 17.3 / 23.3）。
 *
 * 仅落盘 columns + analysisConfig，**不修改 rows**：用户在预检页可能多次调整，
 * 避免每次保存都反复处理大数据。rows 的重规范化统一在 confirm 时执行。
 *
 * 调用方应先通过 validateFieldConfig 校验。
 */
export async function updateDatasetConfig(
  id: string,
  columns: ColumnConfigUpdate[],
  analysisConfig?: DatasetAnalysisConfig,
): Promise<StoredDataset | null> {
  const ds = await getDataset(id);
  if (!ds) return null;
  ds.columns = mergeColumnsInto(ds.columns, columns);
  if (analysisConfig) ds.config = analysisConfig;
  await saveDataset(ds);
  return ds;
}

/**
 * confirm 专用：按最终字段配置重新规范化并落盘（SPEC 7.4 / 23.2）。
 *
 * 流程：合并最终 columns → 按最终类型/格式重新规范化 rows → 重算字段元数据
 *      → 重算数据质量报告 → 原子保存 rows + meta + quality → status=ready。
 *
 * Evidence 与后续分析都基于这份稳定的最终快照，避免每次分析重复转换（SPEC 21）。
 */
export async function reconfigureAndConfirm(
  id: string,
  columns?: ColumnConfigUpdate[],
  analysisConfig?: DatasetAnalysisConfig,
): Promise<StoredDataset | null> {
  const ds = await getDataset(id);
  if (!ds) return null;

  // 1. 合并最终字段配置（若有提交）
  let finalColumns = ds.columns;
  if (columns && columns.length > 0) {
    finalColumns = mergeColumnsInto(ds.columns, columns);
  }

  // 2. 按最终 columns 重新规范化 rows
  const norm = normalizeRowsByColumns(ds.rows, finalColumns);

  // 3. 重算字段元数据（nullCount/distinctCount/sampleValues/...）
  finalColumns = recomputeColumnStats(norm.rows, finalColumns);

  // 4. 重算数据质量报告
  const originalRowCount = ds.originalRowCount ?? ds.rows.length;
  const storedRowCount = ds.storedRowCount ?? norm.rows.length;
  const quality = generateDataQuality({
    rows: norm.rows,
    columns: finalColumns,
    originalRowCount,
    storedRowCount,
    truncated: originalRowCount > storedRowCount,
    duplicateRenamed: false,
    invalidNumberCounts: norm.invalidNumberCounts,
    invalidDateCounts: norm.invalidDateCounts,
  });

  // 5. 原子保存，状态置 ready
  ds.columns = finalColumns;
  ds.rows = norm.rows;
  ds.quality = quality;
  if (analysisConfig) ds.config = analysisConfig;
  ds.status = "ready";
  await saveDataset(ds);
  return ds;
}

/**
 * 设置数据集状态（预检 confirm / 分析阶段切换）。
 * 状态机：draft → ready → analyzing → completed/error。
 * confirm 仅允许从 draft → ready。
 */
export async function setDatasetStatus(
  id: string,
  next: DatasetStatus,
): Promise<StoredDataset | null> {
  const ds = await getDataset(id);
  if (!ds) return null;
  ds.status = next;
  await saveDataset(ds);
  return ds;
}
