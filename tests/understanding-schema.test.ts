import { describe, it, expect } from "vitest";
import {
  DatasetUnderstandingSchema,
  validateDatasetUnderstanding,
  type DatasetUnderstandingParsed,
} from "@/lib/schemas/understanding";

/** 合法 DatasetUnderstanding 样本（通信运营 KPI 宽表场景，SPEC 27） */
function validUnderstanding(): DatasetUnderstandingParsed {
  return {
    version: "v1",
    id: "und_1",
    datasetId: "ds_1",
    datasetKind: "kpi_wide",
    tableShape: "wide_metrics",
    businessDomain: "通信运营",
    businessDescription: "各地市月度经营指标",
    grainDescription: "每行表示某地市某月的一组经营指标",
    rowMeaning: "地市月度经营记录",
    selectedSheets: ["Sheet1"],
    fields: [
      {
        field: "月份",
        semanticName: "月份",
        role: "time",
        measureBehavior: "unknown",
        subRole: "time_part",
        businessMeaning: "统计月份",
        recommendedAggregation: "none",
        confidence: 0.9,
        reason: "日期列",
      },
      {
        field: "业务收入",
        semanticName: "业务收入",
        role: "metric",
        measureBehavior: "currency",
        subRole: "actual",
        businessMeaning: "当月实际收入",
        recommendedAggregation: "sum",
        confidence: 0.85,
        reason: "金额",
      },
    ],
    relationships: [
      {
        id: "rel_1",
        fields: ["业务收入", "目标收入"],
        relation: "actual_target",
        description: "实际收入与目标收入",
        confidence: 0.8,
      },
    ],
    derivedMetrics: [
      {
        id: "dm_1",
        name: "收入完成率",
        formula: {
          op: "safe_divide",
          numerator: { op: "field", field: "业务收入" },
          denominator: { op: "field", field: "目标收入" },
          whenZero: "null",
        },
        description: "实际收入除以目标收入",
        confidence: 0.8,
        requiresUserConfirmation: false,
      },
    ],
    recommendedObjectives: ["收入趋势", "目标完成率"],
    ambiguities: [
      {
        id: "amb_1",
        fields: ["用户数"],
        question: "用户数是存量还是流量？",
        blocking: false,
      },
    ],
    confidence: 0.8,
    status: "ready_for_confirmation",
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("DatasetUnderstandingSchema - SPEC 10.2", () => {
  it("合法样本通过", () => {
    expect(DatasetUnderstandingSchema.safeParse(validUnderstanding()).success).toBe(true);
  });

  it("拒绝 version 非 v1", () => {
    const u = validUnderstanding();
    (u as { version: string }).version = "v2";
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("拒绝空 id", () => {
    const u = validUnderstanding();
    u.id = "";
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("拒绝非法 datasetKind", () => {
    const u = validUnderstanding();
    (u as { datasetKind: string }).datasetKind = "not_a_kind";
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("拒绝非法 field role", () => {
    const u = validUnderstanding();
    (u.fields[0] as { role: string }).role = "primary_key";
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("拒绝字段 confidence 越界（>1）", () => {
    const u = validUnderstanding();
    u.fields[0].confidence = 1.5;
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("拒绝字段 confidence 越界（<0）", () => {
    const u = validUnderstanding();
    u.fields[0].confidence = -0.1;
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("拒绝 derivedMetrics 非法公式", () => {
    const u = validUnderstanding();
    (u.derivedMetrics[0].formula as { op: string }).op = "pow";
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("拒绝 ambiguity 空 question", () => {
    const u = validUnderstanding();
    u.ambiguities[0].question = "";
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("拒绝 relationship 空 fields", () => {
    const u = validUnderstanding();
    u.relationships[0].fields = [];
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(false);
  });

  it("接受 confirmed 状态与 confirmedAt", () => {
    const u = validUnderstanding();
    u.status = "confirmed";
    u.confirmedAt = "2026-07-16T01:00:00.000Z";
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(true);
  });

  it("接受 fallback 状态", () => {
    const u = validUnderstanding();
    u.status = "fallback";
    expect(DatasetUnderstandingSchema.safeParse(u).success).toBe(true);
  });

  it("validateDatasetUnderstanding 返回 ok/error", () => {
    expect(validateDatasetUnderstanding(validUnderstanding()).ok).toBe(true);
    const bad = validateDatasetUnderstanding({ foo: "bar" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBeTypeOf("string");
  });
});
