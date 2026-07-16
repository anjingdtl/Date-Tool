import { describe, it, expect, beforeEach } from "vitest";
import { dispatchTask } from "@/lib/executor/registry";
import { clearTaskCache } from "@/lib/executor/task-cache";
import { makeExecutorContext, makeTask } from "./executor-fixtures";

beforeEach(() => clearTaskCache());

describe("timeseries 操作符 - SPEC 13.5 / 24.5", () => {
  it("month 分桶 flow→sum（业务收入）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "timeseries",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("success");
    expect(r.rows.length).toBe(4);
    const jan = r.rows.find((x) => x["月份"] === "2025-01");
    expect(jan!["业务收入"]).toBe(1800); // 1000+800
  });

  it("stock→last（用户数，SPEC 13.5 默认行为）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "timeseries",
        metrics: ["用户数"],
        time: { field: "月份", grain: "month" },
      }),
      makeExecutorContext(),
    );
    const jan = r.rows.find((x) => x["月份"] === "2025-01");
    // 2025-01 桶 vals=[100,80]，last=80
    expect(jan!["用户数"]).toBe(80);
  });

  it("rate→avg（满意度）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "timeseries",
        metrics: ["满意度"],
        time: { field: "月份", grain: "month" },
      }),
      makeExecutorContext(),
    );
    const jan = r.rows.find((x) => x["月份"] === "2025-01");
    expect(jan!["满意度"]).toBeCloseTo(0.875); // (0.9+0.85)/2
  });

  it("day 分桶（8 个不同日？月份只有 4 个，按 month 一致）", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "timeseries",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "year" },
      }),
      makeExecutorContext(),
    );
    expect(r.rows.length).toBe(1); // 全部 2025
    expect(r.rows[0]["业务收入"]).toBe(8230); // 全量求和
  });

  it("时间桶升序排序", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "timeseries",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
      }),
      makeExecutorContext(),
    );
    const labels = r.rows.map((x) => x["月份"]);
    expect(labels).toEqual([...labels].sort());
  });

  it("filter 后重新分桶", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "timeseries",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
        filters: [{ field: "地市", operator: "eq", value: "南宁" }],
      }),
      makeExecutorContext(),
    );
    const jan = r.rows.find((x) => x["月份"] === "2025-01");
    expect(jan!["业务收入"]).toBe(1000); // 仅南宁
  });

  it("缺时间字段 validate 失败", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "timeseries",
        metrics: ["业务收入"],
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("failed");
  });

  it("evidence method = trend", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "timeseries",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
      }),
      makeExecutorContext(),
    );
    expect(r.evidence[0].method).toBe("trend");
  });
});
