"use client";

import type { DatasetUnderstanding } from "@/lib/types";
import type { FieldUnderstandingChange } from "@/lib/api-client";

/**
 * 歧义面板（SPEC 10.5 / 20.1）。
 *
 * blocking ambiguity 必须处理：在下方字段表修正语义或选本地模式后才能确认。
 * 本组件只展示与提示；解答通过字段语义修改流转到 PUT /understanding。
 */
export default function AmbiguityPanel({
  ambiguities,
  pendingFields,
  onResolve,
}: {
  ambiguities: DatasetUnderstanding["ambiguities"];
  pendingFields: string[];
  onResolve: (
    ambiguityId: string,
    fieldChanges: FieldUnderstandingChange[],
  ) => Promise<void>;
}) {
  if (ambiguities.length === 0) return null;
  const blocking = ambiguities.filter((a) => a.blocking);
  const cls = blocking.length > 0 ? "error" : "warn";
  return (
    <div className={`banner ${cls}`} style={{ marginTop: 12 }}>
      <strong>
        {blocking.length > 0
          ? `有 ${blocking.length} 个需澄清的阻塞性问题`
          : "提示性问题"}
      </strong>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {ambiguities.map((a) => (
          <li key={a.id} style={{ marginBottom: 8 }}>
            {a.blocking ? "[阻塞] " : ""}
            {a.question}
            <span className="muted" style={{ fontSize: 12 }}>
              （涉及：{a.fields.join("、")}）
            </span>
            {a.blocking && a.choices && a.choices.length > 0 && (
              <div className="row" style={{ marginTop: 6 }}>
                {a.choices.map((choice) => {
                  const changes = choice.patch.map((item, index) => {
                    const field = item.field ?? a.fields[index] ?? a.fields[0];
                    const { field: _field, ...rest } = item;
                    void _field;
                    return { field, changes: rest };
                  });
                  return (
                    <button
                      type="button"
                      className="btn"
                      key={choice.id}
                      onClick={() => onResolve(a.id, changes)}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            )}
            {a.blocking && (!a.choices || a.choices.length === 0) && (
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={!a.fields.some((field) => pendingFields.includes(field))}
                  onClick={() => onResolve(a.id, [])}
                >
                  已在字段表中修正，标记为已处理
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {blocking.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          请选择建议答案，或在下方字段表中修正对应字段后标记为已处理。
        </p>
      )}
    </div>
  );
}
