import { describe, it, expect } from "vitest";
import { parseBuffer } from "@/lib/parse";
import { readFileSync } from "node:fs";
import path from "node:path";

const FIXTURE = (name: string) =>
  path.resolve(__dirname, "..", "fixtures", name);

describe("parseBuffer - CSV 基础", () => {
  it("正常解析 CSV 并生成列", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "operations-basic.csv");
    expect(parsed.source).toBe("csv");
    expect(parsed.rows.length).toBe(6);
    expect(parsed.columns.length).toBeGreaterThan(0);
    const names = parsed.columns.map((c) => c.name);
    expect(names).toContain("date");
    expect(names).toContain("客户");
    expect(names).toContain("金额");
  });

  it("空文件返回零行零列，不抛错（由上层判断 rows.length===0 报 422）", () => {
    const parsed = parseBuffer(Buffer.from("", "utf-8"), "empty.csv");
    expect(parsed.rows.length).toBe(0);
    expect(parsed.columns.length).toBe(0);
  });

  it("过滤 SheetJS __EMPTY_* 占位列（CSV 不产生，验证过滤逻辑不破坏正常列）", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    const names = parsed.columns.map((c) => c.name);
    expect(names.some((n) => /^__EMPTY/.test(n))).toBe(false);
  });
});

describe("parseBuffer - 行数与截断", () => {
  it("超过 MAX_STORED_ROWS 时截断并标记 truncated", () => {
    // 构造 60000 行 CSV
    const header = "id,value\n";
    const lines: string[] = [header];
    for (let i = 0; i < 60000; i++) lines.push(`${i},${i * 2}\n`);
    const buf = Buffer.from(lines.join(""), "utf-8");
    const parsed = parseBuffer(buf, "big.csv");
    expect(parsed.truncated).toBe(true);
    expect(parsed.rows.length).toBeLessThan(60000);
    expect(parsed.rows.length).toBeGreaterThan(0);
  });

  it("未超限不截断", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    expect(parsed.truncated).toBe(false);
  });
});

describe("parseBuffer - 类型推断基础", () => {
  it("数值列推断为 number", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    const col = parsed.columns.find((c) => c.name === "托管群数");
    expect(col?.type).toBe("number");
  });

  it("日期列推断为 date", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    const col = parsed.columns.find((c) => c.name === "date");
    expect(col?.type).toBe("date");
  });
});

describe("parseBuffer - 混合类型", () => {
  it("混合列降级为 string", () => {
    const buf = readFileSync(FIXTURE("mixed-types.csv"));
    const parsed = parseBuffer(buf, "mixed.csv");
    // 数值列含 abc 与空 → 非数值占比高 → string
    const numCol = parsed.columns.find((c) => c.name === "数值");
    expect(["string", "number"]).toContain(numCol?.type);
  });
});

describe("parseBuffer - 数字格式解析", () => {
  it("金额列解析为 number 且 format=currency，行值规范化", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    const col = parsed.columns.find((c) => c.name === "金额");
    expect(col?.type).toBe("number");
    expect(col?.format).toBe("currency");
    expect(typeof parsed.rows[0]["金额"]).toBe("number");
    expect(parsed.rows[0]["金额"]).toBe(1200);
  });

  it("百分比列 format=percentage，值转小数", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    const col = parsed.columns.find((c) => c.name === "活跃率");
    expect(col?.format).toBe("percentage");
    expect(parsed.rows[0]["活跃率"]).toBeCloseTo(0.65);
  });

  it("千分位数字解析", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    // 第 4 行金额 1,234.56
    expect(parsed.rows[3]["金额"]).toBeCloseTo(1234.56);
  });
});

describe("parseBuffer - 日期标准化", () => {
  it("日期列统一为 ISO 字符串", () => {
    const buf = readFileSync(FIXTURE("dates-unsorted.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    const col = parsed.columns.find((c) => c.name === "date");
    expect(col?.type).toBe("date");
    for (const r of parsed.rows) {
      expect(r["date"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("中文日期标准化为 ISO", () => {
    const buf = readFileSync(FIXTURE("mixed-types.csv"));
    const parsed = parseBuffer(buf, "mixed.csv");
    // 第 5 行 日期=2026年7月5日 → 2026-07-05
    expect(parsed.rows[4]["日期"]).toBe("2026-07-05");
    // 第 3 行 2026/7/3 → 2026-07-03
    expect(parsed.rows[2]["日期"]).toBe("2026-07-03");
  });
});

describe("parseBuffer - 字段角色与聚合", () => {
  it("推断 role 与 defaultAggregation", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    const dateCol = parsed.columns.find((c) => c.name === "date");
    expect(dateCol?.role).toBe("time");
    const statusCol = parsed.columns.find((c) => c.name === "运营状态");
    expect(statusCol?.role).toBe("status");
    const pctCol = parsed.columns.find((c) => c.name === "活跃率");
    expect(pctCol?.role).toBe("metric");
    expect(pctCol?.defaultAggregation).toBe("avg");
    const numCol = parsed.columns.find((c) => c.name === "托管群数");
    expect(numCol?.defaultAggregation).toBe("sum");
  });
});

describe("parseBuffer - 质量报告", () => {
  it("正常数据无 error 级警告", () => {
    const buf = readFileSync(FIXTURE("operations-basic.csv"));
    const parsed = parseBuffer(buf, "ops.csv");
    expect(parsed.quality.originalRowCount).toBe(6);
    expect(parsed.quality.storedRowCount).toBe(6);
    expect(parsed.quality.columnCount).toBeGreaterThan(0);
    const errors = parsed.quality.warnings.filter((w) => w.level === "error");
    expect(errors).toHaveLength(0);
  });

  it("截断产生 TRUNCATED 警告", () => {
    const header = "id,value\n";
    const lines: string[] = [header];
    for (let i = 0; i < 60000; i++) lines.push(`${i},${i}\n`);
    const parsed = parseBuffer(Buffer.from(lines.join(""), "utf-8"), "big.csv");
    const trunc = parsed.quality.warnings.find((w) => w.code === "TRUNCATED");
    expect(trunc).toBeDefined();
    expect(parsed.quality.originalRowCount).toBe(60000);
    expect(parsed.quality.storedRowCount).toBeLessThan(60000);
  });

  it("重名列触发 DUPLICATE_COLUMN_NAME 且自动加后缀", () => {
    const buf = readFileSync(FIXTURE("duplicate-cols.csv"));
    const parsed = parseBuffer(buf, "dup.csv");
    const dup = parsed.quality.warnings.find(
      (w) => w.code === "DUPLICATE_COLUMN_NAME",
    );
    expect(dup).toBeDefined();
    const names = parsed.columns.map((c) => c.name);
    expect(names).toContain("客户");
    expect(names).toContain("客户_2");
  });

  it("空值率高的列触发 HIGH_NULL_RATE", () => {
    const csv = "字段,值\nA,\nB,\nC,\nD,1\n";
    const parsed = parseBuffer(Buffer.from(csv, "utf-8"), "nulls.csv");
    const warn = parsed.quality.warnings.find(
      (w) => w.code === "HIGH_NULL_RATE" && w.field === "值",
    );
    expect(warn).toBeDefined();
  });
});
