import { z } from "zod";
import type { FormulaExpression } from "@/lib/types";

/**
 * 安全公式表达式 Schema（SPEC 11.2）。
 *
 * 递归 AST，结构上禁止字符串动态执行；最大深度 8、节点 40 等额外限制
 * 由 formula-engine 在执行前校验，schema 只保证结构合法与除零策略存在。
 *
 * 每个 op 单独成项以满足 z.discriminatedUnion 的 discriminator 唯一要求。
 */
export const FormulaExpressionSchema: z.ZodType<FormulaExpression> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("field"), field: z.string().min(1) }),
    z.object({ op: z.literal("const"), value: z.number() }),
    z.object({
      op: z.literal("add"),
      left: FormulaExpressionSchema,
      right: FormulaExpressionSchema,
    }),
    z.object({
      op: z.literal("subtract"),
      left: FormulaExpressionSchema,
      right: FormulaExpressionSchema,
    }),
    z.object({
      op: z.literal("multiply"),
      left: FormulaExpressionSchema,
      right: FormulaExpressionSchema,
    }),
    z.object({
      op: z.literal("divide"),
      left: FormulaExpressionSchema,
      right: FormulaExpressionSchema,
    }),
    z.object({
      op: z.literal("safe_divide"),
      numerator: FormulaExpressionSchema,
      denominator: FormulaExpressionSchema,
      whenZero: z.enum(["null", "zero"]),
    }),
    z.object({
      op: z.literal("abs"),
      value: FormulaExpressionSchema,
      digits: z.number().int().min(0).max(10).optional(),
    }),
    z.object({
      op: z.literal("round"),
      value: FormulaExpressionSchema,
      digits: z.number().int().min(0).max(10).optional(),
    }),
  ]),
);

export type FormulaExpressionParsed = z.infer<typeof FormulaExpressionSchema>;

/** 校验公式 AST 结构 */
export function validateFormula(
  raw: unknown,
): { ok: true; expr: FormulaExpressionParsed } | { ok: false; error: string } {
  const r = FormulaExpressionSchema.safeParse(raw);
  if (r.success) return { ok: true, expr: r.data };
  return { ok: false, error: r.error.issues.map((i) => i.message).join("; ") };
}
