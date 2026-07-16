import { describe, it, expect, beforeEach } from "vitest";
import { dispatchTask, validateTask } from "@/lib/executor/registry";
import { clearTaskCache } from "@/lib/executor/task-cache";
import { makeExecutorContext, makeKpiDataset, makeTask } from "./executor-fixtures";
import type { FormulaExpression } from "@/lib/types";

beforeEach(() => clearTaskCache());

function completionFormula(): FormulaExpression {
  return {
    op: "safe_divide",
    numerator: { op: "field", field: "业务收入" },
    denominator: { op: "field", field: "目标收入" },
    whenZero: "null",
  };
}

describe("ratio 操作符 - SPEC 13.5 / 24.5", () => {
  it("正常完成率（逐行 + scalar 均值）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "ratio",
        metrics: ["业务收入", "目标收入"],
        formula: { outputField: "完成率", expression: completionFormula() },
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("success");
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[0]["完成率"]).toBeCloseTo(1000 / 1200);
    expect(typeof r.scalar).toBe("number");
    expect(r.scalar as number).toBeGreaterThan(0);
  });

  it("分母为 0 返回 null + warning（SPEC 13.5 除零策略）", async () => {
    const baseRows = makeKpiDataset().rows;
    const ctx = makeExecutorContext({
      dataset: makeKpiDataset({
        rows: [
          ...baseRows,
          {
            月份: "2025-05",
            地市: "南宁",
            业务收入: 1000,
            目标收入: 0,
            用户数: 100,
            满意度: 0.9,
          },
        ],
      }),
    });
    const r = await dispatchTask(
      makeTask({
        operator: "ratio",
        metrics: ["业务收入", "目标收入"],
        formula: { outputField: "完成率", expression: completionFormula() },
      }),
      ctx,
    );
    expect(r.warnings.some((w) => w.includes("空值"))).toBe(true);
    // 含 0 目标的行完成率为 null，被过滤出 rows
    expect(r.rows.every((row) => row["完成率"] !== null)).toBe(true);
  });

  it("有维度按地市分组取完成率均值", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "ratio",
        dimensions: ["地市"],
        metrics: ["业务收入", "目标收入"],
        formula: { outputField: "完成率", expression: completionFormula() },
      }),
      makeExecutorContext(),
    );
    expect(r.rows.length).toBe(2);
    const nn = r.rows.find((x) => x["地市"] === "南宁");
    expect(nn!["完成率"]).toBeCloseTo(4600 / 4800);
  });

  it("嵌套公式 (收入-目标)/目标", async () => {
    const expr: FormulaExpression = {
      op: "safe_divide",
      numerator: {
        op: "subtract",
        left: { op: "field", field: "业务收入" },
        right: { op: "field", field: "目标收入" },
      },
      denominator: { op: "field", field: "目标收入" },
      whenZero: "null",
    };
    const r = await dispatchTask(
      makeTask({
        operator: "ratio",
        metrics: ["业务收入", "目标收入"],
        formula: { outputField: "缺口率", expression: expr },
      }),
      makeExecutorContext(),
    );
    expect(r.rows[0]["缺口率"]).toBeCloseTo((1000 - 1200) / 1200);
  });

  it("AST 深度超限 validate 失败", () => {
    let expr: FormulaExpression = { op: "field", field: "业务收入" };
    for (let i = 0; i < 9; i++) expr = { op: "abs", value: expr };
    const ok = validateTask(
      makeTask({
        operator: "ratio",
        metrics: ["业务收入"],
        formula: { outputField: "x", expression: expr },
      }),
      makeExecutorContext(),
    ).ok;
    expect(ok).toBe(false);
  });

  it("evidence method = ratio", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "ratio",
        metrics: ["业务收入", "目标收入"],
        formula: { outputField: "完成率", expression: completionFormula() },
      }),
      makeExecutorContext(),
    );
    expect(r.evidence[0].method).toBe("ratio");
  });
});
