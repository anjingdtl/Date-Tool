import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { config } from "./config";
import type { Dataset, PublicDataset, StoredDataset, AnalysisResult } from "./types";

const DATASET_DIR = path.join(config.dataDir, "datasets");

/** 统一的数据集 ID 校验：必须是 UUID，防止路径遍历与非法输入 */
export const DatasetIdSchema = z.string().uuid();

export function isValidDatasetId(id: string): boolean {
  return DatasetIdSchema.safeParse(id).success;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATASET_DIR, { recursive: true });
}

function filePath(id: string): string {
  return path.join(DATASET_DIR, `${id}.json`);
}

function toPublic(ds: StoredDataset): PublicDataset {
  return {
    id: ds.id,
    name: ds.name,
    fileName: ds.fileName,
    source: ds.source,
    rowCount: ds.rowCount,
    columns: ds.columns,
    createdAt: ds.createdAt,
    hasAnalysis: !!ds.analysis,
  };
}

/**
 * 原子写入 JSON：先写同目录临时文件，再 rename，失败清理临时文件。
 * 避免写入中途崩溃导致数据集文件损坏。
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

export async function saveDataset(ds: StoredDataset): Promise<void> {
  if (!isValidDatasetId(ds.id)) {
    throw new Error(`[store] 拒绝保存：数据集 ID 不是合法 UUID：${ds.id}`);
  }
  await ensureDir();
  await saveJsonAtomic(filePath(ds.id), ds);
}

export async function getDataset(id: string): Promise<StoredDataset | null> {
  // 存储层拒绝非 UUID，且不访问文件系统（防路径遍历）
  if (!isValidDatasetId(id)) return null;
  try {
    const raw = await fs.readFile(filePath(id), "utf-8");
    return JSON.parse(raw) as StoredDataset;
  } catch {
    return null;
  }
}

export async function getPublicDataset(id: string): Promise<PublicDataset | null> {
  const ds = await getDataset(id);
  return ds ? toPublic(ds) : null;
}

export async function listDatasets(): Promise<PublicDataset[]> {
  await ensureDir();
  const files = await fs.readdir(DATASET_DIR);
  const out: PublicDataset[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(DATASET_DIR, f), "utf-8");
      out.push(toPublic(JSON.parse(raw) as StoredDataset));
    } catch {
      // 跳过损坏文件，不影响其他数据集展示
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteDataset(id: string): Promise<boolean> {
  if (!isValidDatasetId(id)) return false;
  try {
    await fs.unlink(filePath(id));
    return true;
  } catch {
    return false;
  }
}

export async function updateAnalysis(
  id: string,
  analysis: AnalysisResult,
): Promise<void> {
  const ds = await getDataset(id);
  if (!ds) return;
  ds.analysis = analysis;
  await saveDataset(ds);
}
