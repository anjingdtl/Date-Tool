import { describe, it, expect, beforeEach } from "vitest";
import { dispatchTask } from "@/lib/executor/registry";
import { clearTaskCache } from "@/lib/executor/task-cache";
import { makeExecutorContext, makeKpiDataset, makeTask } from "./executor-fixtures";

beforeEach(() => clearTaskCache());

describe("correlation 操作符 - SPEC 13.5 / 24.5", () => {
  it("正常 Pearson（业务收入 vs 目标收入）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "correlation",
        metrics: ["业务收入", "目标收入"],
        dimensions: [],
        expectedOutput: "scalar",
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("success");
    expect(r.scalar).not.toBeNull();
    expect(r.evidence[0].method).toBe("correlation");
  });

  it("有效成对样本 <8 → warning 且不可靠", async () => {
    const ctx = makeExecutorContext({
      dataset: makeKpiDataset({ rows: makeKpiDataset().rows.slice(0, 5) }),
    });
    const r = await dispatchTask(
      makeTask({
        operator: "correlation",
        metrics: ["业务收入", "目标收入"],
        dimensions: [],
        expectedOutput: "scalar",
      }),
      ctx,
    );
    expect(r.warnings.some((w) => w.includes("不足"))).toBe(true);
  });

  it("常量列 → pearson null + warning", async () => {
    const ctx = makeExecutorContext({
      dataset: makeKpiDataset({
        rows: makeKpiDataset().rows.map((r) => ({ ...r, 目标收入: 1000 })),
      }),
    });
    const r = await dispatchTask(
      makeTask({
        operator: "correlation",
        metrics: ["业务收入", "目标收入"],
        dimensions: [],
        expectedOutput: "scalar",
      }),
      ctx,
    );
    expect(r.scalar).toBeNull();
    expect(r.warnings.some((w) => w.includes("常量列"))).toBe(true);
  });

  it("不输出因果结论（warning 注明）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "correlation",
        metrics: ["业务收入", "目标收入"],
        dimensions: [],
        expectedOutput: "scalar",
      }),
      makeExecutorContext(),
    );
    expect(r.warnings.some((w) => w.includes("因果"))).toBe(true);
    expect(r.evidence[0].description).toContain("因果");
  });

  it("指标不足 → failed", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "correlation",
        metrics: ["业务收入"],
        dimensions: [],
        expectedOutput: "scalar",
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("failed");
  });
});
