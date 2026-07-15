/**
 * tests/migration-recovery.test.ts
 *
 * SPEC 13.4 / 18.3：旧数据迁移可恢复。
 * 直接操作文件系统模拟 legacy 单文件 / 半成品目录 / .bak，验证 getDataset 能恢复。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { getDataset, listDatasets } from "@/lib/store";
import type { StoredDataset } from "@/lib/types";

const DATASETS_DIR = path.join(config.dataDir, "datasets");
const UUID = "55555555-5555-4555-8555-555555555555";

function legacyData(): StoredDataset {
  return {
    id: UUID,
    name: "迁移测试",
    fileName: "t.csv",
    source: "csv",
    rowCount: 2,
    originalRowCount: 2,
    storedRowCount: 2,
    columns: [{ name: "a", type: "number", sampleValues: [1, 2] }],
    rows: [{ a: 1 }, { a: 2 }],
    createdAt: new Date().toISOString(),
    analysis: null,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  await fs.rm(DATASETS_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(DATASETS_DIR, { recursive: true });
});

describe("旧数据迁移恢复 - SPEC 13.4", () => {
  it("legacy 单文件迁移成功：生成目录三文件 + .bak", async () => {
    await fs.writeFile(
      path.join(DATASETS_DIR, `${UUID}.json`),
      JSON.stringify(legacyData()),
    );
    const ds = await getDataset(UUID);
    expect(ds).not.toBeNull();
    expect(ds!.rows).toHaveLength(2);
    expect(await exists(path.join(DATASETS_DIR, UUID, "meta.json"))).toBe(true);
    expect(await exists(path.join(DATASETS_DIR, UUID, "rows.json"))).toBe(true);
    expect(await exists(path.join(DATASETS_DIR, UUID, "analyses.json"))).toBe(
      true,
    );
    expect(await exists(path.join(DATASETS_DIR, `${UUID}.json.bak`))).toBe(true);
  });

  it("半成品目录（只有 meta 无 rows）+ legacy：清理后重迁成功", async () => {
    await fs.writeFile(
      path.join(DATASETS_DIR, `${UUID}.json`),
      JSON.stringify(legacyData()),
    );
    // 伪造半成品目录
    await fs.mkdir(path.join(DATASETS_DIR, UUID), { recursive: true });
    await fs.writeFile(path.join(DATASETS_DIR, UUID, "meta.json"), "{}");
    const ds = await getDataset(UUID);
    expect(ds).not.toBeNull();
    expect(ds!.rows).toHaveLength(2);
  });

  it("仅剩 .bak（无 legacy）：从 bak 恢复", async () => {
    await fs.writeFile(
      path.join(DATASETS_DIR, `${UUID}.json.bak`),
      JSON.stringify(legacyData()),
    );
    // 半成品目录触发恢复分支
    await fs.mkdir(path.join(DATASETS_DIR, UUID), { recursive: true });
    await fs.writeFile(path.join(DATASETS_DIR, UUID, "meta.json"), "{}");
    const ds = await getDataset(UUID);
    expect(ds).not.toBeNull();
    expect(ds!.rows).toHaveLength(2);
  });

  it("迁移成功后 listDatasets 只显示一次（不重复）", async () => {
    await fs.writeFile(
      path.join(DATASETS_DIR, `${UUID}.json`),
      JSON.stringify(legacyData()),
    );
    await getDataset(UUID); // 触发迁移
    const list = await listDatasets();
    const mine = list.filter((d) => d.id === UUID);
    expect(mine.length).toBe(1);
  });

  it("无任何可恢复数据源时返回 null（不抛错）", async () => {
    // 仅一个半成品目录，无 legacy、无 bak
    await fs.mkdir(path.join(DATASETS_DIR, UUID), { recursive: true });
    await fs.writeFile(path.join(DATASETS_DIR, UUID, "meta.json"), "{}");
    const ds = await getDataset(UUID);
    expect(ds).toBeNull();
  });
});
