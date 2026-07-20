import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/store", () => ({
  findSession: vi.fn(),
  getDataset: vi.fn(),
  getRevision: vi.fn(),
  updateAnalysis: vi.fn(async () => {}),
  acquireFeedbackLock: vi.fn(() => true),
  releaseFeedbackLock: vi.fn(),
}));
vi.mock("@/lib/orchestrator/apply-user-feedback", () => ({ applyUserFeedback: vi.fn() }));

import { POST } from "@/app/api/analysis/[sessionId]/feedback/route";
import { applyUserFeedback } from "@/lib/orchestrator/apply-user-feedback";
import { findSession, getDataset, getRevision, acquireFeedbackLock } from "@/lib/store";

function request(revisionId: string, message = "改标题"): NextRequest {
  return new NextRequest("http://localhost/api/analysis/s1/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revisionId, message }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findSession).mockResolvedValue({
    datasetId: "99999999-9999-4999-8999-999999999999",
    session: { id: "s1", datasetId: "d", status: "completed", activeRevisionId: "r2", revisionIds: ["r1", "r2"], createdAt: "x", updatedAt: "x" },
  });
  vi.mocked(getDataset).mockResolvedValue({ id: "d" } as never);
  vi.mocked(getRevision).mockResolvedValue({ id: "r2" } as never);
});

describe("反馈 Route", () => {
  it("stale baseRevisionId 返回 409，且不启动 Patch", async () => {
    const response = await POST(request("r1"), { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(409);
    expect(applyUserFeedback).not.toHaveBeenCalled();
  });

  it("输入超过 4000 字符返回 400", async () => {
    const response = await POST(request("r2", "x".repeat(4001)), { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(400);
    expect(applyUserFeedback).not.toHaveBeenCalled();
  });

  it("成功时发送 revision → final → done", async () => {
    vi.mocked(applyUserFeedback).mockImplementation(async (input) => {
      const finalResult = {
        provider: "local+llm", summary: "ok", insights: [], charts: [], options: [], narrative: "",
        createdAt: "2026-07-16T00:00:00.000Z", version: "v0.3.0", analysisMode: "llm_orchestrated",
      } as never;
      const revision = { id: "r3", sequence: 3, source: "user", userInstruction: "改标题" } as never;
      input.hooks.onRevision?.(revision);
      input.hooks.onFinal?.(finalResult);
      return {
        session: { id: "s1" }, activeRevision: revision, finalResult,
        impact: { presentationOnly: true, requiresPlanRebuild: false, affectedTaskIds: [], reusedTaskIds: ["t1"], reasons: [] },
      } as never;
    });
    const response = await POST(request("r2"), { params: Promise.resolve({ sessionId: "s1" }) });
    const text = await response.text();
    const events = [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
    expect(events).toEqual(["revision", "final", "done"]);
  });

  it("acquireFeedbackLock 返回 false 时立即 409，不启动 Patch", async () => {
    vi.mocked(acquireFeedbackLock).mockReturnValueOnce(false);
    const response = await POST(request("r2"), { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(409);
    expect(applyUserFeedback).not.toHaveBeenCalled();
  });
});
