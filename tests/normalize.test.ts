import { describe, it, expect } from "vitest";
import {
  parseNumberValue,
  parseDateValue,
  cleanColumnNames,
} from "@/lib/normalize";

describe("parseNumberValue", () => {
  it("整数", () => {
    expect(parseNumberValue("100")).toEqual({ value: 100, format: "integer" });
    expect(parseNumberValue(100)).toEqual({ value: 100, format: "integer" });
  });

  it("小数", () => {
    expect(parseNumberValue("3.14")).toEqual({ value: 3.14, format: "decimal" });
  });

  it("千分位整数", () => {
    expect(parseNumberValue("1,234")).toEqual({ value: 1234, format: "decimal" });
  });

  it("千分位小数", () => {
    expect(parseNumberValue("1,234.56")).toEqual({
      value: 1234.56,
      format: "decimal",
    });
  });

  it("百分比 → 小数", () => {
    expect(parseNumberValue("65%")).toEqual({ value: 0.65, format: "percentage" });
    expect(parseNumberValue("65.5%")).toEqual({
      value: 0.655,
      format: "percentage",
    });
    // 全角百分号
    expect(parseNumberValue("72％")).toEqual({
      value: 0.72,
      format: "percentage",
    });
  });

  it("货币 ¥ ￥ $ → 数值 currency", () => {
    expect(parseNumberValue("¥1,200")).toEqual({
      value: 1200,
      format: "currency",
    });
    expect(parseNumberValue("￥800")).toEqual({
      value: 800,
      format: "currency",
    });
    expect(parseNumberValue("$1,500")).toEqual({
      value: 1500,
      format: "currency",
    });
  });

  it("负数", () => {
    expect(parseNumberValue("-3.14")).toEqual({
      value: -3.14,
      format: "decimal",
    });
  });

  it("全角逗号千分位", () => {
    expect(parseNumberValue("1，234")).toEqual({
      value: 1234,
      format: "decimal",
    });
  });

  it("非数字 → null + plain", () => {
    expect(parseNumberValue("abc")).toEqual({ value: null, format: "plain" });
    expect(parseNumberValue("")).toEqual({ value: null, format: "plain" });
    expect(parseNumberValue(null)).toEqual({ value: null, format: "plain" });
    expect(parseNumberValue(undefined)).toEqual({
      value: null,
      format: "plain",
    });
  });
});

describe("parseDateValue", () => {
  it("ISO 日期", () => {
    expect(parseDateValue("2026-07-01")).toBe("2026-07-01");
  });

  it("斜杠日期补零", () => {
    expect(parseDateValue("2026/7/3")).toBe("2026-07-03");
  });

  it("点分日期", () => {
    expect(parseDateValue("2026.7.5")).toBe("2026-07-05");
  });

  it("中文日期", () => {
    expect(parseDateValue("2026年7月5日")).toBe("2026-07-05");
    expect(parseDateValue("2026年07月05日")).toBe("2026-07-05");
  });

  it("含时分秒只取日期", () => {
    expect(parseDateValue("2026-07-01 12:30:00")).toBe("2026-07-01");
    expect(parseDateValue("2026-07-01T12:30")).toBe("2026-07-01");
  });

  it("Date 对象", () => {
    const d = new Date(Date.UTC(2026, 6, 1));
    expect(parseDateValue(d)).toBe("2026-07-01");
  });

  it("非法日期 → null", () => {
    expect(parseDateValue("abc")).toBeNull();
    expect(parseDateValue("")).toBeNull();
    expect(parseDateValue("2026-13-01")).toBeNull(); // 月非法
    expect(parseDateValue(null)).toBeNull();
  });

  it("越界年份 → null", () => {
    expect(parseDateValue("1800-01-01")).toBeNull();
    expect(parseDateValue("2200-01-01")).toBeNull();
  });
});

describe("cleanColumnNames", () => {
  it("去除 BOM 与首尾空白", () => {
    const { names } = cleanColumnNames(["\uFEFF姓名", " 年龄 "]);
    expect(names).toEqual(["姓名", "年龄"]);
  });

  it("空名占位 列N", () => {
    const { names } = cleanColumnNames(["a", "", ""]);
    expect(names).toEqual(["a", "列2", "列3"]);
  });

  it("重名加后缀 _2 _3", () => {
    const { names, duplicateRenamed } = cleanColumnNames([
      "客户",
      "客户",
      "客户",
    ]);
    expect(names).toEqual(["客户", "客户_2", "客户_3"]);
    expect(duplicateRenamed).toBe(true);
  });

  it("无重名 duplicateRenamed=false", () => {
    const { duplicateRenamed } = cleanColumnNames(["a", "b", "c"]);
    expect(duplicateRenamed).toBe(false);
  });
});
