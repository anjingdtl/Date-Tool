import type { ReviewStatus } from "@/lib/types";

export default function ReviewPanel({
  status,
  questions,
}: {
  status?: ReviewStatus;
  questions: string[];
}) {
  if (!status && questions.length === 0) return null;
  const label =
    status === "approved"
      ? "终审通过"
      : status === "approved_with_warnings"
        ? "带提示通过"
        : status === "needs_user_input"
          ? "需要你的确认"
          : "终审不可用";
  return (
    <div className="card agent-panel">
      <div className="row spread">
        <h3>AI 终审</h3>
        <span className="badge">{label}</span>
      </div>
      {questions.length > 0 && (
        <div className="banner warn" style={{ marginTop: 12, marginBottom: 0 }}>
          {questions.map((question) => <div key={question}>• {question}</div>)}
        </div>
      )}
    </div>
  );
}
