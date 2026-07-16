/**
 * tests/understanding-service.test.ts
 *
 * 阶段 3：understandDataset 的 mocked LLM 路径（SPEC 24.3）。
 *
 * mock 策略（与 analyzer.test.ts 一致）：
 * - vi.mock("@/lib/llm-config") 控制 enabled；
 * - vi.mock("@/lib/llm") 控制 chatJSON 返回 / 抛错 / 多次返回。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: false,
  shouldThrow: false,
  response: null as unknown,
  responses: [] as unknown[],
}));

vi.mock("@/lib/llm-config", () => ({
  getActiveLLMConfig: vi.fn(),
}));
vi.mock("@/lib/llm", () => ({
  chatJSON: vi.fn(),
  streamChat: vi.fn(),
}));

import { understandDataset } from "@/lib/semantic/understand-dataset";
import { chatJSON } from "@/lib/llm";
import { getActiveLLMConfig } from "@/lib/llm-config";
import {
  applyFieldUnderstandingChanges,
  confirmUnderstanding,
  hasUnresolvedBlocking,
  resolveAmbiguity,
} from "@/lib/semantic/apply-understanding";
import type { ColumnMeta, DatasetRow, DatasetUnderstanding, StoredDataset } from "@/lib/types";

/* ------------------------- fixtures ------------------------- */

const columns: ColumnMeta[] = [
  { name: "月份", type: "date", role: "time", format: "date", sampleValues: ["2025-01", "2025-02"] },
  { name: "地市", type: "string", role: "dimension", sampleValues: ["南宁", "柳州"], distinctCount: 4 },
  { name: "用户数", type: "number", role: "metric", sampleValues: [100, 200] },
  { name: "业务收入", type: "number", role: "metric", format: "currency", sampleValues: [1000, 2000] },
  { name: "目标收入", type: "number", role: "metric", format: "currency", sampleValues: [1200, 1300] },
];

const rows: DatasetRow[] = [
  { 月份: "2025-01", 地市: "南宁", 用户数: 100, 业务收入: 1000, 目标收入: 1200 },
  { 月份: "2025-01", 地市: "柳州", 用户数: 80, 业务收入: 800, 目标收入: 1000 },
  { 月份: "2025-02", 地市: "南宁", 用户数: 110, 业务收入: 1100, 目标收入: 1200 },
  { 月份: "2025-02", 地市: "柳州", 用户数: 85, 业务收入: 900, 目标收入: 1000 },
];

function makeDataset(): StoredDataset {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "通信运营",
    fileName: "kpi.csv",
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

/** 合法的 LLM 输出（不含 id/datasetId/createdAt，服务端补全） */
function validLLMResponse(): unknown {
  return {
    version: "v1",
    datasetKind: "kpi_wide",
    tableShape: "wide_metrics",
    businessDomain: "通信运营",
    businessDescription: "各地市月度经营指标",
    grainDescription: "每行表示某地市某月的一组经营指标",
    rowMeaning: "地市月度经营记录",
    selectedSheets: ["Sheet1"],
    fields: [
      { field: "月份", semanticName: "月份", role: "time", measureBehavior: "unknown", subRole: "time_part", businessMeaning: "统计月份", recommendedAggregation: "none", confidence: 0.9, reason: "日期列" },
      { field: "地市", semanticName: "地市", role: "dimension", measureBehavior: "unknown", subRole: "none", businessMeaning: "地市维度", recommendedAggregation: "none", confidence: 0.9, reason: "地区" },
      { field: "用户数", semanticName: "用户数", role: "metric", measureBehavior: "stock", subRole: "actual", businessMeaning: "月末用户存量", recommendedAggregation: "last", confidence: 0.8, reason: "存量指标跨期不累加" },
      { field: "业务收入", semanticName: "业务收入", role: "metric", measureBehavior: "currency", subRole: "actual", businessMeaning: "当月实际收入", recommendedAggregation: "sum", confidence: 0.85, reason: "金额流量" },
      { field: "目标收入", semanticName: "目标收入", role: "metric", measureBehavior: "currency", subRole: "target", businessMeaning: "当月目标收入", recommendedAggregation: "sum", confidence: 0.85, reason: "目标金额" },
    ],
    relationships: [
      { id: "rel_1", fields: ["业务收入", "目标收入"], relation: "actual_target", description: "实际收入与目标收入", confidence: 0.8 },
    ],
    derivedMetrics: [],
    recommendedObjectives: ["收入趋势", "目标完成率"],
    ambiguities: [],
    confidence: 0.8,
    status: "ready_for_confirmation",
  };
}

beforeEach(() => {
  state.enabled = false;
  state.shouldThrow = false;
  state.response = null;
  state.responses = [];
  vi.mocked(getActiveLLMConfig).mockReset();
  vi.mocked(getActiveLLMConfig).mockImplementation(async () => ({
    provider: "test",
    baseUrl: "https://example.com/v1",
    apiKey: state.enabled ? "test-key" : "",
    model: "test-model",
    enabled: state.enabled,
  }));
  vi.mocked(chatJSON).mockReset();
  vi.mocked(chatJSON).mockImplementation(async () => {
    if (state.shouldThrow) throw new Error("LLM 结构化解读超时");
    if (state.responses.length > 0) return state.responses.shift();
    return state.response;
  });
});

describe("understandDataset - SPEC 10", () => {
  it("LLM 未启用 → fallback，不产生伪 understanding", async () => {
    state.enabled = false;
    const r = await understandDataset(makeDataset(), "req-1");
    expect(r.status).toBe("fallback");
    expect(r.understanding).toBeNull();
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("合法输出 → ready_for_confirmation，含数据集类型/行粒度/字段语义/关系", async () => {
    state.enabled = true;
    state.response = validLLMResponse();
    const r = await understandDataset(makeDataset(), "req-2");
    expect(r.status).toBe("ready_for_confirmation");
    expect(r.understanding).not.toBeNull();
    const u = r.understanding!;
    expect(u.datasetKind).toBe("kpi_wide");
    expect(u.grainDescription).toContain("地市");
    expect(u.fields.length).toBe(5);
    expect(u.relationships.some((rel) => rel.relation === "actual_target")).toBe(true);
    // 服务端补全字段
    expect(u.id).toBeTruthy();
    expect(u.datasetId).toBe("22222222-2222-4222-8222-222222222222");
    expect(u.createdAt).toBeTruthy();
  });

  it("存量指标识别（用户数 stock，推荐 last）", async () => {
    state.enabled = true;
    state.response = validLLMResponse();
    const r = await understandDataset(makeDataset(), "req-3");
    const users = r.understanding!.fields.find((f) => f.field === "用户数");
    expect(users?.measureBehavior).toBe("stock");
    expect(users?.recommendedAggregation).toBe("last");
  });

  it("blocking ambiguity → needs_user_input", async () => {
    state.enabled = true;
    const resp = validLLMResponse() as { ambiguities: unknown[] };
    resp.ambiguities = [
      { id: "amb_1", fields: ["某列"], question: "该列是存量还是流量？", blocking: true },
    ];
    state.response = resp;
    const r = await understandDataset(makeDataset(), "req-4");
    expect(r.status).toBe("needs_user_input");
    expect(r.understanding!.ambiguities.some((a) => a.blocking)).toBe(true);
  });

  it("首次校验失败，第二次修复成功（最多 2 次修复）", async () => {
    state.enabled = true;
    state.responses = [{ version: "v1" }, validLLMResponse()]; // 第一次非法，第二次合法
    const r = await understandDataset(makeDataset(), "req-5");
    expect(r.status).toBe("ready_for_confirmation");
    expect(chatJSON).toHaveBeenCalledTimes(2);
  });

  it("两次修复后仍失败 → failed，不产生伪 understanding", async () => {
    state.enabled = true;
    state.responses = [
      { version: "v1" },
      { foo: "bar" },
      { fields: [] },
    ];
    const r = await understandDataset(makeDataset(), "req-6");
    expect(r.status).toBe("failed");
    expect(r.understanding).toBeNull();
    expect(r.error).toBeTruthy();
    expect(chatJSON).toHaveBeenCalledTimes(3); // 初始 + 2 次修复
  });

  it("LLM 超时 → failed", async () => {
    state.enabled = true;
    state.shouldThrow = true;
    const r = await understandDataset(makeDataset(), "req-7");
    expect(r.status).toBe("failed");
    expect(r.understanding).toBeNull();
  });

  it("context 始终返回（即使失败）", async () => {
    state.enabled = false;
    const r = await understandDataset(makeDataset(), "req-8");
    expect(r.context).not.toBeNull();
    expect(r.context.columns.length).toBe(5);
  });
});

describe("apply-understanding - 用户修正（SPEC 10.5）", () => {
  function makeCompleteUnderstanding(
    over: Partial<DatasetUnderstanding> = {},
  ): DatasetUnderstanding {
    const base = validLLMResponse() as Omit<
      DatasetUnderstanding,
      "id" | "datasetId" | "createdAt" | "confirmedAt"
    >;
    return {
      ...base,
      id: "und_x",
      datasetId: "ds_x",
      createdAt: "2026-07-16T00:00:00.000Z",
      ...over,
    } as DatasetUnderstanding;
  }

  it("applyFieldUnderstandingChanges 覆盖字段语义，不引入/删除字段", () => {
    const base = makeCompleteUnderstanding();
    const before = base.fields.length;
    const updated = applyFieldUnderstandingChanges(base, [
      { field: "用户数", changes: { measureBehavior: "flow", recommendedAggregation: "sum" } },
    ]);
    expect(updated.fields.length).toBe(before);
    const users = updated.fields.find((f) => f.field === "用户数");
    expect(users?.measureBehavior).toBe("flow");
    expect(users?.recommendedAggregation).toBe("sum");
  });

  it("resolveAmbiguity 解除 blocking 并应用字段修改", () => {
    const base = makeCompleteUnderstanding({
      ambiguities: [
        { id: "amb_1", fields: ["用户数"], question: "存量/流量？", blocking: true },
      ],
      status: "needs_user_input",
    });
    expect(hasUnresolvedBlocking(base)).toBe(true);
    const resolved = resolveAmbiguity(base, "amb_1", [
      { field: "用户数", changes: { measureBehavior: "stock" } },
    ]);
    expect(hasUnresolvedBlocking(resolved)).toBe(false);
    expect(
      resolved.fields.find((f) => f.field === "用户数")?.measureBehavior,
    ).toBe("stock");
    expect(resolved.fields.find((f) => f.field === "用户数")?.source).toBe("user");
    expect(resolved.status).toBe("ready_for_confirmation");
  });

  it("confirmUnderstanding 置 confirmed + confirmedAt", () => {
    const confirmed = confirmUnderstanding(
      makeCompleteUnderstanding(),
      "2026-07-16T01:00:00.000Z",
    );
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedAt).toBe("2026-07-16T01:00:00.000Z");
  });

  it("hasUnresolvedBlocking：无 ambiguity 时 false", () => {
    expect(hasUnresolvedBlocking(makeCompleteUnderstanding())).toBe(false);
  });
});
