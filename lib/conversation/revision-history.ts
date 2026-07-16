import type { AnalysisRevision, AnalysisSession } from "@/lib/types";
import { randomUUID } from "crypto";
import { saveRevision, saveSession, saveUnderstanding } from "@/lib/store";

export function nextRevisionSequence(revisions: AnalysisRevision[]): number {
  return revisions.reduce((max, revision) => Math.max(max, revision.sequence), 0) + 1;
}

export function previousRevisionId(
  session: AnalysisSession,
  revisions: AnalysisRevision[],
): string | null {
  const active = revisions.find((revision) => revision.id === session.activeRevisionId);
  if (!active) return null;
  return active.parentRevisionId ?? null;
}

export function revisionSummary(revision: AnalysisRevision): string {
  if (revision.userInstruction) return revision.userInstruction;
  if (revision.source === "review") return "AI 终审追加修订";
  return "初始分析计划";
}

export async function restoreHistoricalRevision(args: {
  datasetId: string;
  session: AnalysisSession;
  target: AnalysisRevision;
  revisions: AnalysisRevision[];
}): Promise<{ session: AnalysisSession; revision: AnalysisRevision }> {
  if (!args.target.execution || !args.target.finalResult) {
    throw new Error("目标 Revision 没有可恢复的完整结果");
  }
  const revisionId = `rev_${randomUUID().slice(0, 12)}`;
  const createdAt = new Date().toISOString();
  const finalResult = {
    ...args.target.finalResult,
    sessionId: args.session.id,
    revisionId,
    createdAt,
  };
  const revision: AnalysisRevision = {
    ...args.target,
    id: revisionId,
    parentRevisionId: args.session.activeRevisionId,
    sequence: nextRevisionSequence(args.revisions),
    status: args.target.finalResult.reviewStatus === "needs_user_input" ? "needs_user_input" : "approved",
    source: "user",
    userInstruction: `恢复到 Revision #${args.target.sequence}`,
    finalResult,
    createdAt,
  };
  const session: AnalysisSession = {
    ...args.session,
    activeRevisionId: revision.id,
    revisionIds: [...args.session.revisionIds, revision.id],
    status: revision.status === "needs_user_input" ? "needs_user_input" : "completed",
    updatedAt: createdAt,
  };
  await saveRevision(args.datasetId, session.id, revision);
  await saveUnderstanding(args.datasetId, revision.understandingSnapshot);
  await saveSession(args.datasetId, session);
  return { session, revision };
}
