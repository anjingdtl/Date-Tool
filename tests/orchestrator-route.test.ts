import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ fail: false }));

vi.mock("@/lib/store", () => ({
  getDataset: vi.fn(),
  updateAnalysis: vi.fn(async () => {}),
  isValidDatasetId: vi.fn(() => true),
  setDatasetStatus: vi.fn(async () => null),
}));
vi.mock("@/lib/analyzer", () => ({ analyzeDataset: vi.fn() }));

import { POST } from "@/app/api/analyze/route";
import { analyzeDataset } from "@/lib/analyzer";
import { getDataset } from "@/lib/store";
import type { FinalAnalysisResult } from "@/lib/types";

const datasetId = "88888888-8888-4888-8888-888888888888";

function request(): NextRequest {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datasetId, userGoal: "关注收入" }),
  });
}

async function events(response: Response): Promise<string[]> {
  const text = await response.text();
  return [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
}

beforeEach(() => {
  state.fail = false;
  vi.mocked(getDataset).mockResolvedValue({ id: datasetId, status: "ready" } as never);
  vi.mocked(analyzeDataset).mockReset();
  vi.mocked(analyzeDataset).mockImplementation(async (_dataset, _requestId, hooks) => {
    hooks.onStage?.("正在制订分析计划", "planning");
    hooks.onPlan?.({ id: "plan_1", tasks: [{ id: "t1" }], objectives: [] } as never);
    hooks.onTaskStarted?.({ id: "t1", title: "收入" } as never);
    if (state.fail) throw new Error("任务失败");
    hooks.onTaskCompleted?.(
      { id: "t1" } as never,
      { status: "success", evidence: [{ id: "ev1" }] } as never,
    );
    hooks.onStage?.("AI 正在终审结果", "reviewing");
    hooks.onReview?.({ status: "approved", executiveSummary: "通过" } as never);
    const final: FinalAnalysisResult = {
      provider: "local+llm",
      summary: "完成",
      insights: [],
      charts: [],
      options: [],
      narrative: "",
      createdAt: "2026-07-16T00:00:00.000Z",
      version: "v0.3.0",
      analysisMode: "llm_orchestrated",
    };
    hooks.onFinal?.(final);
    return final;
  });
});

describe("/api/analyze 编排 SSE", () => {
  it("真实 Route Handler 保持规定事件顺序", async () => {
    const sequence = await events(await POST(request()));
    expect(sequence).toEqual([
      "stage",
      "plan",
      "task_started",
      "task_completed",
      "stage",
      "review",
      "final",
      "done",
    ]);
  });

  it("error 后不发送 final/done", async () => {
    state.fail = true;
    const sequence = await events(await POST(request()));
    expect(sequence.at(-1)).toBe("error");
    expect(sequence).not.toContain("final");
    expect(sequence).not.toContain("done");
  });
});
