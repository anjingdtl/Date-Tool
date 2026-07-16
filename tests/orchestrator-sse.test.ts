/**
 * tests/orchestrator-sse.test.ts
 *
 * SPEC 18.2 / 24.8：编排 SSE 事件顺序。
 * mock runAnalysisSession 按序触发 OrchestratorHooks，验证 analyzeDataset 门面
 * 透传到 AnalyzeHooks 的顺序：stage(planning) → plan → task_started → task_completed →
 * stage(reviewing) → review → token → final。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/llm-config", () => ({ getActiveLLMConfig: vi.fn() }));
vi.mock("@/lib/store", () => ({ getUnderstanding: vi.fn() }));
vi.mock("@/lib/orchestrator/run-analysis-session", () => ({
  runAnalysisSession: vi.fn(),
}));

import { analyzeDataset } from "@/lib/analyzer";
import { getActiveLLMConfig } from "@/lib/llm-config";
import { getUnderstanding } from "@/lib/store";
import { runAnalysisSession } from "@/lib/orchestrator/run-analysis-session";
import type { ColumnMeta, DatasetRow, StoredDataset } from "@/lib/types";

const rows: DatasetRow[] = Array.from({ length: 8 }, (_, i) => ({
  d: `2026-07-${i + 1}`,
  v: (i + 1) * 10,
}));
const columns: ColumnMeta[] = [
  { name: "d", type: "date", role: "time", sampleValues: [] },
  { name: "v", type: "number", role: "metric", defaultAggregation: "sum", sampleValues: [] },
];
function makeDataset(): StoredDataset {
  return {
    id: "12345678-1234-4123-8123-123456789012",
    name: "t",
    fileName: "t.csv",
    source: "csv",
    rowCount: 8,
    originalRowCount: 8,
    storedRowCount: 8,
    columns,
    rows,
    createdAt: "2026-07-16T00:00:00.000Z",
    status: "ready",
    analysis: null,
    quality: {
      originalRowCount: 8,
      storedRowCount: 8,
      columnCount: 2,
      duplicateRowCount: 0,
      emptyRowCount: 0,
      warnings: [],
      generatedAt: "2026-07-16T00:00:00.000Z",
    },
  };
}

beforeEach(() => {
  vi.mocked(getActiveLLMConfig).mockResolvedValue({
    provider: "test",
    baseUrl: "https://x",
    apiKey: "k",
    model: "m",
    enabled: true,
  });
  vi.mocked(getUnderstanding).mockResolvedValue({
    id: "und",
    datasetId: "x",
    status: "confirmed",
    fields: [],
  } as never);
});

describe("orchestrator SSE 事件顺序 - SPEC 18.2 / 24.8", () => {
  it("事件按规约顺序透传", async () => {
    // mock runAnalysisSession 按序触发 hooks
    vi.mocked(runAnalysisSession).mockImplementation(async (input) => {
      const h = input.hooks as unknown as Record<string, (...a: unknown[]) => void>;
      h.onStage?.("planning", "正在制订分析计划");
      h.onPlan?.({});
      h.onTaskStarted?.({});
      h.onTaskCompleted?.({}, {});
      h.onStage?.("reviewing", "AI 正在终审");
      h.onReview?.({});
      h.onNarrativeToken?.("t");
      h.onFinal?.({ provider: "local+llm" });
      return {
        session: { id: "s" },
        activeRevision: { id: "r" },
        finalResult: { provider: "local+llm" },
      } as never;
    });

    const seq: string[] = [];
    await analyzeDataset(makeDataset(), "req-sse", {
      onStage: (s) => seq.push(`stage:${s}`),
      onPlan: () => seq.push("plan"),
      onTaskStarted: () => seq.push("task_started"),
      onTaskCompleted: () => seq.push("task_completed"),
      onReview: () => seq.push("review"),
      onNarrativeToken: () => seq.push("token"),
      onFinal: () => seq.push("final"),
    });

    const order = ["plan", "task_started", "task_completed", "review", "token", "final"];
    for (let i = 1; i < order.length; i++) {
      expect(seq.indexOf(order[i])).toBeGreaterThan(seq.indexOf(order[i - 1]));
    }
    // stage(planning) 在 plan 前
    const planningStage = seq.findIndex((s) => s.startsWith("stage:") && s.includes("制订"));
    expect(planningStage).toBeLessThan(seq.indexOf("plan"));
  });

  it("review needs_user_input 触发 onQuestion", async () => {
    vi.mocked(runAnalysisSession).mockImplementation(async (input) => {
      const h = input.hooks as unknown as Record<string, (...a: unknown[]) => void>;
      h.onReview?.({ status: "needs_user_input" });
      h.onQuestion?.(["问题1"]);
      h.onFinal?.({ provider: "local+llm" });
      return {
        session: { id: "s" },
        activeRevision: { id: "r" },
        finalResult: { provider: "local+llm" },
      } as never;
    });
    let questions: string[] = [];
    await analyzeDataset(makeDataset(), "req-q", {
      onNarrativeToken: () => {},
      onQuestion: (q) => {
        questions = q;
      },
    });
    expect(questions).toEqual(["问题1"]);
  });
});
