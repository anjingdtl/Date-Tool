/**
 * tests/dataset-state.test.ts
 *
 * SPEC 12.5 / 18.3：数据集状态机。
 * 直接调用 /api/analyze 的 Route Handler，验证 draft/analyzing 被拒绝(409)、
 * ready 可分析且完成后 completed、error 可重新分析。
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/analyze/route";
import { saveDataset, getDataset } from "@/lib/store";
import { config } from "@/lib/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { StoredDataset } from "@/lib/types";

const DATASETS_DIR = path.join(config.dataDir, "datasets");
const UUID = "44444444-4444-4444-8444-444444444444";

function makeDataset(status: StoredDataset["status"]): StoredDataset {
  const rows = [
    { d: "2026-07-01", 客户: "甲", 金额: 100, 状态: "正常" },
    { d: "2026-07-02", 客户: "乙", 金额: 200, 状态: "正常" },
  ];
  return {
    id: UUID,
    name: "状态机测试",
    fileName: "t.csv",
    source: "csv",
    rowCount: rows.length,
    originalRowCount: rows.length,
    storedRowCount: rows.length,
    columns: [
      { name: "d", type: "date", role: "time", format: "date", sampleValues: [], defaultAggregation: "count", includeInAnalysis: true },
      { name: "客户", type: "string", role: "dimension", format: "plain", sampleValues: [], defaultAggregation: "count", includeInAnalysis: true },
      { name: "金额", type: "number", role: "metric", format: "currency", sampleValues: [], defaultAggregation: "sum", includeInAnalysis: true },
      { name: "状态", type: "string", role: "status", format: "plain", sampleValues: [], defaultAggregation: "count", includeInAnalysis: true },
    ],
    rows,
    createdAt: new Date().toISOString(),
    quality: {
      originalRowCount: rows.length,
      storedRowCount: rows.length,
      columnCount: 4,
      duplicateRowCount: 0,
      emptyRowCount: 0,
      warnings: [],
      generatedAt: new Date().toISOString(),
    },
    status,
    analysis: null,
  };
}

function analyzeReq(id: string): NextRequest {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datasetId: id }),
  });
}

async function readSSEEvents(res: Response): Promise<string[]> {
  const events: string[] = [];
  if (!res.body) return events;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let curEvent = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        curEvent = line.slice(6).trim();
      } else if (line.trim() === "" && curEvent) {
        events.push(curEvent);
        curEvent = "";
      }
    }
  }
  return events;
}

beforeEach(async () => {
  await fs.rm(DATASETS_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(DATASETS_DIR, { recursive: true });
});

describe("analyze 状态机 - SPEC 12.5", () => {
  it("draft 分析被拒绝(409)", async () => {
    await saveDataset(makeDataset("draft"));
    const res = await POST(analyzeReq(UUID));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.detail).toContain("预检确认");
  });

  it("analyzing 重复请求被拒绝(409)", async () => {
    await saveDataset(makeDataset("analyzing"));
    const res = await POST(analyzeReq(UUID));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.detail).toContain("重复提交");
  });

  it("ready 可分析，SSE 含 final 与 done，状态变 completed", async () => {
    await saveDataset(makeDataset("ready"));
    const res = await POST(analyzeReq(UUID));
    expect(res.status).toBe(200);
    const events = await readSSEEvents(res);
    expect(events).toContain("result");
    expect(events).toContain("final");
    expect(events).toContain("done");
    const ds = await getDataset(UUID);
    expect(ds?.status).toBe("completed");
  });

  it("error 可重新分析并变 completed", async () => {
    await saveDataset(makeDataset("error"));
    const res = await POST(analyzeReq(UUID));
    expect(res.status).toBe(200);
    await readSSEEvents(res);
    const ds = await getDataset(UUID);
    expect(ds?.status).toBe("completed");
  });

  it("completed 可重新分析", async () => {
    await saveDataset(makeDataset("completed"));
    const res = await POST(analyzeReq(UUID));
    expect(res.status).toBe(200);
    await readSSEEvents(res);
    const ds = await getDataset(UUID);
    expect(ds?.status).toBe("completed");
  });

  it("不存在或非 UUID 返回 4xx", async () => {
    const resMissing = await POST(analyzeReq(UUID));
    expect(resMissing.status).toBe(404);
    const resBad = await POST(
      new NextRequest("http://localhost/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId: "not-a-uuid" }),
      }),
    );
    expect(resBad.status).toBe(400);
  });
});
