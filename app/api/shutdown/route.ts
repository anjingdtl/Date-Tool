import { ensureWatcher, gracefulShutdown, release, activeCount } from "@/lib/heartbeat";
import { ok } from "@/lib/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getSessionId(req: Request): Promise<string | null> {
  const fromHeader =
    req.headers.get("x-session-id") || req.headers.get("X-Session-Id");
  if (fromHeader) return fromHeader;
  try {
    const text = await req.text();
    if (text) {
      const json = JSON.parse(text);
      if (json && typeof json.sessionId === "string") return json.sessionId;
    }
  } catch {
    /* ignore */
  }
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
 *   浏览器关闭时 sendBeacon 调用。
 *   - 还有其他 session：仅移除该 session
 *   - 最后一个已知 session 关闭：触发 gracefulShutdown
 *   - 未知 / 无 sessionId：不强制杀进程（避免误触）
 */
export async function POST(req: Request) {
  ensureWatcher();
  const sid = await getSessionId(req);

  if (!sid) {
    // 无 sid 的调用不当作“全关”——历史上这会导致任意 POST 直接杀进程
    return ok({ ok: true, remaining: activeCount(), ignored: true });
  }

  const { removed, remaining } = release(sid);
  if (removed && remaining === 0) {
    gracefulShutdown("all-sessions-closed");
    return new Response(JSON.stringify({ ok: true, remaining: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return ok({ ok: true, remaining, removed });
}
