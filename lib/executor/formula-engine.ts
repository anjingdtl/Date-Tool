/**
 * lib/executor/formula-engine.ts
 *
 * 安全公式引擎（SPEC 11）。结构化 AST 求值，禁止字符串动态执行。
 *
 * - validateFormulaAST：深度（≤8）、节点数（≤40）、字段必须存在；
 * - evalFormula：在一行数据上求值，缺失值与除零返回 null（不抛错）。
 */
import type { FormulaExpression } from "@/lib/types";

export const MAX_FORMULA_DEPTH = 8;
export const MAX_FORMULA_NODES = 40;

export interface FormulaIssue {
  code: string;
  message: string;
}

interface AstMeasure {
  depth: number;
  nodes: number;
}

function measure(expr: FormulaExpression, depth: number, acc: AstMeasure): void {
  acc.nodes++;
  if (depth > acc.depth) acc.depth = depth;
  switch (expr.op) {
    case "field":
    case "const":
      return;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      measure(expr.left, depth + 1, acc);
      measure(expr.right, depth + 1, acc);
      return;
    case "safe_divide":
      measure(expr.numerator, depth + 1, acc);
      measure(expr.denominator, depth + 1, acc);
      return;
    case "abs":
    case "round":
      measure(expr.value, depth + 1, acc);
      return;
  }
}

function collectFields(expr: FormulaExpression, set: Set<string>): void {
  switch (expr.op) {
    case "field":
      set.add(expr.field);
      return;
    case "const":
      return;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      collectFields(expr.left, set);
      collectFields(expr.right, set);
      return;
    case "safe_divide":
      collectFields(expr.numerator, set);
      collectFields(expr.denominator, set);
      return;
    case "abs":
    case "round":
      collectFields(expr.value, set);
      return;
  }
}

/** 校验公式 AST：深度、节点数、字段存在性 */
export function validateFormulaAST(
  expr: FormulaExpression,
  availableFields: Set<string>,
): { ok: boolean; issues: FormulaIssue[] } {
  const issues: FormulaIssue[] = [];
  const acc: AstMeasure = { depth: 0, nodes: 0 };
  measure(expr, 1, acc);
  if (acc.depth > MAX_FORMULA_DEPTH) {
    issues.push({
      code: "FORMULA_TOO_DEEP",
      message: `公式深度 ${acc.depth} 超过上限 ${MAX_FORMULA_DEPTH}`,
    });
  }
  if (acc.nodes > MAX_FORMULA_NODES) {
    issues.push({
      code: "FORMULA_TOO_MANY_NODES",
      message: `公式节点数 ${acc.nodes} 超过上限 ${MAX_FORMULA_NODES}`,
    });
  }
  const fields = new Set<string>();
  collectFields(expr, fields);
  for (const f of fields) {
    if (!availableFields.has(f)) {
      issues.push({
        code: "FORMULA_UNKNOWN_FIELD",
        message: `公式引用了未知字段「${f}」`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * 在一行数据上求值公式。
 *
 * @returns 数值；缺失值或除零（且策略为 null）时返回 null，不抛错。
 */
export function evalFormula(
  expr: FormulaExpression,
  row: Record<string, unknown>,
): number | null {
  switch (expr.op) {
    case "field": {
      const v = row[expr.field];
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "const":
      return expr.value;
    case "add":
    case "subtract":
    case "multiply":
    case "divide": {
      const l = evalFormula(expr.left, row);
      const r = evalFormula(expr.right, row);
      if (l === null || r === null) return null;
      switch (expr.op) {
        case "add":
          return l + r;
        case "subtract":
          return l - r;
        case "multiply":
          return l * r;
        case "divide":
          // 普通除法除零 → null（安全）
          return r === 0 ? null : l / r;
      }
      return null;
    }
    case "safe_divide": {
      const n = evalFormula(expr.numerator, row);
      const d = evalFormula(expr.denominator, row);
      if (n === null || d === null) return null;
      if (d === 0) return expr.whenZero === "zero" ? 0 : null;
      return n / d;
    }
    case "abs": {
      const v = evalFormula(expr.value, row);
      return v === null ? null : Math.abs(v);
    }
    case "round": {
      const v = evalFormula(expr.value, row);
      if (v === null) return null;
      const digits = expr.digits ?? 0;
      const f = Math.pow(10, digits);
      return Math.round(v * f) / f;
    }
  }
}
