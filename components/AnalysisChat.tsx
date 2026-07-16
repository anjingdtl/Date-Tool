"use client";

import { useState } from "react";

export default function AnalysisChat({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const submit = async () => {
    const value = message.trim();
    if (!value || disabled) return;
    await onSend(value);
    setMessage("");
  };
  return (
    <div className="card agent-panel">
      <h3>自然语言微调</h3>
      <p className="muted agent-help">
        例如：只看南宁市；把趋势改成按月；删除某张图；按区县展示收入完成率。
      </p>
      <textarea
        className="form-input agent-textarea"
        value={message}
        maxLength={4000}
        disabled={disabled}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="告诉我你想怎样调整当前分析…"
      />
      <div className="row spread" style={{ marginTop: 12 }}>
        <span className="muted">{message.length}/4000</span>
        <button className="btn btn-primary" disabled={disabled || !message.trim()} onClick={submit}>
          {disabled ? "处理中…" : "应用修改"}
        </button>
      </div>
    </div>
  );
}
