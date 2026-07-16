import { describe, it, expect } from "vitest";
import {
  FormulaExpressionSchema,
  validateFormula,
} from "@/lib/schemas/formula";

describe("FormulaExpressionSchema - SPEC 11.2", () => {
  it("接受 field 引用", () => {
    expect(
      FormulaExpressionSchema.safeParse({ op: "field", field: "业务收入" })
        .success,
    ).toBe(true);
  });

  it("接受 const 常量", () => {
    expect(FormulaExpressionSchema.safeParse({ op: "const", value: 100 }).success).toBe(true);
  });

  it("接受二元运算 add/subtract/multiply/divide", () => {
    for (const op of ["add", "subtract", "multiply", "divide"] as const) {
      const expr = {
        op,
        left: { op: "field", field: "a" },
        right: { op: "field", field: "b" },
      };
      expect(FormulaExpressionSchema.safeParse(expr).success).toBe(true);
    }
  });

  it("接受 safe_divide（含 whenZero 除零策略）", () => {
    const expr = {
      op: "safe_divide",
      numerator: { op: "field", field: "业务收入" },
      denominator: { op: "field", field: "目标收入" },
      whenZero: "null",
    };
    expect(FormulaExpressionSchema.safeParse(expr).success).toBe(true);
  });

  it("接受 abs/round 一元运算（round 可带 digits）", () => {
    expect(
      FormulaExpressionSchema.safeParse({ op: "abs", value: { op: "field", field: "x" } })
        .success,
    ).toBe(true);
    expect(
      FormulaExpressionSchema.safeParse({
        op: "round",
        value: { op: "field", field: "x" },
        digits: 2,
      }).success,
    ).toBe(true);
  });

  it("接受多层嵌套（深度 3）", () => {
    const expr = {
      op: "safe_divide",
      numerator: {
        op: "subtract",
        left: { op: "field", field: "业务收入" },
        right: { op: "field", field: "成本" },
      },
      denominator: { op: "field", field: "成本" },
      whenZero: "zero",
    };
    expect(FormulaExpressionSchema.safeParse(expr).success).toBe(true);
  });

  it("拒绝未知 op", () => {
    expect(
      FormulaExpressionSchema.safeParse({ op: "pow", value: { op: "field", field: "x" } })
        .success,
    ).toBe(false);
  });

  it("拒绝 safe_divide 缺 whenZero（除零必须显式处理）", () => {
    expect(
      FormulaExpressionSchema.safeParse({
        op: "safe_divide",
        numerator: { op: "field", field: "a" },
        denominator: { op: "field", field: "b" },
      }).success,
    ).toBe(false);
  });

  it("拒绝非法 whenZero 值", () => {
    expect(
      FormulaExpressionSchema.safeParse({
        op: "safe_divide",
        numerator: { op: "field", field: "a" },
        denominator: { op: "field", field: "b" },
        whenZero: "fallback",
      }).success,
    ).toBe(false);
  });

  it("拒绝 field 缺字段名", () => {
    expect(FormulaExpressionSchema.safeParse({ op: "field" }).success).toBe(false);
  });

  it("拒绝 const 非数值", () => {
    expect(FormulaExpressionSchema.safeParse({ op: "const", value: "x" }).success).toBe(false);
  });

  it("拒绝二元运算缺 right", () => {
    expect(
      FormulaExpressionSchema.safeParse({
        op: "add",
        left: { op: "field", field: "a" },
      }).success,
    ).toBe(false);
  });

  it("validateFormula 返回 ok 与 error 两种结果", () => {
    const ok = validateFormula({ op: "const", value: 1 });
    expect(ok.ok).toBe(true);
    const bad = validateFormula({ op: "bad" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBeTypeOf("string");
  });
});
