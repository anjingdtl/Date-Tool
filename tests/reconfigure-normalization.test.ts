/**
 * tests/reconfigure-normalization.test.ts
 *
 * SPEC 7.7 / 18.3：字段确认后按最终类型/格式重新规范化 rows。
 *
 * 单元：normalizeRowsByColumns / recomputeColumnStats（Case A-E）
 * 集成：reconfigureAndConfirm 端到端（rows 落盘 + quality 含 INVALID_DATE）
 */

import { describe, it, expect } from "vitest";
import {
  normalizeRowsByColumns,
  recomputeColumnStats,
} from "@/lib/normalize";
import {
  saveDataset,
  reconfigureAndConfirm,
  getDataset,
} from "@/lib/store";
import type { ColumnMeta, DatasetRow, StoredDataset } from "@/lib/types";

function col(over: Partial<ColumnMeta> & { name: string }): ColumnMeta {
  return {
    type: "string",
    role: "dimension",
    format: "plain",
    sampleValues: [],
    nullable: false,
    nullCount: 0,
    nullRate: 0,
    distinctCount: 0,
    confidence: 1,
    includeInAnalysis: true,
    defaultAggregation: "count",
    userModified: false,
    ...over,
  };
}

function makeDataset(over: Partial<StoredDataset> = {}): StoredDataset {
  const rows = over.rows ?? [];
  const columns = over.columns ?? [];
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "测试",
    fileName: "test.csv",
    source: "csv",
    rowCount: rows.length,
    originalRowCount: rows.length,
    storedRowCount: rows.length,
    columns,
    rows,
    createdAt: now,
    quality: {
      originalRowCount: rows.length,
      storedRowCount: rows.length,
      columnCount: columns.length,
      duplicateRowCount: 0,
      emptyRowCount: 0,
      warnings: [],
      generatedAt: now,
    },
    status: "draft",
    analysis: null,
    ...over,
  };
}

describe("normalizeRowsByColumns - SPEC 7.7", () => {
  it("Case A: \"1,234\" string → number 后值为 1234", () => {
    const columns = [col({ name: "金额", type: "number", format: "currency" })];
    const rows: DatasetRow[] = [{ 金额: "1,234" }];
    const { rows: out } = normalizeRowsByColumns(rows, columns);
    expect(out[0]["金额"]).toBe(1234);
  });

  it("Case B: \"65%\" → percentage 后值为 0.65", () => {
    const columns = [col({ name: "转化率", type: "number", format: "percentage" })];
    const rows: DatasetRow[] = [{ 转化率: "65%" }];
    const { rows: out } = normalizeRowsByColumns(rows, columns);
    expect(out[0]["转化率"]).toBeCloseTo(0.65);
  });

  it("Case C: \"2026/7/1\" → date 后值为 2026-07-01", () => {
    const columns = [col({ name: "日期", type: "date", format: "date" })];
    const rows: DatasetRow[] = [{ 日期: "2026/7/1" }];
    const { rows: out } = normalizeRowsByColumns(rows, columns);
    expect(out[0]["日期"]).toBe("2026-07-01");
  });

  it("Case D: 非法日期 2026-02-31 → null 且记 invalidDateCounts", () => {
    const columns = [col({ name: "日期", type: "date", format: "date" })];
    const rows: DatasetRow[] = [{ 日期: "2026-02-31" }];
    const { rows: out, invalidDateCounts } = normalizeRowsByColumns(rows, columns);
    expect(out[0]["日期"]).toBeNull();
    expect(invalidDateCounts["日期"]).toBe(1);
  });

  it("Case E: 标识字段 \"00123\" 保持 string，前导零不丢", () => {
    const columns = [
      col({ name: "编号", type: "string", role: "identifier", format: "plain" }),
    ];
    const rows: DatasetRow[] = [{ 编号: "00123" }];
    const { rows: out } = normalizeRowsByColumns(rows, columns);
    expect(out[0]["编号"]).toBe("00123");
  });

  it("数字列无法解析的值 → null 且记 invalidNumberCounts", () => {
    const columns = [col({ name: "v", type: "number" })];
    const rows: DatasetRow[] = [{ v: "abc" }, { v: "100" }];
    const { rows: out, invalidNumberCounts } = normalizeRowsByColumns(rows, columns);
    expect(out[0]["v"]).toBeNull();
    expect(out[1]["v"]).toBe(100);
    expect(invalidNumberCounts["v"]).toBe(1);
  });

  it("boolean 列支持 是/否/1/0", () => {
    const columns = [col({ name: "flag", type: "boolean" })];
    const rows: DatasetRow[] = [
      { flag: "是" },
      { flag: "否" },
      { flag: 1 },
      { flag: 0 },
      { flag: "maybe" },
    ];
    const { rows: out } = normalizeRowsByColumns(rows, columns);
    expect(out[0]["flag"]).toBe(true);
    expect(out[1]["flag"]).toBe(false);
    expect(out[2]["flag"]).toBe(true);
    expect(out[3]["flag"]).toBe(false);
    expect(out[4]["flag"]).toBeNull();
  });
});

describe("recomputeColumnStats - SPEC 7.5", () => {
  it("基于规范化后 rows 重算 nullCount/distinctCount/sampleValues", () => {
    const columns = [col({ name: "v", type: "number" })];
    const rows: DatasetRow[] = [{ v: 1 }, { v: 2 }, { v: null }, { v: "x" }];
    const norm = normalizeRowsByColumns(rows, columns);
    const stats = recomputeColumnStats(norm.rows, columns);
    expect(stats[0].nullCount).toBe(2); // 原 null + "x" 无法解析
    expect(stats[0].distinctCount).toBe(2); // 1, 2
    expect(stats[0].sampleValues.length).toBe(2);
    expect(stats[0].nullable).toBe(true);
  });

  it("保留原 confidence 与 userModified", () => {
    const columns = [col({ name: "v", type: "number", confidence: 0.42, userModified: true })];
    const rows: DatasetRow[] = [{ v: 1 }];
    const norm = normalizeRowsByColumns(rows, columns);
    const stats = recomputeColumnStats(norm.rows, columns);
    expect(stats[0].confidence).toBe(0.42);
    expect(stats[0].userModified).toBe(true);
  });
});

describe("reconfigureAndConfirm - 端到端（SPEC 7.4 / 23.2）", () => {
  it("改类型后 rows 规范化并落盘，quality 含 INVALID_DATE，状态 ready", async () => {
    const ds = makeDataset({
      columns: [
        col({ name: "金额", type: "string", format: "plain" }),
        col({ name: "日期", type: "date", format: "date" }),
      ],
      rows: [
        { 金额: "1,234", 日期: "2026-02-31" },
        { 金额: "2,000", 日期: "2026-03-01" },
      ],
    });
    await saveDataset(ds);

    const updated = await reconfigureAndConfirm(ds.id, [
      {
        name: "金额",
        type: "number",
        role: "metric",
        format: "currency",
        defaultAggregation: "sum",
        includeInAnalysis: true,
      },
      {
        name: "日期",
        type: "date",
        role: "time",
        format: "date",
        defaultAggregation: "count",
        includeInAnalysis: true,
      },
    ]);

    expect(updated).not.toBeNull();
    expect(updated!.rows[0]["金额"]).toBe(1234);
    expect(updated!.rows[0]["日期"]).toBeNull(); // 2026-02-31 非法
    expect(updated!.rows[1]["日期"]).toBe("2026-03-01");
    expect(updated!.status).toBe("ready");

    const invalidDate = updated!.quality!.warnings.find(
      (w) => w.code === "INVALID_DATE",
    );
    expect(invalidDate).toBeDefined();

    // 重读确认落盘（SPEC 27.7 原子写入）
    const reloaded = await getDataset(ds.id);
    expect(reloaded!.rows[0]["金额"]).toBe(1234);
    expect(reloaded!.status).toBe("ready");
    // 元数据基于规范化后 rows 重算
    const amountCol = reloaded!.columns.find((c) => c.name === "金额")!;
    expect(amountCol.type).toBe("number");
  });

  it("无 columns 提交时用现有 columns 规范化", async () => {
    const ds = makeDataset({
      columns: [col({ name: "v", type: "number", format: "decimal" })],
      rows: [{ v: "3.14" }],
    });
    await saveDataset(ds);
    const updated = await reconfigureAndConfirm(ds.id);
    expect(updated!.rows[0]["v"]).toBeCloseTo(3.14);
    expect(updated!.status).toBe("ready");
  });
});
