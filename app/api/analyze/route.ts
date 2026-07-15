import { NextRequest } from "next/server";
import { analyzeDataset } from "@/lib/analyzer";
import {
  getDataset,
  updateAnalysis,
  isValidDatasetId,
  setDatasetStatus,
} from "@/lib/store";
import { newRequestId } from "@/lib/respond";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 非 SSE 的 JSON 错误响应（状态机校验失败时返回） */
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

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const encoder = new TextEncoder();

  let body: { datasetId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      400,
      "BAD_REQUEST",
      "请求体不是合法 JSON",
      requestId,
    );
  }

  const datasetId = body.datasetId;
  if (!datasetId) {
    return jsonResponse(400, "BAD_REQUEST", "缺少 datasetId", requestId);
  }
  if (!isValidDatasetId(datasetId)) {
    return jsonResponse(
      400,
      "BAD_REQUEST",
      "数据集 ID 不是合法 UUID",
      requestId,
    );
  }

  // 状态机校验（SPEC 12.2）
  const ds = await getDataset(datasetId);
  if (!ds) {
    return jsonResponse(
      404,
      "NOT_FOUND",
      "数据集不存在，可能已被删除",
      requestId,
    );
  }
  if (ds.status === "draft") {
    return jsonResponse(
      409,
      "CONFLICT",
      "数据集尚未完成预检确认",
      requestId,
    );
  }
  if (ds.status === "analyzing") {
    return jsonResponse(
      409,
      "CONFLICT",
      "数据集正在分析，请勿重复提交",
      requestId,
    );
  }

  // 进入 analyzing（SPEC 12.3）
  await setDatasetStatus(datasetId, "analyzing");
  logger.info("analysis_started", { requestId, datasetId });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const result = await analyzeDataset(ds, requestId, {
          // SPEC 12.4: onStructured 透传 evidence/computedInsights/warnings/provider
          onStructured: (p) => send("result", p),
          onNarrativeToken: (token: string) => send("token", { text: token }),
          // SPEC 13.2: 分析阶段状态
          onStage: (stage: string) => send("stage", { stage }),
          // SPEC 9.2: 最终结果事件，前端据此整体刷新
          onFinal: (p) => send("final", p),
        });

        await updateAnalysis(datasetId, result); // 内部将 analyzing → completed
        send("done", { provider: result.provider, createdAt: result.createdAt });
        logger.info("analysis_completed", {
          requestId,
          datasetId,
          provider: result.provider,
          charts: result.charts.length,
        });
      } catch (err) {
        // 本地分析失败 → error（SPEC 12.3）；LLM 失败已在 analyzer 内回退，不会到此
        await setDatasetStatus(datasetId, "error");
        const message = err instanceof Error ? err.message : "分析失败";
        logger.error("analysis_failed", { requestId, datasetId, message });
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
