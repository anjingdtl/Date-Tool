import { describe, it, expect } from "vitest";
import {
  evalFormula,
  validateFormulaAST,
} from "@/lib/executor/formula-engine";
import type { FormulaExpression } from "@/lib/types";

function binop(
  op: "add" | "subtract" | "multiply" | "divide",
): FormulaExpression {
  return {
    op,
    left: { op: "field", field: "a" },
    right: { op: "field", field: "b" },
  };
}

describe("evalFormula - SPEC 11", () => {
  it("field 引用（含字符串数字、缺失）", () => {
    expect(evalFormula({ op: "field", field: "a" }, { a: 5 })).toBe(5);
    expect(evalFormula({ op: "field", field: "a" }, { a: "5" })).toBe(5);
    expect(evalFormula({ op: "field", field: "a" }, { a: null })).toBeNull();
    expect(evalFormula({ op: "field", field: "a" }, {})).toBeNull();
    expect(evalFormula({ op: "field", field: "a" }, { a: "" })).toBeNull();
  });

  it("const", () => {
    expect(evalFormula({ op: "const", value: 42 }, {})).toBe(42);
  });

  it("算术 add/subtract/multiply/divide", () => {
    expect(evalFormula(binop("add"), { a: 3, b: 4 })).toBe(7);
    expect(evalFormula(binop("subtract"), { a: 10, b: 4 })).toBe(6);
    expect(evalFormula(binop("multiply"), { a: 3, b: 4 })).toBe(12);
    expect(evalFormula(binop("divide"), { a: 12, b: 4 })).toBe(3);
  });

  it("普通 divide 除零返回 null", () => {
    expect(evalFormula(binop("divide"), { a: 5, b: 0 })).toBeNull();
  });

  it("safe_divide whenZero=null：分母 0 返回 null", () => {
    const expr: FormulaExpression = {
      op: "safe_divide",
      numerator: { op: "field", field: "a" },
      denominator: { op: "field", field: "b" },
      whenZero: "null",
    };
    expect(evalFormula(expr, { a: 5, b: 0 })).toBeNull();
  });

  it("safe_divide whenZero=zero：分母 0 返回 0", () => {
    const expr: FormulaExpression = {
      op: "safe_divide",
      numerator: { op: "field", field: "a" },
      denominator: { op: "field", field: "b" },
      whenZero: "zero",
    };
    expect(evalFormula(expr, { a: 5, b: 0 })).toBe(0);
  });

  it("safe_divide 正常求值", () => {
    const expr: FormulaExpression = {
      op: "safe_divide",
      numerator: { op: "field", field: "a" },
      denominator: { op: "field", field: "b" },
      whenZero: "null",
    };
    expect(evalFormula(expr, { a: 6, b: 3 })).toBe(2);
  });

  it("abs / round（含 digits）", () => {
    expect(
      evalFormula({ op: "abs", value: { op: "field", field: "a" } }, { a: -5 }),
    ).toBe(5);
    expect(
      evalFormula(
        { op: "round", value: { op: "field", field: "a" }, digits: 2 },
        { a: 3.14159 },
      ),
    ).toBe(3.14);
  });

  it("嵌套公式 (a-b)/b", () => {
    const expr: FormulaExpression = {
      op: "safe_divide",
      numerator: {
        op: "subtract",
        left: { op: "field", field: "a" },
        right: { op: "field", field: "b" },
      },
      denominator: { op: "field", field: "b" },
      whenZero: "null",
    };
    expect(evalFormula(expr, { a: 8, b: 4 })).toBe(1);
  });

  it("缺失字段传播 null（不抛错）", () => {
    expect(evalFormula(binop("add"), { a: 5 })).toBeNull();
  });
});

describe("validateFormulaAST - SPEC 11.2 限制", () => {
  const fields = new Set(["a", "b"]);

  it("合法公式通过", () => {
    const expr: FormulaExpression = {
      op: "safe_divide",
      numerator: { op: "field", field: "a" },
      denominator: { op: "field", field: "b" },
      whenZero: "null",
    };
    expect(validateFormulaAST(expr, fields).ok).toBe(true);
  });

  it("未知字段失败", () => {
    const r = validateFormulaAST({ op: "field", field: "c" }, fields);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "FORMULA_UNKNOWN_FIELD")).toBe(true);
  });

  it("深度超限失败（>8）", () => {
    let expr: FormulaExpression = { op: "field", field: "a" };
    for (let i = 0; i < 9; i++) expr = { op: "abs", value: expr };
    const r = validateFormulaAST(expr, fields);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "FORMULA_TOO_DEEP")).toBe(true);
  });

  it("节点超限失败（>40）", () => {
    let expr: FormulaExpression = { op: "const", value: 1 };
    for (let i = 0; i < 41; i++)
      expr = { op: "add", left: expr, right: { op: "const", value: 1 } };
    const r = validateFormulaAST(expr, fields);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "FORMULA_TOO_MANY_NODES")).toBe(true);
  });
});
