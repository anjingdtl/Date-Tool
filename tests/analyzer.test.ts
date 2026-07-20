/**
 * tests/analyzer.test.ts
 *
 * v0.3 门面测试（SPEC 14.1）：
 * - LLM 未启用 / 无已确认 Understanding → runLocalFallbackAnalysis（provider=local）；
 * - LLM 启用 + confirmed Understanding → runOrchestratedAnalysis（mock runAnalysisSession）。
 *
 * v0.2.1 本地降级路径继续通过（SPEC 4.2）。
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
import type { ColumnMeta, DatasetRow, DatasetUnderstanding, FinalAnalysisResult, StoredDataset } from "@/lib/types";

function makeColumn(over: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: over.name ?? "金额",
    type: over.type ?? "number",
    role: over.role ?? "metric",
    format: over.format ?? "decimal",
    defaultAggregation: over.defaultAggregation ?? "sum",
    includeInAnalysis: over.includeInAnalysis ?? true,
    sampleValues: over.sampleValues ?? [],
  };
}

const rows: DatasetRow[] = [
  { 日期: "2026-07-01", 客户: "甲", 金额: 100, 状态: "正常" },
  { 日期: "2026-07-02", 客户: "乙", 金额: 200, 状态: "正常" },
  { 日期: "2026-07-03", 客户: "甲", 金额: 300, 状态: "预警" },
  { 日期: "2026-07-04", 客户: "丙", 金额: 400, 状态: "正常" },
  { 日期: "2026-07-05", 客户: "甲", 金额: 500, 状态: "预警" },
  { 日期: "2026-07-06", 客户: "乙", 金额: 600, 状态: "正常" },
  { 日期: "2026-07-07", 客户: "丙", 金额: 700, 状态: "正常" },
  { 日期: "2026-07-08", 客户: "甲", 金额: 800, 状态: "正常" },
];

const columns: ColumnMeta[] = [
  makeColumn({ name: "日期", type: "date", role: "time", format: "date", defaultAggregation: "count" }),
  makeColumn({ name: "客户", type: "string", role: "dimension", defaultAggregation: "count" }),
  makeColumn({ name: "金额", type: "number", role: "metric", format: "currency", defaultAggregation: "sum" }),
  makeColumn({ name: "状态", type: "string", role: "status", defaultAggregation: "count" }),
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

function confirmedUnderstanding(): DatasetUnderstanding {
  return {
    version: "v1",
    id: "und_1",
    datasetId: "00000000-0000-4000-8000-000000000000",
    datasetKind: "transaction",
    tableShape: "tidy_rows",
    businessDomain: "销售",
    businessDescription: "销售明细",
    grainDescription: "每行一笔",
    rowMeaning: "销售记录",
    selectedSheets: ["Sheet1"],
    fields: [
      { field: "日期", semanticName: "日期", role: "time", measureBehavior: "unknown", subRole: "time_part", businessMeaning: "日期", recommendedAggregation: "none", confidence: 0.9, reason: "日期" },
      { field: "金额", semanticName: "金额", role: "metric", measureBehavior: "currency", subRole: "actual", businessMeaning: "金额", recommendedAggregation: "sum", confidence: 0.9, reason: "金额" },
    ],
    relationships: [],
    derivedMetrics: [],
    recommendedObjectives: [],
    ambiguities: [],
    confidence: 0.85,
    status: "confirmed",
    createdAt: "2026-07-16T00:00:00.000Z",
    confirmedAt: "2026-07-16T00:00:00.000Z",
  };
}

function mockFinalResult(): FinalAnalysisResult {
  return {
    provider: "local+llm",
    summary: "orch summary",
    insights: ["[positive] t"],
    charts: [],
    options: [],
    narrative: "orch narrative",
    createdAt: "2026-07-16T00:00:00.000Z",
    version: "v0.3.0",
    analysisMode: "llm_orchestrated",
    reviewStatus: "approved",
  };
}

beforeEach(() => {
  state.enabled = false;
  state.understanding = null;
  state.orchResult = null;
  vi.mocked(getActiveLLMConfig).mockReset();
  vi.mocked(getActiveLLMConfig).mockImplementation(async () => ({
    provider: "test",
    baseUrl: "https://example.com/v1",
    apiKey: state.enabled ? "test-key" : "",
    model: "test-model",
    enabled: state.enabled,
  }));
  vi.mocked(getUnderstanding).mockReset();
  vi.mocked(getUnderstanding).mockImplementation(async () => state.understanding as DatasetUnderstanding | null);
  vi.mocked(runAnalysisSession).mockReset();
  vi.mocked(runAnalysisSession).mockImplementation(async (input) => {
    const r = state.orchResult as { finalResult?: unknown } | null;
    if (r?.finalResult) input.hooks.onFinal?.(r.finalResult as never);
    return state.orchResult as never;
  });
});

describe("analyzeDataset 门面 - 本地降级（SPEC 14.1 / 4.2）", () => {
  it("LLM 禁用 → provider=local", async () => {
    const result = await analyzeDataset(makeDataset(), "req-1", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local");
    expect(runAnalysisSession).not.toHaveBeenCalled();
  });

  it("LLM 启用但无 Understanding → 回退本地", async () => {
    state.enabled = true;
    state.understanding = null;
    const result = await analyzeDataset(makeDataset(), "req-2", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local");
    expect(runAnalysisSession).not.toHaveBeenCalled();
  });

  it("LLM 启用但 Understanding 未确认 → 回退本地", async () => {
    state.enabled = true;
    const u = confirmedUnderstanding();
    u.status = "ready_for_confirmation";
    state.understanding = u;
    const result = await analyzeDataset(makeDataset(), "req-3", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local");
    expect(runAnalysisSession).not.toHaveBeenCalled();
  });

  it("本地降级发送 onStructured + onFinal", async () => {
    let structuredProvider: string | null = null;
    let finalProvider: string | null = null;
    await analyzeDataset(makeDataset(), "req-4", {
      onStructured: (p) => {
        structuredProvider = p.provider;
      },
      onNarrativeToken: () => {},
      onFinal: (p) => {
        finalProvider = (p as { provider: string }).provider;
      },
    });
    expect(structuredProvider).toBe("local");
    expect(finalProvider).toBe("local");
  });

  it("本地降级 narrative 含本地兜底文本", async () => {
    const result = await analyzeDataset(makeDataset(), "req-5", {
      onNarrativeToken: () => {},
    });
    expect(result.narrative).toContain("已为你完成");
    expect(result.narrative).toContain("本地引擎已算完所有关键数值");
  });

  it("本地降级结果含 evidence/computedInsights/warnings", async () => {
    const result = await analyzeDataset(makeDataset(), "req-6", {
      onNarrativeToken: () => {},
    });
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(Array.isArray(result.computedInsights)).toBe(true);
    expect(result.charts.length).toBeGreaterThan(0);
    expect(result.options.length).toBe(result.charts.length);
    expect((result as FinalAnalysisResult).analysisMode).toBe("rule_fallback");
    expect(result.version).toBe("v0.3.0");
  });

  it("计划/编排失败时自动回退本地，不让整个分析失败", async () => {
    state.enabled = true;
    state.understanding = confirmedUnderstanding();
    vi.mocked(runAnalysisSession).mockRejectedValueOnce(new Error("计划校验失败"));
    const stages: string[] = [];
    const result = await analyzeDataset(makeDataset(), "req-fallback", {
      onNarrativeToken: () => {},
      onStage: (stage) => stages.push(stage),
    });
    expect(result.provider).toBe("local");
    expect((result as FinalAnalysisResult).analysisMode).toBe("rule_fallback");
    expect(stages.some((stage) => stage.includes("本地规则模式"))).toBe(true);
  });
});

describe("analyzeDataset 门面 - LLM 编排", () => {
  it("confirmed Understanding → 调用 orchestrator，provider=local+llm", async () => {
    state.enabled = true;
    state.understanding = confirmedUnderstanding();
    state.orchResult = {
      session: { id: "sess_1" },
      activeRevision: { id: "rev_1" },
      finalResult: mockFinalResult(),
    };
    const result = await analyzeDataset(makeDataset(), "req-7", {
      onNarrativeToken: () => {},
    });
    expect(runAnalysisSession).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("local+llm");
    expect((result as FinalAnalysisResult).analysisMode).toBe("llm_orchestrated");
    expect((result as FinalAnalysisResult).reviewStatus).toBe("approved");
  });

  it("orchestrator 透传 hooks（onPlan/onFinal）", async () => {
    state.enabled = true;
    state.understanding = confirmedUnderstanding();
    state.orchResult = {
      session: { id: "sess_1" },
      activeRevision: { id: "rev_1" },
      finalResult: mockFinalResult(),
    };
    let finalCalled = false;
    await analyzeDataset(makeDataset(), "req-8", {
      onNarrativeToken: () => {},
      onFinal: () => {
        finalCalled = true;
      },
    });
    expect(finalCalled).toBe(true);
    // runAnalysisSession 收到 hooks
    const call = vi.mocked(runAnalysisSession).mock.calls[0][0];
    expect(call.hooks.onFinal).toBeTypeOf("function");
  });
});
