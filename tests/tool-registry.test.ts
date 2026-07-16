import { describe, it, expect, beforeEach } from "vitest";
import {
  dispatchTask,
  getTool,
  listOperators,
  validateTask,
} from "@/lib/executor/registry";
import { clearTaskCache, taskCacheSize } from "@/lib/executor/task-cache";
import { makeExecutorContext, makeTask } from "./executor-fixtures";
import type { AnalysisOperator } from "@/lib/types";

beforeEach(() => clearTaskCache());

describe("registry - SPEC 13.2 / 14.3", () => {
  it("已注册 P0 操作符", () => {
    const ops = listOperators();
    const expected = [
      "profile",
      "aggregate",
      "timeseries",
      "compare",
      "distribution",
      "ranking",
      "ratio",
      "growth",
      "anomaly",
    ];
    for (const op of expected) {
      expect(ops).toContain(op);
      expect(getTool(op as AnalysisOperator)).not.toBeNull();
    }
  });

  it("未知操作符 → failed（不抛错）", async () => {
    const ctx = makeExecutorContext();
    const r = await dispatchTask(
      makeTask({ operator: "nonexistent" as AnalysisOperator }),
      ctx,
    );
    expect(r.status).toBe("failed");
    expect(r.warnings[0]).toContain("未知操作符");
  });

  it("校验失败（缺字段）→ failed", async () => {
    const ctx = makeExecutorContext();
    const r = await dispatchTask(
      makeTask({ operator: "aggregate", metrics: ["不存在字段"] }),
      ctx,
    );
    expect(r.status).toBe("failed");
    expect(r.warnings[0]).toContain("校验失败");
  });

  it("缓存命中：相同任务第二次复用结果", async () => {
    const ctx = makeExecutorContext();
    const task = makeTask({
      operator: "aggregate",
      dimensions: ["地市"],
      metrics: ["业务收入"],
      aggregation: "sum",
    });
    const r1 = await dispatchTask(task, ctx);
    expect(r1.status).toBe("success");
    expect(taskCacheSize()).toBe(1);
    const r2 = await dispatchTask(task, ctx);
    expect(r2.resultHash).toBe(r1.resultHash);
    expect(taskCacheSize()).toBe(1); // 命中，未新增
  });

  it("结果含 evidence 与 inputHash", async () => {
    const ctx = makeExecutorContext();
    const r = await dispatchTask(
      makeTask({
        operator: "aggregate",
        dimensions: ["地市"],
        metrics: ["业务收入"],
      }),
      ctx,
    );
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.inputHash).toBeTruthy();
    expect(r.evidence[0].inputHash).toBe(r.inputHash);
    expect(r.evidence[0].taskId).toBe("t1");
    expect(r.evidence[0].resultHash).toBe(r.resultHash);
  });

  it("validateTask 暴露预检", () => {
    const ctx = makeExecutorContext();
    expect(
      validateTask(
        makeTask({
          operator: "aggregate",
          metrics: ["业务收入"],
          dimensions: [],
        }),
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      validateTask(makeTask({ operator: "aggregate", metrics: ["x"] }), ctx).ok,
    ).toBe(false);
  });
});
