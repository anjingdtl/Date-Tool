import { beforeEach, describe, expect, it } from "vitest";
import { dispatchTask } from "@/lib/executor/registry";
import { clearTaskCache } from "@/lib/executor/task-cache";
import { makeExecutorContext, makeTask } from "./executor-fixtures";

beforeEach(() => clearTaskCache());

describe("基础操作符独立回归 - SPEC 13.5 / Phase 5", () => {
  it("profile 输出字段画像与 Evidence", async () => {
    const result = await dispatchTask(
      makeTask({ operator: "profile", metrics: ["业务收入"] }),
      makeExecutorContext(),
    );

    expect(result.status).toBe("success");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      field: "业务收入",
      type: "number",
      count: 8,
      min: 800,
      max: 1300,
    });
    expect(result.evidence[0]).toMatchObject({ operator: "profile", taskId: "t1" });
  });

  it("compare 计算目标完成率并生成 Evidence", async () => {
    const result = await dispatchTask(
      makeTask({
        operator: "compare",
        dimensions: ["地市"],
        metrics: ["业务收入", "目标收入"],
        aggregation: "sum",
        compareMode: "rate",
      }),
      makeExecutorContext(),
    );

    expect(result.status).toBe("success");
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((row) => row.地市 === "南宁")).toMatchObject({
      业务收入: 4600,
      目标收入: 4800,
      业务收入_比_目标收入: 4600 / 4800,
    });
    expect(result.evidence[0].method).toBe("group_compare");
  });

  it("distribution 支持分类分布", async () => {
    const result = await dispatchTask(
      makeTask({ operator: "distribution", dimensions: ["地市"] }),
      makeExecutorContext(),
    );

    expect(result.status).toBe("success");
    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ 地市: "南宁", count: 4, rate: 0.5 }),
        expect.objectContaining({ 地市: "柳州", count: 4, rate: 0.5 }),
      ]),
    );
    expect(result.evidence[0].method).toBe("distribution");
  });

  it("distribution 支持数值等宽分箱", async () => {
    const result = await dispatchTask(
      makeTask({ operator: "distribution", dimensions: ["业务收入"], limit: 4 }),
      makeExecutorContext(),
    );

    expect(result.status).toBe("success");
    expect(result.rows).toHaveLength(4);
    expect(result.rows.reduce((sum, row) => sum + Number(row.count), 0)).toBe(8);
    expect(result.rows.reduce((sum, row) => sum + Number(row.rate), 0)).toBeCloseTo(1);
    expect(result.evidence[0].parameters).toMatchObject({ binCount: 4, min: 800, max: 1300 });
  });

  it("ranking 要求明确聚合与排序，并支持 Top/Bottom", async () => {
    const invalid = await dispatchTask(
      makeTask({ operator: "ranking", dimensions: ["地市"], metrics: ["业务收入"] }),
      makeExecutorContext(),
    );
    expect(invalid.status).toBe("failed");

    const top = await dispatchTask(
      makeTask({
        id: "rank_top",
        operator: "ranking",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "sum",
        sort: { field: "业务收入", direction: "desc" },
        limit: 1,
      }),
      makeExecutorContext(),
    );
    expect(top.status).toBe("success");
    expect(top.rows[0]).toMatchObject({ rank: 1, 地市: "南宁", 业务收入: 4600 });

    clearTaskCache();
    const bottom = await dispatchTask(
      makeTask({
        id: "rank_bottom",
        operator: "ranking",
        dimensions: ["地市"],
        metrics: ["业务收入"],
        aggregation: "sum",
        sort: { field: "业务收入", direction: "asc" },
        limit: 1,
      }),
      makeExecutorContext(),
    );
    expect(bottom.rows[0]).toMatchObject({ rank: 1, 地市: "柳州", 业务收入: 3630 });
    expect(bottom.evidence[0].method).toBe("ranking");
  });
});
