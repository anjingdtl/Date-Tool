/**
 * lib/llm-prompt.ts
 *
 * LLM 改造的 Prompt 与输入构造（SPEC 12.1 / 12.2 / 12.3）。
 *
 * 关键约束:
 * - 不发送完整原始数据(SPEC 12.1);
 * - LLM 只返回 summary/narrative/actions/renamedChartTitles(SPEC 12.2);
 * - System Prompt 必须包含 SPEC 12.3 的 7 条约束。
 */

import { z } from "zod";
import type {
  AnalysisEvidence,
  ChartSpec,
  ComputedInsight,
  DataQualityReport,
  StoredDataset,
} from "./types";
import type { LocalAnalysis } from "./analysis";

/* ------------------------- SPEC 12.3 System Prompt ------------------------- */

export const SYSTEM_PROMPT = `你是一名资深的企业微信集约化托管运营数据分析师。

下面会给你一份「本地确定性分析引擎」已经算好的结构化结果,包括:
- 数据集摘要与字段定义
- 数据质量报告
- 本地计算出的结构化洞察(ComputedInsight)
- 结构化证据(AnalysisEvidence)
- 已确定的图表列表(标题、类型、字段、聚合,LLM 不得修改)
- 截断与异常警告

你的任务是「解读」,不是「计算」。严格遵守以下规则:

1. 所有数值均来自本地计算,你不得修改任何数字;
2. 不得编造未提供的事实;
3. 数据被截断时,叙述必须使用"基于已载入数据"的措辞;
4. 异常值只能描述为"统计异常",不得直接断言为业务错误;
5. 行动建议必须与已有证据对应,引用具体字段或洞察;
6. 不得输出思考标签;
7. 输出中文。

你只输出 JSON,结构如下:
{
  "summary": "一句话总体结论(中文,50字内)",
  "narrative": "250~400 字的解读:先总览,再点 2~3 个关键信号,最后一句行动建议",
  "actions": ["3~5 条可行动建议,每条对应已有证据"],
  "renamedChartTitles": {"chart_id_1": "更贴切的标题", "chart_id_2": "..."}
}

renamedChartTitles 是可选的:只有当你认为某张图的标题可以更贴切时才提供,key 是图表 id,value 是新标题。
不要修改图表的字段映射、聚合方式或计算结果。`;

/* ------------------------- SPEC 12.1 输入构造 ------------------------- */

/** 构造发给 LLM 的 user prompt(不含原始数据,只含结构化结果) */
export function buildLLMInput(
  ds: StoredDataset,
  local: LocalAnalysis,
): string {
  const lines: string[] = [];

  // 1. 数据集摘要
  lines.push("【数据集摘要】");
  lines.push(`名称: ${ds.name}`);
  lines.push(`文件名: ${ds.fileName}`);
  lines.push(`原始行数: ${ds.originalRowCount ?? ds.rowCount}`);
  lines.push(`载入行数: ${ds.storedRowCount ?? ds.rowCount}`);
  lines.push(`字段数: ${ds.columns.length}`);
  lines.push("");

  // 2. 字段定义
  lines.push("【字段定义】");
  for (const c of ds.columns) {
    if (c.includeInAnalysis === false) continue;
    const parts = [
      `名称=${c.name}`,
      `类型=${c.type}`,
      `角色=${c.role ?? "dimension"}`,
      `格式=${c.format ?? "plain"}`,
    ];
    if (c.nullRate !== undefined && c.nullRate > 0) {
      parts.push(`空值率=${(c.nullRate * 100).toFixed(1)}%`);
    }
    if (c.distinctCount !== undefined) {
      parts.push(`去重数=${c.distinctCount}`);
    }
    lines.push(`- ${parts.join(" | ")}`);
  }
  lines.push("");

  // 3. 数据质量摘要
  if (ds.quality) {
    lines.push("【数据质量摘要】");
    lines.push(formatQualitySummary(ds.quality));
    lines.push("");
  }

  // 4. 本地计算出的结构化洞察
  lines.push("【本地计算出的结构化洞察】");
  if (local.insights.length === 0) {
    lines.push("(无)");
  } else {
    for (const ins of local.insights) {
      lines.push(
        `- [${ins.level}] ${ins.title}: ${ins.statement} (依据ID: ${ins.evidenceId})`,
      );
    }
  }
  lines.push("");

  // 5. 结构化证据
  lines.push("【结构化证据】");
  if (local.evidence.length === 0) {
    lines.push("(无)");
  } else {
    for (const ev of local.evidence) {
      lines.push(formatEvidence(ev));
    }
  }
  lines.push("");

  // 6. 已确定的图表列表
  lines.push("【已确定的图表列表】");
  if (local.charts.length === 0) {
    lines.push("(无)");
  } else {
    for (const c of local.charts) {
      lines.push(formatChartBrief(c));
    }
  }
  lines.push("");

  // 7. 截断与异常警告
  lines.push("【截断与异常警告】");
  const warns: string[] = [];
  if (
    ds.quality &&
    ds.quality.storedRowCount < ds.quality.originalRowCount
  ) {
    warns.push(
      `数据已截断:原始 ${ds.quality.originalRowCount} 行,载入 ${ds.quality.storedRowCount} 行,叙述必须使用"基于已载入数据"。`,
    );
  }
  for (const o of local.outliers) {
    if (o.detected && o.outlierCount > 0) {
      warns.push(
        `字段「${o.field}」检测到 ${o.outlierCount} 个统计异常(IQR),只能描述为"统计异常"。`,
      );
    }
  }
  if (warns.length === 0) lines.push("(无)");
  else warns.forEach((w) => lines.push(`- ${w}`));

  return lines.join("\n");
}

function formatQualitySummary(q: DataQualityReport): string {
  const parts: string[] = [];
  parts.push(`重复行=${q.duplicateRowCount}`);
  parts.push(`空行=${q.emptyRowCount}`);
  if (q.warnings.length > 0) {
    parts.push(
      `警告=${q.warnings.length}条: ` +
        q.warnings
          .slice(0, 5)
          .map((w) => `[${w.code}]${w.field ? `(${w.field})` : ""}`)
          .join(", "),
    );
  }
  return parts.join(" | ");
}

function formatEvidence(ev: AnalysisEvidence): string {
  const resultStr = JSON.stringify(ev.result);
  return `- [${ev.id}] ${ev.title} | 方法=${ev.method} | 样本=${ev.sampleSize} | 字段=[${ev.fields.join(",")}] | 结果=${resultStr}`;
}

function formatChartBrief(c: ChartSpec): string {
  const parts = [
    `id=${c.id}`,
    `标题=${c.title}`,
    `类型=${c.type}`,
    `xField=${c.xField}`,
    `yField=${c.yField}`,
    `agg=${c.agg}`,
  ];
  if (c.limit) parts.push(`limit=${c.limit}`);
  if (c.description) parts.push(`说明=${c.description}`);
  return `- ${parts.join(" | ")}`;
}

/* ------------------------- SPEC 12.2 输出 schema ------------------------- */

export const LLMInterpretationSchema = z.object({
  summary: z.string().min(1).max(200),
  narrative: z.string().min(1).max(2000),
  actions: z.array(z.string().min(1)).min(0).max(10),
  renamedChartTitles: z
    .record(z.string(), z.string().min(1).max(120))
    .optional(),
});

export type LLMInterpretationParsed = z.infer<typeof LLMInterpretationSchema>;

/** 校验 LLM 返回的 interpretation */
export function validateLLMInterpretation(
  raw: unknown,
): { ok: true; data: LLMInterpretationParsed } | { ok: false; error: string } {
  const r = LLMInterpretationSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    error: r.error.issues.map((i) => i.message).join("; "),
  };
}
