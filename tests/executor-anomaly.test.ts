import { describe, it, expect, beforeEach } from "vitest";
import { dispatchTask } from "@/lib/executor/registry";
import { clearTaskCache } from "@/lib/executor/task-cache";
import { makeExecutorContext, makeKpiDataset, makeTask } from "./executor-fixtures";
import type { DatasetRow } from "@/lib/types";

beforeEach(() => clearTaskCache());

function normalRow(v: number): DatasetRow {
  return {
    月份: "2025-01",
    地市: "南宁市",
    业务收入: v,
    目标收入: 100,
    用户数: 1,
    满意度: 0.5,
  };
}

describe("anomaly 操作符 - SPEC 13.5 / 24.5", () => {
  it("IQR 检测极端值（异常占比 <25%）", async () => {
    const baseRows = makeKpiDataset().rows; // 8 行正常（800~1300）
    const ctx = makeExecutorContext({
      dataset: makeKpiDataset({
        rows: [...baseRows, normalRow(50000)],
      }),
    });
    const r = await dispatchTask(
      makeTask({
        operator: "anomaly",
        metrics: ["业务收入"],
        anomalyMethod: "iqr",
      }),
      ctx,
    );
    expect(r.status).toBe("success");
    expect(r.rows.some((x) => x["业务收入"] === 50000)).toBe(true);
    expect(r.evidence[0].method).toBe("outlier");
  });

  it("z-score 检测极端值（n 足够大时 z>3）", async () => {
    // 20 个正常值 + 1 个极端值，单异常 z≈4.36>3
    const normal = Array.from({ length: 20 }, (_, i) => normalRow(100 + i * 5));
    const ctx = makeExecutorContext({
      dataset: makeKpiDataset({
        rows: [...normal, normalRow(100000)],
      }),
    });
    const r = await dispatchTask(
      makeTask({
        operator: "anomaly",
        metrics: ["业务收入"],
        anomalyMethod: "zscore",
      }),
      ctx,
    );
    expect(r.status).toBe("success");
    expect(r.rows.some((x) => x["业务收入"] === 100000)).toBe(true);
    const params = r.evidence[0].parameters as Record<string, unknown>;
    expect(params).toHaveProperty("mean");
    expect(params).toHaveProperty("std");
  });

  it("样本不足（<8）→ warning", async () => {
    const ctx = makeExecutorContext({
      dataset: makeKpiDataset({ rows: makeKpiDataset().rows.slice(0, 5) }),
    });
    const r = await dispatchTask(
      makeTask({ operator: "anomaly", metrics: ["业务收入"] }),
      ctx,
    );
    expect(r.warnings.some((w) => w.includes("不足"))).toBe(true);
  });

  it("limit 截断异常输出数量", async () => {
    // 16 正常 + 4 异常（占比 20% < 25%，IQR 有效，检出 4 > limit 3）
    const normal = Array.from({ length: 16 }, (_, i) => normalRow(100 + i * 5));
    const outliers = Array.from({ length: 4 }, (_, i) => normalRow(9000 + i));
    const ctx = makeExecutorContext({
      dataset: makeKpiDataset({ rows: [...normal, ...outliers] }),
    });
    const r = await dispatchTask(
      makeTask({
        operator: "anomaly",
        metrics: ["业务收入"],
        anomalyMethod: "iqr",
        limit: 3,
      }),
      ctx,
    );
    expect(r.rows.length).toBeLessThanOrEqual(3);
    expect(r.summary.truncated).toBe(true);
  });

  it("evidence 只称统计异常（不称业务错误）", async () => {
    const r = await dispatchTask(
      makeTask({ operator: "anomaly", metrics: ["业务收入"] }),
      makeExecutorContext(),
    );
    expect(r.evidence[0].description).toContain("统计异常");
  });
});
