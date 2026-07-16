import { describe, it, expect } from "vitest";
import type { ColumnMeta } from "@/lib/types";
import {
  createValueMasker,
  detectSensitiveFields,
  isSensitiveColumn,
  maskRow,
} from "@/lib/semantic/detect-sensitive";

function col(name: string, extra: Partial<ColumnMeta> = {}): ColumnMeta {
  return { name, type: "string", sampleValues: [], ...extra };
}

describe("isSensitiveColumn - SPEC 9.4", () => {
  it("字段名命中敏感关键词", () => {
    expect(isSensitiveColumn(col("客户姓名"))).toBe(true);
    expect(isSensitiveColumn(col("手机号"))).toBe(true);
    expect(isSensitiveColumn(col("邮箱"))).toBe(true);
    expect(isSensitiveColumn(col("身份证号"))).toBe(true);
    expect(isSensitiveColumn(col("订单号"))).toBe(true);
    expect(isSensitiveColumn(col("收货地址"))).toBe(true);
  });

  it("identifier 角色视为敏感", () => {
    expect(isSensitiveColumn(col("col1", { role: "identifier" }))).toBe(true);
  });

  it("抽样值命中手机号格式（过半）", () => {
    expect(
      isSensitiveColumn(
        col("f", {
          sampleValues: ["13812345678", "13800001111", "13911112222"],
        }),
      ),
    ).toBe(true);
  });

  it("抽样值命中邮箱格式", () => {
    expect(
      isSensitiveColumn(
        col("f", {
          sampleValues: ["a@b.com", "c@d.com", "e@f.com"],
        }),
      ),
    ).toBe(true);
  });

  it("普通业务字段不敏感", () => {
    expect(isSensitiveColumn(col("业务收入"))).toBe(false);
    expect(isSensitiveColumn(col("地市"))).toBe(false);
    expect(isSensitiveColumn(col("月份"))).toBe(false);
  });

  it("少量命中不过半不判敏感", () => {
    expect(
      isSensitiveColumn(
        col("f", { sampleValues: ["13812345678", "正常值", "其他"] }),
      ),
    ).toBe(false);
  });
});

describe("detectSensitiveFields", () => {
  it("返回敏感字段名集合", () => {
    const cols = [
      col("月份"),
      col("地市"),
      col("业务收入", { type: "number" }),
      col("客户姓名"),
      col("手机号"),
    ];
    const s = detectSensitiveFields(cols);
    expect(s.has("客户姓名")).toBe(true);
    expect(s.has("手机号")).toBe(true);
    expect(s.has("业务收入")).toBe(false);
    expect(s.size).toBe(2);
  });
});

describe("createValueMasker - 稳定掩码", () => {
  it("敏感字段值被掩码，非敏感原样", () => {
    const masker = createValueMasker(new Set(["手机号"]));
    const masked = masker.mask("手机号", "13812345678");
    expect(masked).not.toBe("13812345678");
    expect(masker.mask("业务收入", 100)).toBe(100);
  });

  it("同一原值映射同一掩码（一致性）", () => {
    const masker = createValueMasker(new Set(["姓名"]));
    const a = masker.mask("姓名", "张三");
    const b = masker.mask("姓名", "张三");
    expect(a).toBe(b);
  });

  it("不同原值通常不同掩码", () => {
    const masker = createValueMasker(new Set(["姓名"]));
    const a = masker.mask("姓名", "张三");
    const b = masker.mask("姓名", "李四");
    expect(a).not.toBe(b);
  });

  it("保留长度（掩码后长度等于原值长度）", () => {
    const masker = createValueMasker(new Set(["手机号", "姓名"]));
    const phone = masker.mask("手机号", "13812345678") as string;
    expect(phone.length).toBe("13812345678".length);
    const name = masker.mask("姓名", "欧阳娜娜") as string;
    expect(name.length).toBe("欧阳娜娜".length);
  });

  it("完整原值不出现在掩码结果", () => {
    const masker = createValueMasker(new Set(["手机号"]));
    const masked = masker.mask("手机号", "13812345678") as string;
    expect(masked).not.toContain("13812345678");
    expect(masked).toContain("*");
  });

  it("null/空值原样返回", () => {
    const masker = createValueMasker(new Set(["姓名"]));
    expect(masker.mask("姓名", null)).toBe(null);
    expect(masker.mask("姓名", "")).toBe("");
    expect(masker.mask("姓名", undefined)).toBe(undefined);
  });
});

describe("maskRow", () => {
  it("整行中敏感字段掩码、其余保留", () => {
    const masker = createValueMasker(new Set(["姓名", "手机号"]));
    const out = maskRow(
      { 地市: "南宁", 业务收入: 100, 姓名: "张三", 手机号: "13812345678" },
      masker,
    );
    expect(out.地市).toBe("南宁");
    expect(out.业务收入).toBe(100);
    expect(out.姓名).not.toBe("张三");
    expect(out.手机号).not.toBe("13812345678");
  });
});
