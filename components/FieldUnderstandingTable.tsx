"use client";

import type {
  DatasetUnderstanding,
  MeasureBehavior,
  SemanticAggregation,
  SemanticFieldRole,
  SemanticSubRole,
} from "@/lib/types";
import type { FieldUnderstandingChange } from "@/lib/api-client";

const ROLES: SemanticFieldRole[] = [
  "time",
  "dimension",
  "metric",
  "status",
  "identifier",
  "text",
  "ignored",
];
const BEHAVIORS: MeasureBehavior[] = [
  "flow",
  "stock",
  "rate",
  "duration",
  "score",
  "currency",
  "count",
  "unknown",
];
const SUBROLES: SemanticSubRole[] = [
  "actual",
  "target",
  "numerator",
  "denominator",
  "category_code",
  "category_label",
  "time_part",
  "unit",
  "none",
];
const AGGS: SemanticAggregation[] = [
  "sum",
  "avg",
  "count",
  "min",
  "max",
  "median",
  "last",
  "none",
];

const inputStyle: React.CSSProperties = {
  padding: "4px 6px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface, rgba(255,255,255,0.04))",
  color: "inherit",
  fontSize: 12,
  width: "100%",
};

/**
 * 字段语义表（SPEC 10.5）：用户可修改业务角色 / 指标行为 / 子角色 /
 * 建议聚合 / 业务含义。修改实时上报（不覆盖物理 ColumnMeta）。
 */
export default function FieldUnderstandingTable({
  fields,
  onChange,
}: {
  fields: DatasetUnderstanding["fields"];
  onChange: (changes: FieldUnderstandingChange[]) => void;
}) {
  function update(
    field: string,
    patch: Partial<DatasetUnderstanding["fields"][number]>,
  ) {
    onChange([{ field, changes: patch }]);
  }

  return (
    <div className="table-wrap fc-preview-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>字段</th>
            <th>业务角色</th>
            <th>指标行为</th>
            <th>子角色</th>
            <th>建议聚合</th>
            <th>业务含义</th>
            <th>置信度</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.field}>
              <td>
                <strong>{f.field}</strong>
                <div className="muted" style={{ fontSize: 11 }}>
                  {f.semanticName}
                </div>
              </td>
              <td>
                <select
                  style={inputStyle}
                  value={f.role}
                  onChange={(e) =>
                    update(f.field, { role: e.target.value as SemanticFieldRole })
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  style={inputStyle}
                  value={f.measureBehavior}
                  onChange={(e) =>
                    update(f.field, {
                      measureBehavior: e.target.value as MeasureBehavior,
                    })
                  }
                >
                  {BEHAVIORS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  style={inputStyle}
                  value={f.subRole}
                  onChange={(e) =>
                    update(f.field, {
                      subRole: e.target.value as SemanticSubRole,
                    })
                  }
                >
                  {SUBROLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  style={inputStyle}
                  value={f.recommendedAggregation}
                  onChange={(e) =>
                    update(f.field, {
                      recommendedAggregation: e.target
                        .value as SemanticAggregation,
                    })
                  }
                >
                  {AGGS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  style={inputStyle}
                  value={f.businessMeaning}
                  onChange={(e) =>
                    update(f.field, { businessMeaning: e.target.value })
                  }
                />
              </td>
              <td className="faint">{(f.confidence * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
