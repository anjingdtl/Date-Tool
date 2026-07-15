/**
 * tests/type-sampling.test.ts
 *
 * SPEC 10.6 / 18.3：均匀采样、类型置信度、typeDistribution、MIXED_TYPE、日期合法性。
 */

import { describe, it, expect } from "vitest";
import { sampleRowIndices, profileColumn } from "@/lib/parse";
import { generateDataQuality } from "@/lib/quality";
import { parseDateValue } from "@/lib/normalize";
import type { ColumnMeta, ColumnType, DatasetRow } from "@/lib/types";

describe("sampleRowIndices - SPEC 10.2", () => {
  it("rowCount <= maxSamples 全量", () => {
    expect(sampleRowIndices(100).length).toBe(100);
    expect(sampleRowIndices(100)[0]).toBe(0);
    expect(sampleRowIndices(100)[99]).toBe(99);
    expect(sampleRowIndices(500).length).toBe(500);
  });

  it("rowCount > maxSamples 等距覆盖头中尾且去重", () => {
    const idx = sampleRowIndices(10000, 500);
    expect(idx.length).toBeLessThanOrEqual(500);
    expect(idx).toContain(0); // 头
    expect(idx).toContain(9999); // 尾
    expect(new Set(idx).size).toBe(idx.length); // 去重
  });

  it("10 万行采样覆盖尾部", () => {
    const idx = sampleRowIndices(100000, 500);
    expect(idx).toContain(99999);
    expect(idx.length).toBeLessThanOrEqual(500);
  });

  it("空与单行", () => {
    expect(sampleRowIndices(0)).toEqual([]);
    expect(sampleRowIndices(1)).toEqual([0]);
  });
});

describe("profileColumn 采样 - SPEC 10.6", () => {
  it("前 500 行空、后 100 数字 → number（采样覆盖尾部）", () => {
    const rows: DatasetRow[] = [];
    for (let i = 0; i < 500; i++) rows.push({ v: "" });
    for (let i = 0; i < 100; i++) rows.push({ v: String(i) });
    const p = profileColumn(rows, "v");
    expect(p.type).toBe("number");
    expect(p.sampleNonNullCount).toBeGreaterThan(0);
  });

  it("头部文本、尾部数字 → 采样到数字", () => {
    const rows: DatasetRow[] = [];
    for (let i = 0; i < 400; i++) rows.push({ v: "abc" });
    for (let i = 0; i < 600; i++) rows.push({ v: String(i) });
    const p = profileColumn(rows, "v");
    expect(p.typeDistribution.number).toBeGreaterThan(0);
  });

  it("80% 数字 + 20% 文本 → number", () => {
    const rows: DatasetRow[] = [];
    for (let i = 0; i < 800; i++) rows.push({ v: String(i) });
    for (let i = 0; i < 200; i++) rows.push({ v: "x" });
    const p = profileColumn(rows, "v");
    expect(p.type).toBe("number");
  });

  it("50% 日期 + 50% 文本 → string（date < 0.8）", () => {
    const rows: DatasetRow[] = [];
    for (let i = 0; i < 500; i++) rows.push({ v: "2026-07-01" });
    for (let i = 0; i < 500; i++) rows.push({ v: "notdate" });
    const p = profileColumn(rows, "v");
    expect(p.type).toBe("string");
  });

  it("空列 confidence = 0", () => {
    const rows: DatasetRow[] = [{ v: "" }, { v: "" }, { v: "" }];
    const p = profileColumn(rows, "v");
    expect(p.confidence).toBe(0);
    expect(p.sampleNonNullCount).toBe(0);
  });

  it("单行数据", () => {
    const p = profileColumn([{ v: 42 }], "v");
    expect(p.type).toBe("number");
  });

  it("confidence 分母为 sampleNonNullCount（非全表）", () => {
    // 1000 行：900 空 + 100 数字。采样的非空全是数字 → confidence ≈ 1
    const rows: DatasetRow[] = [];
    for (let i = 0; i < 900; i++) rows.push({ v: "" });
    for (let i = 0; i < 100; i++) rows.push({ v: String(i) });
    const p = profileColumn(rows, "v");
    expect(p.type).toBe("number");
    expect(p.confidence).toBeCloseTo(1, 1);
  });
});

describe("MIXED_TYPE - SPEC 11.1", () => {
  function colWith(td: Partial<Record<ColumnType, number>>): ColumnMeta {
    return {
      name: "v",
      type: "string",
      sampleValues: [],
      typeDistribution: {
        number: td.number ?? 0,
        date: td.date ?? 0,
        boolean: td.boolean ?? 0,
        string: td.string ?? 0,
      },
    } as ColumnMeta;
  }
  function qualityOf(columns: ColumnMeta[]) {
    return generateDataQuality({
      rows: [],
      columns,
      originalRowCount: 0,
      storedRowCount: 0,
      truncated: false,
      duplicateRenamed: false,
    });
  }

  it("80% 数字 + 20% 文本 → MIXED_TYPE", () => {
    const q = qualityOf([colWith({ number: 80, string: 20 })]);
    expect(q.warnings.find((w) => w.code === "MIXED_TYPE")).toBeDefined();
  });

  it("纯数字（100%）不触发 MIXED_TYPE", () => {
    const q = qualityOf([colWith({ number: 100 })]);
    expect(q.warnings.find((w) => w.code === "MIXED_TYPE")).toBeUndefined();
  });

  it("数字与日期各半 → MIXED_TYPE（不依赖最终类型是否 string）", () => {
    const q = qualityOf([colWith({ number: 50, date: 50 })]);
    expect(q.warnings.find((w) => w.code === "MIXED_TYPE")).toBeDefined();
  });
});

describe("日期合法性 - SPEC 11.4 / 11.5", () => {
  it("2026-02-31 被拒绝（真实日历校验）", () => {
    expect(parseDateValue("2026-02-31")).toBeNull();
  });

  it("闰年 2-29 合法", () => {
    expect(parseDateValue("2024-02-29")).toBe("2024-02-29");
  });

  it("平年 2-29 非法", () => {
    expect(parseDateValue("2026-02-29")).toBeNull();
  });

  it("M/D/YYYY 支持", () => {
    expect(parseDateValue("7/3/2026")).toBe("2026-07-03");
  });

  it("MM/DD/YYYY 支持", () => {
    expect(parseDateValue("12/31/2026")).toBe("2026-12-31");
  });
});
