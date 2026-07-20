import { NextRequest } from "next/server";
import { applyUserFeedback } from "@/lib/orchestrator/apply-user-feedback";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { findSession, getDataset, getRevision, updateAnalysis } from "@/lib/store";
import { fail, newRequestId } from "@/lib/respond";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FeedbackBody {
  revisionId?: string;
  message?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const requestId = newRequestId();
  let body: FeedbackBody;
  let located: Awaited<ReturnType<typeof findSession>>;
  let dataset: Awaited<ReturnType<typeof getDataset>>;
  let baseRevision: Awaited<ReturnType<typeof getRevision>>;
  const { sessionId } = await params;
  try {
    try {
      body = (await request.json()) as FeedbackBody;
    } catch {
      throw new BadRequestError("请求体不是合法 JSON");
    }
    const message = body.message?.trim() ?? "";
    if (!message) throw new BadRequestError("修改要求不能为空");
    if (message.length > 4000) throw new BadRequestError("修改要求不能超过 4000 字符");
    if (!body.revisionId) throw new BadRequestError("缺少 revisionId");
    located = await findSession(sessionId);
    if (!located) throw new NotFoundError("分析 Session 不存在");
    if (located.session.activeRevisionId !== body.revisionId) {
      throw new ConflictError("当前 Revision 已变化，请刷新后重试", {
        activeRevisionId: located.session.activeRevisionId,
      });
    }
    dataset = await getDataset(located.datasetId);
    if (!dataset) throw new NotFoundError("数据集不存在");
    baseRevision = await getRevision(located.datasetId, sessionId, body.revisionId);
    if (!baseRevision) throw new NotFoundError("当前 Revision 不存在");
  } catch (err) {
    return fail(err, requestId);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        logger.info("feedback_received", {
          requestId,
          datasetId: located!.datasetId,
          sessionId,
          revisionId: baseRevision!.id,
        });
        const result = await applyUserFeedback({
          dataset: dataset!,
          session: located!.session,
          baseRevision: baseRevision!,
          message: body.message!.trim(),
          requestId,
          hooks: {
            onStage: (code, message) => send("stage", { code, message, stage: message }),
            onPlan: (plan) =>
              send("plan", {
                id: plan.id,
                taskCount: plan.tasks.length,
                objectives: plan.objectives,
              }),
            onTaskStarted: (task) =>
              send("task_started", { taskId: task.id, title: task.title }),
            onTaskCompleted: (task, execution) =>
              send("task_completed", {
                taskId: task.id,
                status: execution.status,
                evidenceCount: execution.evidence.length,
              }),
            onTaskFailed: (task, execution) =>
              send("task_failed", {
                taskId: task.id,
                status: execution.status,
                message: execution.warnings[0] ?? "任务执行失败",
              }),
            onReview: (review) =>
              send("review", {
                status: review.status,
                message: review.executiveSummary,
              }),
            onQuestion: (questions) => send("question", { questions }),
            onRevision: (revision) =>
              send("revision", {
                revisionId: revision.id,
                sequence: revision.sequence,
                source: revision.source,
                summary: revision.userInstruction,
              }),
            onNarrativeToken: (token) => send("token", { text: token }),
            onFinal: (finalResult) => send("final", finalResult),
          },
        });
        await updateAnalysis(located!.datasetId, result.finalResult);
        send("done", {
          provider: result.finalResult.provider,
          createdAt: result.finalResult.createdAt,
          revisionId: result.activeRevision.id,
          impact: result.impact,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "修改失败";
        logger.warn("feedback_patch_rejected", {
          requestId,
          sessionId,
          message,
        });
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
