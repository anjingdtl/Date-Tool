export default function InsightPanel({
  summary,
  insights,
  narrative,
  streaming,
  provider,
}: {
  summary: string;
  insights: string[];
  narrative: string;
  streaming: boolean;
  provider?: "local" | "local+llm" | "mock" | "llm";
}) {
  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <p className="section-title" style={{ margin: 0 }}>
          占卜师解读
        </p>
        {provider && (
          <span className={`badge ${provider === "llm" ? "" : "muted"}`}>
            {provider === "llm" ? "LLM 实时分析" : "本地 Mock 分析"}
          </span>
        )}
      </div>

      {summary && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          {summary}
        </div>
      )}

      {insights.length > 0 && (
        <ul className="insight-list" style={{ marginBottom: 18 }}>
          {insights.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}

      {narrative && (
        <div className={`narrative ${streaming ? "cursor" : ""}`}>
          {narrative}
        </div>
      )}
    </div>
  );
}
