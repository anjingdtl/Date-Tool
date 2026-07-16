export default function AnalysisTimeline({
  events,
  active,
}: {
  events: string[];
  active: boolean;
}) {
  if (events.length === 0) return null;
  return (
    <div className="card agent-panel">
      <div className="row spread">
        <h3>编排时间线</h3>
        {active && <span className="badge"><span className="spinner" /> 进行中</span>}
      </div>
      <ol className="agent-timeline">
        {events.map((event, index) => (
          <li key={`${index}-${event}`}>{event}</li>
        ))}
      </ol>
    </div>
  );
}
