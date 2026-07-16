import { NextRequest } from "next/server";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { revisionSummary } from "@/lib/conversation/revision-history";
import { findSession, getRevision, listRevisions } from "@/lib/store";
import { fail, newRequestId, ok } from "@/lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const requestId = newRequestId();
  try {
    if (!params.sessionId) throw new BadRequestError("缺少 sessionId");
    const located = await findSession(params.sessionId);
    if (!located) throw new NotFoundError("分析 Session 不存在");
    const revisions = await listRevisions(located.datasetId, params.sessionId);
    const activeRevision = await getRevision(
      located.datasetId,
      params.sessionId,
      located.session.activeRevisionId,
    );
    return ok({
      session: located.session,
      activeRevision,
      revisions: revisions.map((revision) => ({
        id: revision.id,
        sequence: revision.sequence,
        status: revision.status,
        source: revision.source,
        parentRevisionId: revision.parentRevisionId,
        summary: revisionSummary(revision),
        createdAt: revision.createdAt,
        isActive: revision.id === located.session.activeRevisionId,
      })),
    });
  } catch (err) {
    return fail(err, requestId);
  }
}
