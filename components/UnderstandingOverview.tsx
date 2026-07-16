"use client";

import type { DatasetUnderstanding } from "@/lib/types";

/** 展示 AI 理解的数据集类型 / 结构 / 行粒度 / 业务描述 / 字段关系（只读） */
export default function UnderstandingOverview({
  understanding: u,
}: {
  understanding: DatasetUnderstanding;
}) {
  return (
    <div className="fc-summary">
      <div className="fc-summary-item">
        <p className="fc-summary-label">数据集类型</p>
        <div className="fc-summary-value">{u.datasetKind}</div>
      </div>
      <div className="fc-summary-item">
        <p className="fc-summary-label">表格结构</p>
        <div className="fc-summary-value">{u.tableShape}</div>
      </div>
      <div className="fc-summary-item">
        <p className="fc-summary-label">置信度</p>
        <div className="fc-summary-value">{(u.confidence * 100).toFixed(0)}%</div>
      </div>
      <div className="fc-summary-item">
        <p className="fc-summary-label">业务领域</p>
        <div className="fc-summary-value">{u.businessDomain}</div>
      </div>
      <div className="fc-summary-item" style={{ flexBasis: "100%" }}>
        <p className="fc-summary-label">行粒度</p>
        <div className="fc-summary-value">{u.grainDescription}</div>
      </div>
      <div className="fc-summary-item" style={{ flexBasis: "100%" }}>
        <p className="fc-summary-label">业务描述</p>
        <div className="fc-summary-value">{u.businessDescription}</div>
      </div>
      <div className="fc-summary-item" style={{ flexBasis: "100%" }}>
        <p className="fc-summary-label">行含义</p>
        <div className="fc-summary-value">{u.rowMeaning}</div>
      </div>
      {u.relationships.length > 0 && (
        <div className="fc-summary-item" style={{ flexBasis: "100%" }}>
          <p className="fc-summary-label">字段关系</p>
          <div className="fc-summary-value" style={{ fontSize: 13 }}>
            {u.relationships
              .map(
                (r) =>
                  `${r.fields.join(" ↔ ")}（${r.relation}）：${r.description}`,
              )
              .join("；")}
          </div>
        </div>
      )}
      {u.recommendedObjectives.length > 0 && (
        <div className="fc-summary-item" style={{ flexBasis: "100%" }}>
          <p className="fc-summary-label">建议分析目标</p>
          <div className="fc-summary-value" style={{ fontSize: 13 }}>
            {u.recommendedObjectives.join("、")}
          </div>
        </div>
      )}
    </div>
  );
}
