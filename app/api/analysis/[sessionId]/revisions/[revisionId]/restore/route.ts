import { NextRequest } from "next/server";
import { NotFoundError } from "@/lib/errors";
import { restoreHistoricalRevision } from "@/lib/conversation/revision-history";
import {
  findSession,
  getRevision,
  listRevisions,
  updateAnalysis,
} from "@/lib/store";
import { fail, newRequestId, ok } from "@/lib/respond";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: { sessionId: string; revisionId: string } },
) {
  const requestId = newRequestId();
  try {
    const located = await findSession(params.sessionId);
    if (!located) throw new NotFoundError("分析 Session 不存在");
    const revisions = await listRevisions(located.datasetId, params.sessionId);
    const target = revisions.find((revision) => revision.id === params.revisionId);
    if (!target) throw new NotFoundError("待恢复的 Revision 不存在");
    const restored = await restoreHistoricalRevision({
      datasetId: located.datasetId,
      session: located.session,
      target,
      revisions,
    });
    if (restored.revision.finalResult) {
      await updateAnalysis(located.datasetId, restored.revision.finalResult);
    }
    logger.info("revision_activated", {
      requestId,
      datasetId: located.datasetId,
      sessionId: params.sessionId,
      revisionId: restored.revision.id,
      restoredFrom: target.id,
    });
    return ok({ session: restored.session, revision: restored.revision });
  } catch (err) {
    return fail(err, requestId);
  }
}
