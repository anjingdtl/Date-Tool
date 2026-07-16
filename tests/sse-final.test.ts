/**
 * tests/sse-final.test.ts
 *
 * SPEC 9.6 / 18.3：final 事件（v0.3 门面）。
 * - 本地降级：result 先于 final，provider=local；
 * - LLM 编排（mock runAnalysisSession）：final provider=local+llm。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: false,
  understanding: null as unknown,
  orchResult: null as unknown,
}));

vi.mock("@/lib/llm-config", () => ({ getActiveLLMConfig: vi.fn() }));
vi.mock("@/lib/store", () => ({ getUnderstanding: vi.fn() }));
vi.mock("@/lib/orchestrator/run-analysis-session", () => ({
  runAnalysisSession: vi.fn(),
}));

import { analyzeDataset } from "@/lib/analyzer";
import { getActiveLLMConfig } from "@/lib/llm-config";
import { getUnderstanding } from "@/lib/store";
import { runAnalysisSession } from "@/lib/orchestrator/run-analysis-session";
import type { ColumnMeta, DatasetRow, FinalAnalysisResult, StoredDataset } from "@/lib/types";

const rows: DatasetRow[] = Array.from({ length: 8 }, (_, i) => ({
  日期: `2026-07-${i + 1}`,
  客户: ["甲", "乙", "丙"][i % 3],
  金额: (i + 1) * 100,
  状态: i % 3 === 0 ? "预警" : "正常",
}));

const columns: ColumnMeta[] = [
  { name: "日期", type: "date", role: "time", format: "date", defaultAggregation: "count", sampleValues: [] },
  { name: "客户", type: "string", role: "dimension", defaultAggregation: "count", sampleValues: [] },
  { name: "金额", type: "number", role: "metric", format: "currency", defaultAggregation: "sum", sampleValues: [] },
  { name: "状态", type: "string", role: "status", defaultAggregation: "count", sampleValues: [] },
];

function makeDataset(): StoredDataset {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    name: "测试集",
    fileName: "test.csv",
    source: "csv",
    rowCount: rows.length,
    originalRowCount: rows.length,
    storedRowCount: rows.length,
    columns,
    rows,
    createdAt: "2026-07-16T00:00:00.000Z",
    status: "ready",
    analysis: null,
    quality: {
      originalRowCount: rows.length,
      storedRowCount: rows.length,
      columnCount: columns.length,
      duplicateRowCount: 0,
      emptyRowCount: 0,
      warnings: [],
      generatedAt: "2026-07-16T00:00:00.000Z",
    },
  };
}

beforeEach(() => {
  state.enabled = false;
  state.understanding = null;
  state.orchResult = null;
  vi.mocked(getActiveLLMConfig).mockReset();
  vi.mocked(getActiveLLMConfig).mockImplementation(async () => ({
    provider: "test",
    baseUrl: "https://x",
    apiKey: state.enabled ? "k" : "",
    model: "m",
    enabled: state.enabled,
  }));
  vi.mocked(getUnderstanding).mockReset();
  vi.mocked(getUnderstanding).mockImplementation(async () => state.understanding as never);
  vi.mocked(runAnalysisSession).mockReset();
  vi.mocked(runAnalysisSession).mockImplementation(async (input) => {
    const r = state.orchResult as { finalResult?: unknown } | null;
    if (r?.finalResult) input.hooks.onFinal?.(r.finalResult as never);
    return state.orchResult as never;
  });
});

describe("SSE final 事件 - SPEC 9.6 / 18.3", () => {
  it("local: result 先于 final，provider=local", async () => {
    const events: string[] = [];
    let finalProvider = "";
    await analyzeDataset(makeDataset(), "r1", {
      onStructured: () => events.push("result"),
      onNarrativeToken: () => {},
      onFinal: (p) => {
        events.push("final");
        finalProvider = (p as { provider: string }).provider;
      },
    });
    expect(events.indexOf("result")).toBeLessThan(events.indexOf("final"));
    expect(finalProvider).toBe("local");
  });

  it("local: final options 与 charts 一一对应", async () => {
    let final: { options: unknown[]; charts: unknown[] } | null = null;
    await analyzeDataset(makeDataset(), "r2", {
      onNarrativeToken: () => {},
      onFinal: (p) => {
        const fp = p as { options: unknown[]; charts: unknown[] };
        final = { options: fp.options, charts: fp.charts };
      },
    });
    expect(final!.options.length).toBe(final!.charts.length);
  });

  it("orchestrator: final provider=local+llm", async () => {
    state.enabled = true;
    state.understanding = {
      id: "und_1",
      datasetId: "00000000-0000-4000-8000-000000000000",
      status: "confirmed",
      fields: [],
    };
    const fr: FinalAnalysisResult = {
      provider: "local+llm",
      summary: "s",
      insights: [],
      charts: [],
      options: [],
      narrative: "n",
      createdAt: "2026-07-16T00:00:00.000Z",
      version: "v0.3.0",
      analysisMode: "llm_orchestrated",
    };
    state.orchResult = { session: { id: "s1" }, activeRevision: { id: "r1" }, finalResult: fr };
    let finalProvider = "";
    await analyzeDataset(makeDataset(), "r3", {
      onNarrativeToken: () => {},
      onFinal: (p) => {
        finalProvider = (p as { provider: string }).provider;
      },
    });
    expect(finalProvider).toBe("local+llm");
  });

  it("orchestrator: final 含 analysisMode/version", async () => {
    state.enabled = true;
    state.understanding = { id: "u", datasetId: "x", status: "confirmed", fields: [] };
    const fr: FinalAnalysisResult = {
      provider: "local+llm",
      summary: "s",
      insights: [],
      charts: [],
      options: [],
      narrative: "",
      createdAt: "2026-07-16T00:00:00.000Z",
      version: "v0.3.0",
      analysisMode: "llm_orchestrated",
      reviewStatus: "approved",
    };
    state.orchResult = { session: { id: "s1" }, activeRevision: { id: "r1" }, finalResult: fr };
    let final: FinalAnalysisResult | null = null;
    await analyzeDataset(makeDataset(), "r4", {
      onNarrativeToken: () => {},
      onFinal: (p) => {
        final = p as FinalAnalysisResult;
      },
    });
    expect(final!.version).toBe("v0.3.0");
    expect(final!.analysisMode).toBe("llm_orchestrated");
  });
});
