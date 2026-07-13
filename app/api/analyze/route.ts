import { NextRequest } from "next/server";
import { analyzeDataset } from "@/lib/analyzer";
import { getDataset, updateAnalysis } from "@/lib/store";
import { newRequestId } from "@/lib/respond";
import { logger } from "@/lib/logger";
import type { ChartSpec, EChartsOption } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const encoder = new TextEncoder();

  let body: { datasetId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ title: "BAD_REQUEST", status: 400, detail: "请求体不是合法 JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const datasetId = body.datasetId;
  if (!datasetId) {
    return new Response(
      JSON.stringify({ title: "BAD_REQUEST", status: 400, detail: "缺少 datasetId" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const ds = await getDataset(datasetId);
        if (!ds) {
          send("error", { message: "数据集不存在，可能已被删除" });
          controller.close();
          return;
        }

        const result = await analyzeDataset(ds, requestId, {
          onStructured: (p: {
            summary: string;
            insights: string[];
            charts: ChartSpec[];
            options: EChartsOption[];
          }) => send("result", p),
          onNarrativeToken: (token: string) => send("token", { text: token }),
        });

        await updateAnalysis(datasetId, result);
        send("done", { provider: result.provider, createdAt: result.createdAt });
        logger.info("analysis_completed", {
          requestId,
          datasetId,
          provider: result.provider,
          charts: result.charts.length,
        });
      } catch (err) {
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
