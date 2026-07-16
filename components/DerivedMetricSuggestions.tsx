"use client";

import type { DatasetUnderstanding } from "@/lib/types";

/** 展示 AI 建议的派生指标（只读，需用户确认的会标注） */
export default function DerivedMetricSuggestions({
  derivedMetrics,
}: {
  derivedMetrics: DatasetUnderstanding["derivedMetrics"];
}) {
  if (derivedMetrics.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <p className="section-title" style={{ fontSize: 13, marginBottom: 6 }}>
        建议派生指标
      </p>
      <ul className="insight-list" style={{ marginBottom: 0 }}>
        {derivedMetrics.map((d) => (
          <li key={d.id}>
            · <strong>{d.name}</strong>：{d.description}
            {d.unit ? `（单位：${d.unit}）` : ""}
            {d.requiresUserConfirmation ? "（需确认）" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
