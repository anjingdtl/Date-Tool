"use client";

import { useState } from "react";
import type {
  AnalysisEvidence,
  ComputedInsight,
} from "@/lib/types";

const METHOD_LABEL: Record<AnalysisEvidence["method"], string> = {
  summary: "基础统计",
  group_compare: "分组对比",
  trend: "时间趋势",
  top_bottom: "排名",
  status_distribution: "状态分布",
  missingness: "缺失分析",
  outlier: "异常值检测",
  change_rate: "变化率",
};

function providerLabel(p?: string): string {
  switch (p) {
    case "local":
      return "本地确定性分析";
    case "local+llm":
      return "本地计算 + LLM 解读";
    default:
      return "";
  }
}

function formatResult(result: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(result);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch {
    return "(无法序列化)";
  }
}

export default function InsightPanel({
  summary,
  insights,
  narrative,
  streaming,
  provider,
  stage,
  evidence,
  computedInsights,
  warnings,
}: {
  summary: string;
  insights: string[];
  narrative: string;
  streaming: boolean;
  provider?: "local" | "local+llm";
  /** v0.2 阶段 H：分析阶段状态(SPEC 13.2) */
  stage?: string;
  /** v0.2 阶段 H：计算依据(SPEC 10.8) */
  evidence?: AnalysisEvidence[];
  /** v0.2 阶段 H：本地确定性洞察(SPEC 10.8) */
  computedInsights?: ComputedInsight[];
  /** v0.2 阶段 H：数据警告(SPEC 8.8/10.7) */
  warnings?: string[];
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const evList = evidence ?? [];
  const warnList = warnings ?? [];
  const ciList = computedInsights ?? [];

  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <p className="section-title" style={{ margin: 0 }}>
          占卜师解读
        </p>
        {provider && (
          <span
            className={`badge ${provider === "local+llm" ? "" : "muted"}`}
          >
            {providerLabel(provider)}
          </span>
        )}
      </div>

      {/* 阶段状态：流式分析中显示当前阶段 */}
      {streaming && stage && (
        <div className="row" style={{ marginBottom: 12, gap: 8 }}>
          <span className="spinner" />
          <span className="muted">{stage}</span>
        </div>
      )}

      {summary && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          {summary}
        </div>
      )}

      {/* 数据警告 */}
      {warnList.length > 0 && (
        <div className="banner error" style={{ marginBottom: 16 }}>
          <strong>数据警告</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {warnList.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {insights.length > 0 && (
        <ul className="insight-list" style={{ marginBottom: 18 }}>
          {insights.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}

      {narrative && (
        <div className={`narrative ${streaming ? "cursor" : ""}`}>
          {narrative}
        </div>
      )}

      {/* 计算依据：可折叠面板(SPEC 27.1 每条洞察可查看计算依据) */}
      {evList.length > 0 && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 12, width: "100%" }}
            onClick={() => setShowEvidence((v) => !v)}
            aria-expanded={showEvidence}
          >
            {showEvidence ? "收起计算依据" : `查看计算依据（${evList.length} 条）`}
          </button>
          {showEvidence && (
            <div className="grid" style={{ gap: 10, marginTop: 10 }}>
              {evList.map((ev) => {
                const linked = ciList.filter((c) => c.evidenceId === ev.id);
                return (
                  <details
                    key={ev.id}
                    className="evidence-item"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: "var(--surface-2, rgba(255,255,255,0.03))",
                    }}
                  >
                    <summary style={{ cursor: "pointer" }}>
                      <strong>{ev.title}</strong>
                      <span
                        className="badge muted"
                        style={{ marginLeft: 8, fontSize: 11 }}
                      >
                        {METHOD_LABEL[ev.method]}
                      </span>
                      <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                        样本 {ev.sampleSize}
                      </span>
                    </summary>
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      {ev.description && (
                        <p className="muted" style={{ margin: "0 0 6px" }}>
                          {ev.description}
                        </p>
                      )}
                      {ev.fields.length > 0 && (
                        <p className="muted" style={{ margin: "0 0 6px" }}>
                          字段：{ev.fields.join("、")}
                        </p>
                      )}
                      <p
                        style={{
                          margin: "0 0 6px",
                          fontFamily:
                            "JetBrains Mono, SF Mono, Consolas, monospace",
                          fontSize: 12,
                          wordBreak: "break-all",
                        }}
                      >
                        {formatResult(ev.result)}
                      </p>
                      {linked.length > 0 && (
                        <p style={{ margin: 0, fontSize: 12 }}>
                          关联洞察：{linked.map((c) => c.title).join("；")}
                        </p>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
