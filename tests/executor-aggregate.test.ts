import { describe, it, expect, beforeEach } from "vitest";
import { dispatchTask } from "@/lib/executor/registry";
import { clearTaskCache } from "@/lib/executor/task-cache";
import { validateTask } from "@/lib/executor/registry";
import { makeExecutorContext, makeTask } from "./executor-fixtures";

beforeEach(() => clearTaskCache());

describe("aggregate 操作符 - SPEC 13.5 / 24.5", () => {
  it("sum 按地市分组", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "sum",
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("success");
    const nn = r.rows.find((x) => x["地市"] === "南宁");
    const lz = r.rows.find((x) => x["地市"] === "柳州");
    expect(nn!["业务收入"]).toBe(4600); // 1000+1100+1200+1300
    expect(lz!["业务收入"]).toBe(3630); // 800+900+950+980
  });

  it("avg", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "avg",
      }),
      makeExecutorContext(),
    );
    const nn = r.rows.find((x) => x["地市"] === "南宁");
    expect(nn!["业务收入"]).toBe(1150); // 4600/4
  });

  it("median", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "median",
      }),
      makeExecutorContext(),
    );
    const nn = r.rows.find((x) => x["地市"] === "南宁");
    // [1000,1100,1200,1300] → 中位 (1100+1200)/2
    expect(nn!["业务收入"]).toBe(1150);
  });

  it("last", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "last",
      }),
      makeExecutorContext(),
    );
    const nn = r.rows.find((x) => x["地市"] === "南宁");
    expect(nn!["业务收入"]).toBe(1300);
  });

  it("min/max/count", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "max",
      }),
      makeExecutorContext(),
    );
    const nn = r.rows.find((x) => x["地市"] === "南宁");
    expect(nn!["业务收入"]).toBe(1300);
  });

  it("多维度（地市 + 月份）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市", "月份"],
        metrics: ["业务收入"],
        aggregation: "sum",
      }),
      makeExecutorContext(),
    );
    // 2 地市 × 4 月 = 8 组
    expect(r.rows.length).toBe(8);
  });

  it("filters（地市=南宁）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["月份"],
        metrics: ["业务收入"],
        aggregation: "sum",
        filters: [{ field: "地市", operator: "eq", value: "南宁" }],
      }),
      makeExecutorContext(),
    );
    expect(r.rows.length).toBe(4);
    for (const row of r.rows) {
      expect(row["业务收入"]).toBeGreaterThanOrEqual(1000);
    }
  });

  it("sort + limit", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "sum",
        sort: { field: "业务收入", direction: "desc" },
        limit: 1,
      }),
      makeExecutorContext(),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]["地市"]).toBe("南宁"); // 4600 > 3630
  });

  it("空值跳过（不报错）", async () => {
    const ctx = makeExecutorContext({
      dataset: {
        ...makeExecutorContext().dataset,
        rows: [
          { 地市: "南宁", 业务收入: 100 },
          { 地市: "南宁", 业务收入: null },
          { 地市: "南宁", 业务收入: "" },
          { 地市: "南宁", 业务收入: 300 },
        ],
      },
    });
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "sum",
      }),
      ctx,
    );
    const nn = r.rows.find((x) => x["地市"] === "南宁");
    expect(nn!["业务收入"]).toBe(400);
  });

  it("非法字段 → validate 失败", () => {
    expect(
      validateTask(
        makeTask({ operator: "aggregate", metrics: ["不存在"] }),
        makeExecutorContext(),
      ).ok,
    ).toBe(false);
  });

  it("evidence method = aggregate", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
      }),
      makeExecutorContext(),
    );
    expect(r.evidence[0].method).toBe("aggregate");
    expect(r.evidence[0].operator).toBe("aggregate");
  });
});
