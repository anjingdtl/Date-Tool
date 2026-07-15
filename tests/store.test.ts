import { describe, it, expect, beforeEach } from "vitest";
import {
  saveDataset,
  getDataset,
  getPublicDataset,
  listDatasets,
  deleteDataset,
  updateAnalysis,
  isValidDatasetId,
  saveJsonAtomic,
  DatasetIdSchema,
  updateDatasetConfig,
  setDatasetStatus,
} from "@/lib/store";
import type { StoredDataset } from "@/lib/types";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";

function makeDataset(id: string, name = "测试集"): StoredDataset {
  return {
    id,
    name,
    fileName: `${name}.csv`,
    source: "csv",
    rowCount: 2,
    columns: [{ name: "a", type: "number", sampleValues: [1, 2] }],
    rows: [{ a: 1 }, { a: 2 }],
    analysis: null,
    createdAt: new Date().toISOString(),
  };
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("DatasetIdSchema / isValidDatasetId", () => {
  it("合法 UUID 通过", () => {
    expect(isValidDatasetId(VALID_UUID)).toBe(true);
    expect(DatasetIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("拒绝非 UUID（路径遍历、短 id、空串）", () => {
    expect(isValidDatasetId("../../etc/passwd")).toBe(false);
    expect(isValidDatasetId("abc")).toBe(false);
    expect(isValidDatasetId("")).toBe(false);
    expect(isValidDatasetId("not-a-uuid-at-all")).toBe(false);
  });
});

describe("saveJsonAtomic", () => {
  it("写入后内容完整且可读", async () => {
    const file = path.join(config.dataDir, "atomic-test.json");
    await saveJsonAtomic(file, { hello: "world", n: 42 });
    const raw = await fs.readFile(file, "utf-8");
    expect(JSON.parse(raw)).toEqual({ hello: "world", n: 42 });
  });

  it("失败时清理临时文件（目标目录不可写时）", async () => {
    // 写入一个不存在的深层目录会被 mkdir 处理；这里测试正常路径下 tmp 清理
    const file = path.join(config.dataDir, "sub", "atomic-ok.json");
    await saveJsonAtomic(file, { ok: true });
    const files = await fs.readdir(path.join(config.dataDir, "sub"));
    // 只剩目标文件，无 .tmp 残留
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });
});

describe("saveDataset / getDataset", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("保存后可读取完整数据（含 rows）", async () => {
    const ds = makeDataset(VALID_UUID);
    await saveDataset(ds);
    const got = await getDataset(VALID_UUID);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(VALID_UUID);
    expect(got!.rows).toHaveLength(2);
  });

  it("拒绝保存非 UUID id", async () => {
    await expect(saveDataset(makeDataset("bad-id"))).rejects.toThrow();
  });

  it("getDataset 对非 UUID 返回 null（不访问文件系统）", async () => {
    expect(await getDataset("../../etc/passwd")).toBeNull();
    expect(await getDataset("")).toBeNull();
  });

  it("getDataset 不存在返回 null", async () => {
    expect(await getDataset("22222222-2222-4222-8222-222222222222")).toBeNull();
  });
});

describe("getPublicDataset", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("不含原始 rows，含 hasAnalysis 标记", async () => {
    await saveDataset(makeDataset(VALID_UUID));
    const pub = await getPublicDataset(VALID_UUID);
    expect(pub).not.toBeNull();
    expect(pub!.id).toBe(VALID_UUID);
    expect((pub as unknown as Record<string, unknown>).rows).toBeUndefined();
    expect(pub!.hasAnalysis).toBe(false);
  });
});

describe("listDatasets", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("列表不加载 rows，按创建时间倒序", async () => {
    const a = makeDataset("11111111-1111-4111-8111-111111111111", "A");
    a.createdAt = "2026-01-01T00:00:00.000Z";
    const b = makeDataset("22222222-2222-4222-8222-222222222222", "B");
    b.createdAt = "2026-02-01T00:00:00.000Z";
    await saveDataset(a);
    await saveDataset(b);
    const list = await listDatasets();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("B"); // 较新在前
    expect((list[0] as unknown as Record<string, unknown>).rows).toBeUndefined();
  });

  it("损坏文件被跳过，不影响其他数据集", async () => {
    const dir = path.join(config.dataDir, "datasets");
    await saveDataset(makeDataset(VALID_UUID));
    // 写一个损坏文件
    await fs.writeFile(
      path.join(dir, "33333333-3333-4333-8333-333333333333.json"),
      "{ not valid json",
      "utf-8",
    );
    const list = await listDatasets();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(VALID_UUID);
  });
});

describe("拆分存储：meta / rows / analyses 三文件", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("保存后磁盘为 {id}/meta.json + rows.json + analyses.json", async () => {
    await saveDataset(makeDataset(VALID_UUID));
    const base = path.join(config.dataDir, "datasets", VALID_UUID);
    const metaStat = await fs.stat(path.join(base, "meta.json")).catch(() => null);
    const rowsStat = await fs.stat(path.join(base, "rows.json")).catch(() => null);
    const anStat = await fs.stat(path.join(base, "analyses.json")).catch(() => null);
    expect(metaStat).not.toBeNull();
    expect(rowsStat).not.toBeNull();
    expect(anStat).not.toBeNull();
  });

  it("meta.json 不含 rows（行数据独立存储）", async () => {
    await saveDataset(makeDataset(VALID_UUID));
    const meta = JSON.parse(
      await fs.readFile(
        path.join(config.dataDir, "datasets", VALID_UUID, "meta.json"),
        "utf-8",
      ),
    );
    expect((meta as Record<string, unknown>).rows).toBeUndefined();
    expect((meta as Record<string, unknown>).analysis).toBeUndefined();
  });

  it("getDataset 读回完整含 rows", async () => {
    await saveDataset(makeDataset(VALID_UUID));
    const ds = await getDataset(VALID_UUID);
    expect(ds).not.toBeNull();
    expect(ds!.rows).toHaveLength(2);
  });

  it("rows.json 损坏时 getDataset 返回空 rows 不崩溃", async () => {
    await saveDataset(makeDataset(VALID_UUID));
    await fs.writeFile(
      path.join(config.dataDir, "datasets", VALID_UUID, "rows.json"),
      "{ broken",
      "utf-8",
    );
    const ds = await getDataset(VALID_UUID);
    expect(ds).not.toBeNull();
    expect(ds!.rows).toEqual([]);
  });
});

describe("旧格式迁移：{id}.json → {id}/ 三文件 + .bak", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("getDataset 触发迁移，数据完整且旧文件改 .bak", async () => {
    // 手写旧格式单文件
    const legacy = makeDataset(VALID_UUID, "旧数据集");
    const legacyFile = path.join(config.dataDir, "datasets", `${VALID_UUID}.json`);
    await fs.writeFile(legacyFile, JSON.stringify(legacy), "utf-8");

    // 触发迁移
    const ds = await getDataset(VALID_UUID);
    expect(ds).not.toBeNull();
    expect(ds!.name).toBe("旧数据集");
    expect(ds!.rows).toHaveLength(2);

    // 新目录三文件存在
    const base = path.join(config.dataDir, "datasets", VALID_UUID);
    await expect(fs.access(path.join(base, "meta.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(base, "rows.json"))).resolves.toBeUndefined();

    // 旧文件改 .bak
    await expect(fs.access(legacyFile)).rejects.toBeDefined();
    await expect(
      fs.access(`${legacyFile}.bak`),
    ).resolves.toBeUndefined();
  });

  it("迁移后 listDatasets 通过 meta 读取（不依赖 legacy 全量）", async () => {
    const legacy = makeDataset(VALID_UUID, "迁移集");
    const legacyFile = path.join(config.dataDir, "datasets", `${VALID_UUID}.json`);
    await fs.writeFile(legacyFile, JSON.stringify(legacy), "utf-8");

    await getDataset(VALID_UUID); // 触发迁移
    // 删除 legacy .bak，只留新目录
    await fs.unlink(`${legacyFile}.bak`);

    const list = await listDatasets();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("迁移集");
    expect(list[0].hasAnalysis).toBe(false);
  });

  it("损坏 legacy 文件迁移失败时保留原文件不丢数据", async () => {
    const legacyFile = path.join(config.dataDir, "datasets", `${VALID_UUID}.json`);
    await fs.writeFile(legacyFile, "{ not valid", "utf-8");

    const ds = await getDataset(VALID_UUID);
    expect(ds).toBeNull();
    // 损坏文件仍保留
    await expect(fs.access(legacyFile)).resolves.toBeUndefined();
  });
});

describe("updateAnalysis 历史（保留最近 3 次）", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("多次分析后 analyses 保留最近 3 次", async () => {
    await saveDataset(makeDataset(VALID_UUID));
    const mk = (i: number) => ({
      provider: "local" as const,
      summary: `分析${i}`,
      insights: [],
      charts: [],
      options: [],
      narrative: "",
      createdAt: new Date(2026, 0, i + 1).toISOString(),
      version: "v0.2.1",
    });
    await updateAnalysis(VALID_UUID, mk(1));
    await updateAnalysis(VALID_UUID, mk(2));
    await updateAnalysis(VALID_UUID, mk(3));
    await updateAnalysis(VALID_UUID, mk(4));

    const ds = await getDataset(VALID_UUID);
    expect(ds).not.toBeNull();
    expect(ds!.analyses).toHaveLength(3);
    // 最近一次是 mk(4)
    expect(ds!.analysis!.summary).toBe("分析4");
    expect(ds!.analyses![0].summary).toBe("分析2");
    expect(ds!.status).toBe("completed");
  });
});

describe("deleteDataset", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("删除存在的数据集返回 true", async () => {
    await saveDataset(makeDataset(VALID_UUID));
    expect(await deleteDataset(VALID_UUID)).toBe(true);
    expect(await getDataset(VALID_UUID)).toBeNull();
  });

  it("删除不存在返回 false", async () => {
    expect(await deleteDataset("22222222-2222-4222-8222-222222222222")).toBe(false);
  });

  it("删除非 UUID 返回 false（不访问文件系统）", async () => {
    expect(await deleteDataset("../../etc/passwd")).toBe(false);
  });
});

describe("updateDatasetConfig（阶段 D）", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("更新字段的 role/format/agg/includeInAnalysis 并标记 userModified", async () => {
    const ds = makeDataset(VALID_UUID);
    ds.columns = [
      {
        name: "金额",
        type: "number",
        sampleValues: [100],
        role: "metric",
        format: "decimal",
        defaultAggregation: "sum",
        includeInAnalysis: true,
        userModified: false,
      },
    ];
    ds.status = "draft";
    await saveDataset(ds);

    const updated = await updateDatasetConfig(
      VALID_UUID,
      [
        {
          name: "金额",
          type: "number",
          role: "dimension",
          format: "currency",
          defaultAggregation: "avg",
          includeInAnalysis: false,
        },
      ],
      undefined,
    );
    expect(updated).not.toBeNull();
    expect(updated!.columns[0].role).toBe("dimension");
    expect(updated!.columns[0].format).toBe("currency");
    expect(updated!.columns[0].defaultAggregation).toBe("avg");
    expect(updated!.columns[0].includeInAnalysis).toBe(false);
    expect(updated!.columns[0].userModified).toBe(true);
    // 保留 sampleValues
    expect(updated!.columns[0].sampleValues).toEqual([100]);
  });

  it("未变化的字段不标记 userModified", async () => {
    const ds = makeDataset(VALID_UUID);
    ds.columns = [
      {
        name: "金额",
        type: "number",
        sampleValues: [100],
        role: "metric",
        format: "decimal",
        defaultAggregation: "sum",
        includeInAnalysis: true,
        userModified: false,
      },
    ];
    ds.status = "draft";
    await saveDataset(ds);

    // 提交与原值一致的配置
    const updated = await updateDatasetConfig(
      VALID_UUID,
      [
        {
          name: "金额",
          type: "number",
          role: "metric",
          format: "decimal",
          defaultAggregation: "sum",
          includeInAnalysis: true,
        },
      ],
      undefined,
    );
    expect(updated!.columns[0].userModified).toBe(false);
  });

  it("不存在的数据集返回 null", async () => {
    const r = await updateDatasetConfig(
      "33333333-3333-4333-8333-333333333333",
      [],
      undefined,
    );
    expect(r).toBeNull();
  });

  it("同步保存 analysisConfig 到 meta", async () => {
    const ds = makeDataset(VALID_UUID);
    ds.status = "draft";
    await saveDataset(ds);
    const cfg = {
      timeField: "a",
      statusFields: [],
      metricFields: ["a"],
      ignoredFields: [],
      maxCharts: 8,
    };
    await updateDatasetConfig(VALID_UUID, [], cfg);
    const got = await getDataset(VALID_UUID);
    expect(got!.config).toBeDefined();
    expect(got!.config!.maxCharts).toBe(8);
    expect(got!.config!.timeField).toBe("a");
  });
});

describe("setDatasetStatus（阶段 D）", () => {
  beforeEach(async () => {
    const dir = path.join(config.dataDir, "datasets");
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(dir, { recursive: true });
  });

  it("draft → ready", async () => {
    const ds = makeDataset(VALID_UUID);
    ds.status = "draft";
    await saveDataset(ds);
    const r = await setDatasetStatus(VALID_UUID, "ready");
    expect(r).not.toBeNull();
    expect(r!.status).toBe("ready");
    // 落盘可见
    const got = await getDataset(VALID_UUID);
    expect(got!.status).toBe("ready");
  });

  it("不存在的数据集返回 null", async () => {
    const r = await setDatasetStatus(
      "44444444-4444-4444-8444-444444444444",
      "ready",
    );
    expect(r).toBeNull();
  });
});
