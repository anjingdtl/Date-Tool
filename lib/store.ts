import fs from "fs/promises";
import path from "path";
import { config } from "./config";
import type { Dataset, PublicDataset, StoredDataset, AnalysisResult } from "./types";

const DATASET_DIR = path.join(config.dataDir, "datasets");

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

export async function saveDataset(ds: StoredDataset): Promise<void> {
  await ensureDir();
  await fs.writeFile(filePath(ds.id), JSON.stringify(ds), "utf-8");
}

export async function getDataset(id: string): Promise<StoredDataset | null> {
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
      // 跳过损坏文件
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteDataset(id: string): Promise<boolean> {
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
