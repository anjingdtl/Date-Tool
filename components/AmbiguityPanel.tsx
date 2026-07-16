"use client";

import type { DatasetUnderstanding } from "@/lib/types";

/**
 * 歧义面板（SPEC 10.5 / 20.1）。
 *
 * blocking ambiguity 必须处理：在下方字段表修正语义或选本地模式后才能确认。
 * 本组件只展示与提示；解答通过字段语义修改流转到 PUT /understanding。
 */
export default function AmbiguityPanel({
  ambiguities,
}: {
  ambiguities: DatasetUnderstanding["ambiguities"];
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
          <li key={a.id}>
            {a.blocking ? "[阻塞] " : ""}
            {a.question}
            <span className="muted" style={{ fontSize: 12 }}>
              （涉及：{a.fields.join("、")}）
            </span>
          </li>
        ))}
      </ul>
      {blocking.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          请在下方字段表中修正对应字段语义后保存；或选择「使用本地模式」直接生成看板。
        </p>
      )}
    </div>
  );
}
