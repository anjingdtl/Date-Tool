/**
 * tests/v021-compatibility.test.ts
 *
 * 阶段 8：旧数据 / 旧分析结果兼容（SPEC 19.3 / 4.2）。
 * - 旧数据集无 understanding → getUnderstanding 返回 null；
 * - 旧数据集可被 store 读取（迁移）；
 * - LLM 关闭 → analyzeDataset 走本地降级（provider=local），v0.2.1 链路继续可用。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/llm-config", () => ({ getActiveLLMConfig: vi.fn() }));

import { saveDataset, getDataset, getUnderstanding } from "@/lib/store";
import { analyzeDataset } from "@/lib/analyzer";
import { getActiveLLMConfig } from "@/lib/llm-config";
import type { ColumnMeta, StoredDataset } from "@/lib/types";

const datasetId = "7b7b7b7b-7b7b-47b7-87b7-7b7b7b7b7b7b";

const columns: ColumnMeta[] = [
  { name: "日期", type: "date", role: "time", sampleValues: [] },
  { name: "金额", type: "number", role: "metric", defaultAggregation: "sum", sampleValues: [] },
];

function legacyDataset(): StoredDataset {
  return {
    id: datasetId,
    name: "旧数据集",
    fileName: "old.csv",
    source: "csv",
    rowCount: 8,
    columns,
    rows: Array.from({ length: 8 }, (_, i) => ({ 日期: `2026-07-${i + 1}`, 金额: (i + 1) * 100 })),
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "ready",
    analysis: null,
    quality: {
      originalRowCount: 8,
      storedRowCount: 8,
      columnCount: 2,
      duplicateRowCount: 0,
      emptyRowCount: 0,
      warnings: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("v0.2.1 兼容 - SPEC 19.3", () => {
  it("旧数据集无 understanding → getUnderstanding 返回 null（不自动调 LLM）", async () => {
    await saveDataset(legacyDataset());
    expect(await getUnderstanding(datasetId)).toBeNull();
  });

  it("旧数据集可读取（store 迁移）", async () => {
    await saveDataset(legacyDataset());
    const ds = await getDataset(datasetId);
    expect(ds).not.toBeNull();
    expect(ds!.columns.length).toBe(2);
    expect(ds!.rows.length).toBe(8);
  });

  it("LLM 关闭 → analyzeDataset 走本地降级，provider=local", async () => {
    vi.mocked(getActiveLLMConfig).mockResolvedValue({
      provider: "openai",
      baseUrl: "",
      apiKey: "",
      model: "",
      enabled: false,
    });
    await saveDataset(legacyDataset());
    const ds = (await getDataset(datasetId))!;
    const result = await analyzeDataset(ds, "req-compat", {
      onNarrativeToken: () => {},
    });
    expect(result.provider).toBe("local");
    expect(result.charts.length).toBeGreaterThan(0);
  });
});
