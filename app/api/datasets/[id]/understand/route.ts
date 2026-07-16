import { NextRequest } from "next/server";
import {
  getDataset,
  getUnderstanding,
  isValidDatasetId,
  saveContext,
  saveUnderstanding,
} from "@/lib/store";
import { understandDataset } from "@/lib/semantic/understand-dataset";
import { newRequestId } from "@/lib/respond";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(
  status: number,
  title: string,
  detail: string,
  requestId: string,
): Response {
  return new Response(
    JSON.stringify({ title, status, detail, request_id: requestId }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * POST /api/datasets/{id}/understand（SSE，SPEC 18.1）。
 *
 * 触发 LLM 数据理解。事件：stage → understanding|ambiguity → done|error。
 * force=false 且已有有效 understanding 时直接复用，避免重复调用 LLM。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const requestId = newRequestId();
  if (!isValidDatasetId(params.id)) {
    return jsonResponse(400, "BAD_REQUEST", "数据集 ID 不是合法 UUID", requestId);
  }
  const ds = await getDataset(params.id);
  if (!ds) {
    return jsonResponse(404, "NOT_FOUND", "数据集不存在", requestId);
  }

  let body: { userDescription?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* 允许空 body */
  }
  const force = body.force === true;

  // 复用已有理解（非强制且已存在有效结果）
  if (!force) {
    const existing = await getUnderstanding(params.id);
    if (existing) {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const send = (event: string, data: unknown) =>
            controller.enqueue(
              enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          try {
            send("stage", { stage: "已有 AI 理解结果" });
            if (existing.status === "needs_user_input") {
              send("ambiguity", { understanding: existing });
            } else {
              send("understanding", { understanding: existing });
            }
            send("done", { status: existing.status });
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
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      try {
        send("stage", { stage: "正在构建数据上下文" });
        send("stage", { stage: "AI 正在理解数据" });
        logger.info("understanding_route_started", { requestId, datasetId: params.id });

        const result = await understandDataset(ds, requestId, {
          userDescription: body.userDescription,
          force,
        });

        if (result.understanding) {
          await saveUnderstanding(params.id, result.understanding);
          await saveContext(params.id, result.context);
          if (result.status === "needs_user_input") {
            send("ambiguity", { understanding: result.understanding });
          } else {
            send("understanding", { understanding: result.understanding });
          }
          send("done", { status: result.status });
        } else if (result.status === "fallback") {
          // LLM 未启用：正常返回 fallback，前端引导本地降级
          send("done", { status: "fallback" });
        } else {
          send("error", { message: result.error ?? "数据理解失败" });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "数据理解失败";
        logger.error("understanding_route_failed", {
          requestId,
          datasetId: params.id,
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
