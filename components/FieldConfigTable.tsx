"use client";

import { useMemo } from "react";
import type {
  Aggregation,
  ColumnMeta,
  FieldFormat,
  FieldRole,
} from "@/lib/types";
import type { FieldConfigIssue } from "@/lib/schemas/dataset";

/** 表内可编辑的字段配置（ColumnMeta 子集 + 编辑态） */
export interface EditableField {
  name: string;
  originalName?: string;
  type: ColumnMeta["type"];
  role: FieldRole;
  format: FieldFormat;
  defaultAggregation: Aggregation;
  includeInAnalysis: boolean;
  sampleValues: unknown[];
  confidence?: number;
  nullRate?: number;
  distinctCount?: number;
}

interface Props {
  fields: EditableField[];
  onChange: (next: EditableField[]) => void;
  /** 服务端返回的 issues，用于行级高亮 */
  issues?: FieldConfigIssue[];
}

const TYPE_OPTIONS: ColumnMeta["type"][] = [
  "number",
  "string",
  "date",
  "boolean",
];

const ROLE_OPTIONS: FieldRole[] = [
  "time",
  "metric",
  "dimension",
  "status",
  "identifier",
  "ignored",
];

const FORMAT_OPTIONS: FieldFormat[] = [
  "plain",
  "integer",
  "decimal",
  "percentage",
  "currency",
  "duration",
  "date",
  "datetime",
];

const AGG_OPTIONS: Aggregation[] = ["sum", "avg", "count", "max", "min"];

const ROLE_LABEL: Record<FieldRole, string> = {
  time: "时间",
  metric: "指标",
  dimension: "维度",
  status: "状态",
  identifier: "标识",
  ignored: "忽略",
};

const FORMAT_LABEL: Record<FieldFormat, string> = {
  plain: "文本",
  integer: "整数",
  decimal: "小数",
  percentage: "百分比",
  currency: "金额",
  duration: "时长",
  date: "日期",
  datetime: "日期时间",
};

const TYPE_LABEL: Record<ColumnMeta["type"], string> = {
  number: "数字",
  string: "文本",
  date: "日期",
  boolean: "布尔",
};

const AGG_LABEL: Record<Aggregation, string> = {
  sum: "求和",
  avg: "均值",
  count: "计数",
  max: "最大",
  min: "最小",
};

function sampleToStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export default function FieldConfigTable({
  fields,
  onChange,
  issues = [],
}: Props) {
  // 字段名 → 该字段的 issues（用于行高亮）
  const issueMap = useMemo(() => {
    const m = new Map<string, FieldConfigIssue[]>();
    for (const i of issues) {
      if (!i.field) continue;
      const arr = m.get(i.field) ?? [];
      arr.push(i);
      m.set(i.field, arr);
    }
    return m;
  }, [issues]);

  function update(idx: number, patch: Partial<EditableField>) {
    const next = fields.map((f, i) =>
      i === idx ? { ...f, ...patch } : f,
    );
    onChange(next);
  }

  if (fields.length === 0) {
    return (
      <div className="empty">没有可配置的字段，请检查文件是否为空。</div>
    );
  }

  return (
    <div className="table-wrap" style={{ maxHeight: "none" }}>
      <table className="data fc-table">
        <thead>
          <tr>
            <th>字段名</th>
            <th>样例</th>
            <th>类型</th>
            <th>角色</th>
            <th>格式</th>
            <th>聚合</th>
            <th>置信度</th>
            <th>参与分析</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f, idx) => {
            const fieldIssues = issueMap.get(f.name) ?? [];
            const hasError = fieldIssues.some((i) => i.level === "error");
            return (
              <tr
                key={`${f.name}-${idx}`}
                className={hasError ? "fc-row-error" : ""}
              >
                <td>
                  <div className="fc-name">{f.name}</div>
                  {f.originalName && f.originalName !== f.name && (
                    <div className="fc-orig">原: {f.originalName}</div>
                  )}
                  {fieldIssues.length > 0 && (
                    <ul className="fc-issues">
                      {fieldIssues.map((i, ii) => (
                        <li
                          key={ii}
                          className={
                            i.level === "error" ? "fc-err" : "fc-warn"
                          }
                        >
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="fc-sample">
                  {f.sampleValues.slice(0, 2).map((v, i) => (
                    <div key={i}>{sampleToStr(v)}</div>
                  ))}
                  {f.sampleValues.length === 0 && (
                    <span className="faint">（无样例）</span>
                  )}
                </td>
                <td>
                  <select
                    className="form-input fc-select"
                    value={f.type}
                    onChange={(e) =>
                      update(idx, {
                        type: e.target.value as ColumnMeta["type"],
                      })
                    }
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="form-input fc-select"
                    value={f.role}
                    onChange={(e) =>
                      update(idx, {
                        role: e.target.value as FieldRole,
                      })
                    }
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="form-input fc-select"
                    value={f.format}
                    onChange={(e) =>
                      update(idx, {
                        format: e.target.value as FieldFormat,
                      })
                    }
                  >
                    {FORMAT_OPTIONS.map((fmt) => (
                      <option key={fmt} value={fmt}>
                        {FORMAT_LABEL[fmt]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="form-input fc-select"
                    value={f.defaultAggregation}
                    onChange={(e) =>
                      update(idx, {
                        defaultAggregation: e.target.value as Aggregation,
                      })
                    }
                  >
                    {AGG_OPTIONS.map((a) => (
                      <option key={a} value={a}>
                        {AGG_LABEL[a]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="fc-conf">
                  {f.confidence !== undefined
                    ? `${(f.confidence * 100).toFixed(0)}%`
                    : "—"}
                  {f.nullRate !== undefined && f.nullRate > 0 && (
                    <div className="fc-nullrate">
                      空 {(f.nullRate * 100).toFixed(0)}%
                    </div>
                  )}
                </td>
                <td>
                  <label className="fc-check">
                    <input
                      type="checkbox"
                      checked={f.includeInAnalysis}
                      onChange={(e) =>
                        update(idx, { includeInAnalysis: e.target.checked })
                      }
                    />
                    <span>{f.includeInAnalysis ? "纳入" : "排除"}</span>
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
