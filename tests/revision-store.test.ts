import { describe, it, expect } from "vitest";
import {
  saveSession,
  getSession,
  listSessions,
  saveRevision,
  getRevision,
  listRevisions,
} from "@/lib/store";
import { restoreHistoricalRevision } from "@/lib/conversation/revision-history";
import { makeKpiUnderstanding } from "./executor-fixtures";
import type {
  AnalysisPlan,
  AnalysisRevision,
  AnalysisSession,
} from "@/lib/types";

const datasetId = "6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a";

function session(id: string, createdAt: string): AnalysisSession {
  return {
    id,
    datasetId,
    status: "completed",
    activeRevisionId: "rev_1",
    revisionIds: ["rev_1"],
    createdAt,
    updatedAt: createdAt,
  };
}

function plan(): AnalysisPlan {
  return {
    version: "v1",
    id: "plan_1",
    datasetId,
    understandingId: "und",
    objectives: [],
    assumptions: [],
    tasks: [],
    dashboard: { items: [], sections: [] },
    questionsForUser: [],
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

function revision(id: string, seq: number, sessionId = "sess_1"): AnalysisRevision {
  return {
    id,
    sessionId,
    sequence: seq,
    status: "approved",
    source: "initial",
    understandingSnapshot: makeKpiUnderstanding(),
    plan: plan(),
    execution: null,
    review: null,
    finalResult: null,
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("Session/Revision store - SPEC 19.1", () => {
  it("saveSession + getSession", async () => {
    const s = session("sess_a", "2026-07-16T01:00:00.000Z");
    await saveSession(datasetId, s);
    const got = await getSession(datasetId, "sess_a");
    expect(got).not.toBeNull();
    expect(got!.id).toBe("sess_a");
    expect(got!.datasetId).toBe(datasetId);
  });

  it("getSession 不存在 → null", async () => {
    const got = await getSession(datasetId, "sess_nonexistent");
    expect(got).toBeNull();
  });

  it("listSessions 按 createdAt 升序", async () => {
    await saveSession(datasetId, session("sess_b", "2026-07-16T03:00:00.000Z"));
    await saveSession(datasetId, session("sess_c", "2026-07-16T02:00:00.000Z"));
    const list = await listSessions(datasetId);
    const times = list.map((s) => s.createdAt);
    expect(times).toEqual([...times].sort());
  });

  it("saveRevision + getRevision", async () => {
    await saveSession(datasetId, session("sess_r", "2026-07-16T01:00:00.000Z"));
    const r = revision("rev_1", 1, "sess_r");
    await saveRevision(datasetId, "sess_r", r);
    const got = await getRevision(datasetId, "sess_r", "rev_1");
    expect(got).not.toBeNull();
    expect(got!.sequence).toBe(1);
  });

  it("listRevisions 按 sequence 升序", async () => {
    await saveSession(datasetId, session("sess_r2", "2026-07-16T01:00:00.000Z"));
    await saveRevision(datasetId, "sess_r2", revision("rev_a", 2, "sess_r2"));
    await saveRevision(datasetId, "sess_r2", revision("rev_b", 1, "sess_r2"));
    const list = await listRevisions(datasetId, "sess_r2");
    const seqs = list.map((r) => r.sequence);
    expect(seqs).toEqual([1, 2]);
  });

  it("拒绝 Session/Revision 路径穿越标识", async () => {
    await expect(
      saveSession(datasetId, session("../escape", "2026-07-16T04:00:00.000Z")),
    ).rejects.toThrow(/会话标识/);
    expect(await getSession(datasetId, "../escape")).toBeNull();
    expect(await getRevision(datasetId, "sess_r", "../escape")).toBeNull();
  });

  it("恢复历史版本会创建新 Revision，不删除后续历史", async () => {
    const restoreDatasetId = "6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b";
    const s = { ...session("sess_restore", "2026-07-16T05:00:00.000Z"), datasetId: restoreDatasetId };
    const target = {
      ...revision("rev_original", 1, "sess_restore"),
      understandingSnapshot: { ...makeKpiUnderstanding(), datasetId: restoreDatasetId },
      finalResult: {
        provider: "local+llm" as const,
        summary: "历史结果",
        insights: [],
        charts: [],
        options: [],
        narrative: "",
        createdAt: "2026-07-16T05:00:00.000Z",
        version: "v0.3.0" as const,
        analysisMode: "llm_orchestrated" as const,
        reviewStatus: "approved" as const,
      },
      execution: { results: {}, taskOrder: [], cacheHits: 0, durationMs: 0 },
    };
    s.activeRevisionId = target.id;
    s.revisionIds = [target.id];
    await saveRevision(restoreDatasetId, s.id, target);
    await saveSession(restoreDatasetId, s);
    const restored = await restoreHistoricalRevision({
      datasetId: restoreDatasetId,
      session: s,
      target,
      revisions: [target],
    });
    expect(restored.revision.id).not.toBe(target.id);
    expect(restored.revision.parentRevisionId).toBe(target.id);
    expect(restored.revision.sequence).toBe(2);
    const all = await listRevisions(restoreDatasetId, s.id);
    expect(all.map((item) => item.id)).toContain(target.id);
    expect(all).toHaveLength(2);
    expect((await getSession(restoreDatasetId, s.id))?.activeRevisionId).toBe(restored.revision.id);
  });
});
