"use client";

/** 理解流程的 UI 阶段（比持久化 status 更细，含运行态） */
export type UnderstandingPhase =
  | "idle"
  | "loading"
  | "ready"
  | "needs_input"
  | "confirmed"
  | "failed"
  | "fallback";

const MAP: Record<UnderstandingPhase, { label: string; muted: boolean }> = {
  idle: { label: "未开始", muted: true },
  loading: { label: "理解中", muted: false },
  ready: { label: "待确认", muted: false },
  needs_input: { label: "需澄清", muted: false },
  confirmed: { label: "已确认", muted: false },
  failed: { label: "失败", muted: true },
  fallback: { label: "本地模式", muted: true },
};

export default function UnderstandingStatus({
  phase,
}: {
  phase: UnderstandingPhase;
}) {
  const m = MAP[phase] ?? MAP.idle;
  return <span className={`badge ${m.muted ? "muted" : ""}`}>{m.label}</span>;
}
