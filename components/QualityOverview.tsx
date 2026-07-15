"use client";

import { useMemo } from "react";
import type { DataQualityReport, DataQualityWarning } from "@/lib/types";

interface Props {
  quality?: DataQualityReport;
}

interface Metric {
  label: string;
  value: number;
  hint?: string;
  level: "ok" | "warn" | "danger";
}

function levelFor(value: number, warn: number, danger: number): Metric["level"] {
  if (value >= danger) return "danger";
  if (value >= warn) return "warn";
  return "ok";
}

export default function QualityOverview({ quality }: Props) {
  const metrics = useMemo<Metric[]>(() => {
    if (!quality) return [];
    const warnings: DataQualityWarning[] = quality.warnings ?? [];

    const nullWarnCount = warnings.filter(
      (w) => w.code === "EMPTY_COLUMN" || w.code === "HIGH_NULL_RATE",
    ).length;
    const mixedCount = warnings.filter((w) => w.code === "MIXED_TYPE").length;
    const highCardCount = warnings.filter(
      (w) => w.code === "HIGH_CARDINALITY",
    ).length;
    const duplicateRows = quality.duplicateRowCount ?? 0;
    const emptyRows = quality.emptyRowCount ?? 0;

    return [
      {
        label: "重复行",
        value: duplicateRows,
        hint: duplicateRows > 0 ? "建议在导入前清理" : undefined,
        level: levelFor(duplicateRows, 1, 10),
      },
      {
        label: "空行",
        value: emptyRows,
        hint: emptyRows > 0 ? "已自动跳过" : undefined,
        level: levelFor(emptyRows, 1, 10),
      },
      {
        label: "空值/高空字段",
        value: nullWarnCount,
        hint: nullWarnCount > 0 ? "可考虑忽略或填充" : undefined,
        level: levelFor(nullWarnCount, 1, 3),
      },
      {
        label: "混合类型字段",
        value: mixedCount,
        hint: mixedCount > 0 ? "建议手动指定类型" : undefined,
        level: levelFor(mixedCount, 1, 3),
      },
      {
        label: "高基数字段",
        value: highCardCount,
        hint:
          highCardCount > 0 ? "可能不适合作为分组维度" : undefined,
        level: levelFor(highCardCount, 1, 5),
      },
    ];
  }, [quality]);

  if (!quality) {
    return (
      <div className="card">
        <p className="section-title">数据质量概览</p>
        <p className="muted">暂无质量报告。</p>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="section-title">数据质量概览</p>
      <div className="grid fc-quality-grid">
        {metrics.map((m) => (
          <div key={m.label} className={`fc-metric fc-metric-${m.level}`}>
            <div className="fc-metric-value">{m.value}</div>
            <div className="fc-metric-label">{m.label}</div>
            {m.hint && <div className="fc-metric-hint">{m.hint}</div>}
          </div>
        ))}
      </div>

      {quality.warnings.length > 0 && (
        <div className="fc-warning-list">
          <p className="fc-warning-title">详细警告</p>
          <ul>
            {quality.warnings.slice(0, 8).map((w, i) => (
              <li key={i} className={`fc-w-item fc-w-${w.level}`}>
                <span className="fc-w-code">{w.code}</span>
                <span className="fc-w-msg">{w.message}</span>
              </li>
            ))}
            {quality.warnings.length > 8 && (
              <li className="fc-w-more">
                …还有 {quality.warnings.length - 8} 条
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
