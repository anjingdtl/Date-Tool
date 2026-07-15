/**
 * tests/analyzer.test.ts
 *
 * 阶段 G4:覆盖 analyzeDataset 的 LLM 禁用/启用/超时回退/renamedChartTitles 路径。
 *
 * mock 策略:
 * - vi.mock("@/lib/config") 控制 config.llm.enabled;
 * - vi.mock("@/lib/llm") 控制 chatJSON 返回值或抛错。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

/* ------------------------- mock LLM 与 config ------------------------- */

/**
 * 用 vi.hoisted 提升共享状态,使 mock 工厂能引用。
 * - enabled: 控制 config.llm.enabled;
 * - shouldThrow: chatJSON 是否抛错(模拟超时);
 * - response: chatJSON 默认返回值;
 * - capturedCharts: 在 onStructured 时捕获本地 charts,用于动态构造 renamedChartTitles。
 */
const state = vi.hoisted(() => ({
  enabled: false,
  shouldThrow: false,
  response: null as unknown,
  capturedCharts: [] as Array<{ id: string; title: string }>,
}));

vi.mock("@/lib/config", () => ({
  config: {
    llm: {
      get enabled() {
        return state.enabled;
      },
      baseUrl: "https://example.com/v1",
      apiKey: "test-key",
      model: "test-model",
    },
  },
}));

vi.mock("@/lib/llm", () => ({
  chatJSON: vi.fn(),
  streamChat: vi.fn(),
}));

import { analyzeDataset } from "@/lib/analyzer";
import { chatJSON } from "@/lib/llm";
import type { ColumnMeta, DatasetRow, StoredDataset } from "@/lib/types";

/* ------------------------- 夹具 ------------------------- */

function makeColumn(over: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: over.name ?? "金额",
    type: over.type ?? "number",
    role: over.role ?? "metric",
    format: over.format ?? "decimal",
    defaultAggregation: over.defaultAggregation ?? "sum",
    includeInAnalysis: over.includeInAnalysis ?? true,
    sampleValues: over.sampleValues ?? [],
    nullable: over.nullable ?? false,
    nullCount: over.nullCount ?? 0,
    nullRate: over.nullRate ?? 0,
    distinctCount: over.distinctCount,
    confidence: over.confidence ?? 1,
    userModified: over.userModified ?? false,
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
  makeColumn({
    name: "日期",
    type: "date",
    role: "time",
    format: "date",
    defaultAggregation: "count",
  }),
  makeColumn({
    name: "客户",
    type: "string",
    role: "dimension",
    format: "plain",
    defaultAggregation: "count",
  }),
  makeColumn({
    name: "金额",
    type: "number",
    role: "metric",
    format: "currency",
    defaultAggregation: "sum",
  }),
  makeColumn({
    name: "状态",
    type: "string",
    role: "status",
    format: "plain",
    defaultAggregation: "count",
  }),
];

function makeDataset(over: Partial<StoredDataset> = {}): StoredDataset {
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
    ...over,
  };
}

/* ------------------------- 公共 beforeEach ------------------------- */

beforeEach(() => {
  state.enabled = false;
  state.shouldThrow = false;
  state.response = null;
  state.capturedCharts = [];
  // 每个测试前重置 chatJSON 为默认实现:按 state 决定抛错或返回 response
  vi.mocked(chatJSON).mockReset();
  vi.mocked(chatJSON).mockImplementation(async () => {
    if (state.shouldThrow) {
      throw new Error("LLM 结构化解读超时");
    }
    return state.response;
  });
});

/* ------------------------- LLM 禁用 ------------------------- */

describe("analyzeDataset - LLM 禁用", () => {
  it("provider 为 local", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-1", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local");
  });

  it("onStructured 立即发送本地结果,provider=local", async () => {
    const ds = makeDataset();
    let structured: {
      provider: string;
      evidence?: unknown[];
      computedInsights?: unknown[];
      warnings?: string[];
    } | null = null;
    await analyzeDataset(ds, "req-2", {
      onStructured: (p) => {
        structured = p;
      },
      onNarrativeToken: () => {},
    });
    expect(structured).not.toBeNull();
    expect(structured!.provider).toBe("local");
    expect(Array.isArray(structured!.evidence)).toBe(true);
    expect(Array.isArray(structured!.computedInsights)).toBe(true);
    expect(Array.isArray(structured!.warnings)).toBe(true);
  });

  it("onStage 至少触发一次,且含计算阶段", async () => {
    const ds = makeDataset();
    const stages: string[] = [];
    await analyzeDataset(ds, "req-3", {
      onStage: (s) => stages.push(s),
      onNarrativeToken: () => {},
    });
    expect(stages.length).toBeGreaterThan(0);
    expect(stages.some((s) => s.includes("计算"))).toBe(true);
  });

  it("narrative 为本地兜底文本", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-4", {
      onNarrativeToken: () => {},
    });
    expect(result.narrative).toContain("通读");
  });

  it("onNarrativeToken 至少触发一次", async () => {
    const ds = makeDataset();
    const tokens: string[] = [];
    await analyzeDataset(ds, "req-5", {
      onNarrativeToken: (t) => tokens.push(t),
    });
    expect(tokens.join("").length).toBeGreaterThan(0);
  });

  it("不调用 chatJSON", async () => {
    const ds = makeDataset();
    await analyzeDataset(ds, "req-6", {
      onNarrativeToken: () => {},
    });
    expect(chatJSON).not.toHaveBeenCalled();
  });
});

/* ------------------------- LLM 启用且成功 ------------------------- */

describe("analyzeDataset - LLM 启用且成功", () => {
  beforeEach(() => {
    state.enabled = true;
    state.response = {
      summary: "LLM 总结:数据整体平稳",
      narrative: "这是 LLM 生成的解读,包含两个关键信号。建议关注甲客户。",
      actions: ["建议一:核查预警记录", "建议二:跟进甲客户"],
    };
  });

  it("provider 为 local+llm", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-7", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local+llm");
  });

  it("使用 LLM 的 summary", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-8", {
      onNarrativeToken: () => {},
    });
    expect(result.summary).toBe("LLM 总结:数据整体平稳");
  });

  it("LLM 的 actions 被追加到 insights", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-9", {
      onNarrativeToken: () => {},
    });
    expect(result.insights.some((s) => s.includes("建议一"))).toBe(true);
    expect(result.insights.some((s) => s.includes("建议二"))).toBe(true);
  });

  it("narrative 来自 LLM", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-10", {
      onNarrativeToken: () => {},
    });
    expect(result.narrative).toContain("LLM 生成的解读");
  });

  it("应用 renamedChartTitles(动态捕获图表 id 后改名)", async () => {
    const ds = makeDataset();
    // 在 chatJSON 调用时,onStructured 已先触发并填充 state.capturedCharts。
    // 对每个捕获到的 chart.id 构造新标题,验证 LLM 只能改标题不能改字段。
    vi.mocked(chatJSON).mockImplementation(async () => {
      const renamed: Record<string, string> = {};
      for (const c of state.capturedCharts) {
        renamed[c.id] = `改名_${c.id}`;
      }
      return {
        summary: "s",
        narrative: "n",
        actions: [],
        renamedChartTitles: renamed,
      };
    });

    const result = await analyzeDataset(ds, "req-11", {
      onStructured: (p) => {
        state.capturedCharts = p.charts;
      },
      onNarrativeToken: () => {},
    });

    expect(result.charts.length).toBeGreaterThan(0);
    for (const c of result.charts) {
      expect(c.title).toBe(`改名_${c.id}`);
    }
  });

  it("LLM 未提供 renamedChartTitles 时保留原标题", async () => {
    const ds = makeDataset();
    const beforeTitles: string[] = [];
    const result = await analyzeDataset(ds, "req-12", {
      onStructured: (p) => {
        beforeTitles.push(...p.charts.map((c) => c.title));
      },
      onNarrativeToken: () => {},
    });
    expect(result.charts.map((c) => c.title)).toEqual(beforeTitles);
  });

  it("renamedChartTitles 里的无效 id 不会影响其他图表", async () => {
    const ds = makeDataset();
    vi.mocked(chatJSON).mockImplementation(async () => {
      // 仅对一个不存在的 id 改名,真实图表标题应保持不变
      return {
        summary: "s",
        narrative: "n",
        actions: [],
        renamedChartTitles: { "nonexistent-id": "不会生效的标题" },
      };
    });
    const beforeTitles: string[] = [];
    const result = await analyzeDataset(ds, "req-13", {
      onStructured: (p) => {
        beforeTitles.push(...p.charts.map((c) => c.title));
      },
      onNarrativeToken: () => {},
    });
    expect(result.charts.map((c) => c.title)).toEqual(beforeTitles);
  });
});

/* ------------------------- LLM 失败回退 ------------------------- */

describe("analyzeDataset - LLM 失败回退", () => {
  beforeEach(() => {
    state.enabled = true;
  });

  it("chatJSON 抛错(超时)时回退 local", async () => {
    state.shouldThrow = true;
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-14", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local");
    expect(result.narrative).toContain("通读");
  });

  it("LLM 返回无效 schema(空 summary)时回退 local", async () => {
    state.response = { summary: "", narrative: "", actions: [] };
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-15", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local");
  });

  it("LLM 返回非对象时回退 local", async () => {
    state.response = "not an object";
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-16", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local");
  });

  it("回退时仍发送 onStructured 本地结果", async () => {
    state.shouldThrow = true;
    const ds = makeDataset();
    let structuredProvider: string | null = null;
    await analyzeDataset(ds, "req-17", {
      onStructured: (p) => {
        structuredProvider = p.provider;
      },
      onNarrativeToken: () => {},
    });
    expect(structuredProvider).toBe("local");
  });

  it("回退时 onStage 仍触发 LLM 阶段提示", async () => {
    state.shouldThrow = true;
    const ds = makeDataset();
    const stages: string[] = [];
    await analyzeDataset(ds, "req-18", {
      onStage: (s) => stages.push(s),
      onNarrativeToken: () => {},
    });
    expect(stages.some((s) => s.includes("LLM"))).toBe(true);
  });
});

/* ------------------------- 结果完整性 ------------------------- */

describe("analyzeDataset - 结果完整性", () => {
  it("返回的 AnalysisResult 含 evidence/computedInsights/warnings/version", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-19", {
      onNarrativeToken: () => {},
    });
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(Array.isArray(result.computedInsights)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.version).toBe("v0.2");
    expect(result.charts.length).toBeGreaterThan(0);
    expect(result.options.length).toBe(result.charts.length);
  });

  it("每条 computedInsight 引用有效 evidenceId", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-20", {
      onNarrativeToken: () => {},
    });
    const evIds = new Set((result.evidence ?? []).map((e) => e.id));
    expect(evIds.size).toBeGreaterThan(0);
    for (const ins of result.computedInsights ?? []) {
      expect(evIds.has(ins.evidenceId)).toBe(true);
    }
  });

  it("options 与 charts 一一对应", async () => {
    const ds = makeDataset();
    const result = await analyzeDataset(ds, "req-21", {
      onNarrativeToken: () => {},
    });
    expect(result.options.length).toBe(result.charts.length);
  });
});
