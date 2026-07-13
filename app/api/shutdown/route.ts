import { ensureWatcher, gracefulShutdown, release } from "@/lib/heartbeat";
import { ok } from "@/lib/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getSessionId(req: Request): Promise<string | null> {
  // 1) 优先从 header 读（普通 fetch 可以加）
  const fromHeader =
    req.headers.get("x-session-id") || req.headers.get("X-Session-Id");
  if (fromHeader) return fromHeader;
  // 2) 兜底从 body 读（sendBeacon 不能加 header）
  try {
    const text = await req.text();
    if (text) {
      const json = JSON.parse(text);
      if (json && typeof json.sessionId === "string") return json.sessionId;
    }
  } catch {
    /* ignore */
  }
  // 3) 最后从 query string 读（兼容 sendBeacon + query 拼装）
  try {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get("sid");
    if (fromQuery) return fromQuery;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * POST /api/shutdown
 *   浏览器关闭时 sendBeacon 调一下。带 X-Session-Id 或 body 里的 sessionId。
 *   - 还有其他 session 活跃：仅移除该 session，返回 remaining 数
 *   - 最后一个 session 关闭：触发 gracefulShutdown
 *   - 没有 sessionId：探测/异常调用，立即退出
 */
export async function POST(req: Request) {
  ensureWatcher();
  const sid = await getSessionId(req);
  if (!sid) {
    gracefulShutdown("no-session-shutdown");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const remaining = release(sid);
  if (remaining > 0) {
    return ok({ ok: true, remaining });
  }
  // 最后一个 session 关闭 → 退出
  gracefulShutdown("all-sessions-closed");
  return new Response(JSON.stringify({ ok: true, remaining: 0 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}