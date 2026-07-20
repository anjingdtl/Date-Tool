import { NextRequest } from "next/server";
import { NotFoundError } from "@/lib/errors";
import { findSession, getRevision } from "@/lib/store";
import { fail, newRequestId, ok } from "@/lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; revisionId: string }> },
) {
  const requestId = newRequestId();
  try {
    const { sessionId, revisionId } = await params;
    const located = await findSession(sessionId);
    if (!located) throw new NotFoundError("分析 Session 不存在");
    const revision = await getRevision(
      located.datasetId,
      sessionId,
      revisionId,
    );
    if (!revision) throw new NotFoundError("Revision 不存在");
    return ok({ revision });
  } catch (err) {
    return fail(err, requestId);
  }
}
