import { describe, it, expect, beforeEach } from "vitest";
import { dispatchTask } from "@/lib/executor/registry";
import { clearTaskCache } from "@/lib/executor/task-cache";
import { makeExecutorContext, makeTask } from "./executor-fixtures";

beforeEach(() => clearTaskCache());

describe("pivot 操作符 - SPEC 13.5 / 24.5", () => {
  it("正常透视：地市(行) × 月份(列) → 业务收入", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "pivot",
        dimensions: ["地市", "月份"],
        metrics: ["业务收入"],
        aggregation: "sum",
        expectedOutput: "matrix",
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("success");
    // 2 个地市行
    expect(r.rows.length).toBe(2);
    const nn = r.rows.find((x) => x["地市"] === "南宁");
    expect(nn).toBeTruthy();
    // 列展开：业务收入[2025-01] 等
    const cols = r.columns.map((c) => c.name);
    expect(cols).toContain("业务收入[2025-01]");
    expect(cols).toContain("业务收入[2025-04]");
    // 南宁 2025-01 = 1000（单值 sum）
    expect(nn!["业务收入[2025-01]"]).toBe(1000);
    expect(r.evidence[0].method).toBe("pivot");
  });

  it("多指标透视", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "pivot",
        dimensions: ["地市", "月份"],
        metrics: ["业务收入", "用户数"],
        aggregation: "sum",
        expectedOutput: "matrix",
      }),
      makeExecutorContext(),
    );
    const cols = r.columns.map((c) => c.name);
    expect(cols.some((c) => c.startsWith("业务收入["))).toBe(true);
    expect(cols.some((c) => c.startsWith("用户数["))).toBe(true);
  });

  it("维度不足 → failed", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "pivot",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        expectedOutput: "matrix",
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("failed");
  });
});
