"use client";

import type { RevisionListItem } from "@/lib/api-client";

export default function RevisionHistory({
  revisions,
  busy,
  onRestore,
}: {
  revisions: RevisionListItem[];
  busy: boolean;
  onRestore: (revisionId: string) => Promise<void>;
}) {
  if (revisions.length === 0) return null;
  const active = revisions.find((revision) => revision.isActive);
  return (
    <div className="card agent-panel">
      <div className="row spread">
        <h3>Revision 历史</h3>
        {active?.parentRevisionId && (
          <button className="btn" disabled={busy} onClick={() => onRestore(active.parentRevisionId!)}>
            撤销最近一次
          </button>
        )}
      </div>
      <div className="revision-list">
        {[...revisions].reverse().map((revision) => (
          <div className="revision-item" key={revision.id}>
            <div>
              <div className="row">
                <strong>#{revision.sequence}</strong>
                <span className="badge muted">{revision.source}</span>
                {revision.isActive && <span className="badge">当前</span>}
              </div>
              <div className="muted agent-help">{revision.summary}</div>
            </div>
            {!revision.isActive && (
              <button className="btn" disabled={busy} onClick={() => onRestore(revision.id)}>
                恢复
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
