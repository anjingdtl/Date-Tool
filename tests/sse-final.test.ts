/**
 * tests/sse-final.test.ts
 *
 * SPEC 9.6 / 18.3：SSE final 事件。
 * 直接驱动 analyzeDataset 的 hooks，验证 final 在 local 与 local+llm 两种模式下
 * 都正确发送最终 summary / actions / 图表标题 / options，且 result 先于 final。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: false,
  shouldThrow: false,
  response: null as unknown,
}));

vi.mock("@/lib/llm-config", () => ({ getActiveLLMConfig: vi.fn() }));
vi.mock("@/lib/llm", () => ({ chatJSON: vi.fn(), streamChat: vi.fn() }));

import { analyzeDataset } from "@/lib/analyzer";
import { chatJSON } from "@/lib/llm";
import { getActiveLLMConfig } from "@/lib/llm-config";
import type { ColumnMeta, DatasetRow, StoredDataset } from "@/lib/types";

function makeColumn(over: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: over.name ?? "金额",
    type: over.type ?? "number",
    role: over.role ?? "metric",
    format: over.format ?? "currency",
    defaultAggregation: over.defaultAggregation ?? "sum",
    includeInAnalysis: over.includeInAnalysis ?? true,
    sampleValues: [],
    nullable: false,
    nullCount: 0,
    nullRate: 0,
    distinctCount: over.distinctCount,
    confidence: 1,
    userModified: false,
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
  makeColumn({ name: "客户", type: "string", role: "dimension", format: "plain", defaultAggregation: "count" }),
  makeColumn({ name: "金额", type: "number", role: "metric", format: "currency", defaultAggregation: "sum" }),
  makeColumn({ name: "状态", type: "string", role: "status", format: "plain", defaultAggregation: "count" }),
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
    createdAt: new Date().toISOString(),
    quality: {
      originalRowCount: rows.length,
      storedRowCount: rows.length,
      columnCount: columns.length,
      duplicateRowCount: 0,
      emptyRowCount: 0,
      warnings: [],
      generatedAt: new Date().toISOString(),
    },
    status: "ready",
    analysis: null,
  };
}

beforeEach(() => {
  state.enabled = false;
  state.shouldThrow = false;
  state.response = null;
  vi.mocked(getActiveLLMConfig).mockReset();
  vi.mocked(getActiveLLMConfig).mockImplementation(async () => ({
    provider: "test",
    baseUrl: "https://x",
    apiKey: state.enabled ? "k" : "",
    model: "m",
    enabled: state.enabled,
  }));
  vi.mocked(chatJSON).mockReset();
  vi.mocked(chatJSON).mockImplementation(async () => {
    if (state.shouldThrow) throw new Error("LLM 结构化解读超时");
    return state.response;
  });
});

describe("SSE final 事件 - SPEC 9.6", () => {
  it("local: result 先于 final，final provider=local", async () => {
    const events: string[] = [];
    let finalProvider = "";
    await analyzeDataset(makeDataset(), "r1", {
      onStructured: () => events.push("result"),
      onNarrativeToken: () => {},
      onFinal: (p) => {
        events.push("final");
        finalProvider = p.provider;
      },
    });
    expect(events.indexOf("result")).toBeLessThan(events.indexOf("final"));
    expect(finalProvider).toBe("local");
  });

  it("local: final summary 为本地兜底，options 与 charts 一一对应", async () => {
    let final: { summary: string; options: unknown[]; charts: unknown[] } | null = null;
    await analyzeDataset(makeDataset(), "r2", {
      onNarrativeToken: () => {},
      onFinal: (p) => {
        final = { summary: p.summary, options: p.options, charts: p.charts };
      },
    });
    expect(final).not.toBeNull();
    expect(final!.summary.length).toBeGreaterThan(0);
    expect(final!.options.length).toBe(final!.charts.length);
  });

  it("LLM 成功: final provider=local+llm 且 summary 被替换", async () => {
    state.enabled = true;
    state.response = {
      summary: "LLM最终总结",
      narrative: "这是LLM解读",
      actions: ["行动A", "行动B"],
    };
    let finalSummary = "";
    let finalProvider = "";
    await analyzeDataset(makeDataset(), "r3", {
      onNarrativeToken: () => {},
      onFinal: (p) => {
        finalSummary = p.summary;
        finalProvider = p.provider;
      },
    });
    expect(finalProvider).toBe("local+llm");
    expect(finalSummary).toBe("LLM最终总结");
  });

  it("LLM actions 出现在 final insights", async () => {
    state.enabled = true;
    state.response = {
      summary: "s",
      narrative: "n",
      actions: ["核查预警记录"],
    };
    let finalInsights: string[] = [];
    await analyzeDataset(makeDataset(), "r4", {
      onNarrativeToken: () => {},
      onFinal: (p) => {
        finalInsights = p.insights;
      },
    });
    expect(finalInsights.some((s) => s.includes("核查预警记录"))).toBe(true);
  });

  it("renamedChartTitles 在 final charts 立即生效", async () => {
    state.enabled = true;
    const captured: { id: string }[] = [];
    vi.mocked(chatJSON).mockImplementation(async () => {
      const renamed: Record<string, string> = {};
      for (const c of captured) renamed[c.id] = `新标题_${c.id}`;
      return { summary: "s", narrative: "n", actions: [], renamedChartTitles: renamed };
    });
    let finalTitles: string[] = [];
    await analyzeDataset(makeDataset(), "r5", {
      onStructured: (p) => captured.push(...p.charts.map((c) => ({ id: c.id }))),
      onNarrativeToken: () => {},
      onFinal: (p) => {
        finalTitles = p.charts.map((c) => c.title);
      },
    });
    expect(finalTitles.length).toBeGreaterThan(0);
    expect(finalTitles.every((t) => t.startsWith("新标题_"))).toBe(true);
  });

  it("LLM 失败时 final 仍为 local", async () => {
    state.enabled = true;
    state.shouldThrow = true;
    let finalProvider = "x";
    await analyzeDataset(makeDataset(), "r6", {
      onNarrativeToken: () => {},
      onFinal: (p) => {
        finalProvider = p.provider;
      },
    });
    expect(finalProvider).toBe("local");
  });

  it("final narrative 为完整文本（token 丢失时可恢复）", async () => {
    state.enabled = true;
    state.response = {
      summary: "s",
      narrative: "完整的LLM解读文本，不会因 token 丢失而残缺",
      actions: [],
    };
    let finalNarrative = "";
    await analyzeDataset(makeDataset(), "r7", {
      // 故意不消费 token，模拟前端丢 token
      onNarrativeToken: () => {},
      onFinal: (p) => {
        finalNarrative = p.narrative ?? "";
      },
    });
    expect(finalNarrative).toBe("完整的LLM解读文本，不会因 token 丢失而残缺");
  });
});
