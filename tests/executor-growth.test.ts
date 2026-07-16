import { describe, it, expect, beforeEach } from "vitest";
import { dispatchTask } from "@/lib/executor/registry";
import { clearTaskCache } from "@/lib/executor/task-cache";
import { makeExecutorContext, makeTask } from "./executor-fixtures";

beforeEach(() => clearTaskCache());

describe("growth 操作符 - SPEC 13.5 / 24.5", () => {
  // 业务收入按月 sum：01=1800, 02=2000, 03=2150, 04=2280
  it("month 环比 rate", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "growth",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
        compareMode: "rate",
      }),
      makeExecutorContext(),
    );
    expect(r.status).toBe("success");
    expect(r.rows.length).toBe(4);
    const feb = r.rows.find((x) => x["月份"] === "2025-02");
    expect(feb!["change"]).toBe(200); // 2000-1800
    expect(feb!["growthRate"]).toBeCloseTo(200 / 1800);
  });

  it("首期 change/growthRate 为 null", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "growth",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
        compareMode: "rate",
      }),
      makeExecutorContext(),
    );
    expect(r.rows[0]["change"]).toBeNull();
    expect(r.rows[0]["growthRate"]).toBeNull();
  });

  it("difference 模式只给绝对差", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "growth",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
        compareMode: "difference",
      }),
      makeExecutorContext(),
    );
    const feb = r.rows.find((x) => x["月份"] === "2025-02");
    expect(feb!["change"]).toBe(200);
    expect(feb!["growthRate"]).toBeNull();
  });

  it("分母为 0：growthRate null + warning", async () => {
    // 构造一个首期为 0 的序列
    const ctx = makeExecutorContext({
      dataset: {
        ...makeExecutorContext().dataset,
        rows: [
          { 月份: "2025-01", 地市: "南宁", 业务收入: 0, 目标收入: 100, 用户数: 1, 满意度: 0.5 },
          { 月份: "2025-02", 地市: "南宁", 业务收入: 500, 目标收入: 100, 用户数: 2, 满意度: 0.6 },
        ],
      },
    });
    const r = await dispatchTask(
      makeTask({
        operator: "growth",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
        compareMode: "rate",
      }),
      ctx,
    );
    const feb = r.rows.find((x) => x["月份"] === "2025-02");
    expect(feb!["growthRate"]).toBeNull();
    expect(r.warnings.some((w) => w.includes("0"))).toBe(true);
  });

  it("evidence method = growth", async () => {
    const r = await dispatchTask(
      makeTask({
        operator: "growth",
        metrics: ["业务收入"],
        time: { field: "月份", grain: "month" },
      }),
      makeExecutorContext(),
    );
    expect(r.evidence[0].method).toBe("growth");
  });
});
