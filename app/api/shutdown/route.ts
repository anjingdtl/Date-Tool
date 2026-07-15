import {
  autoShutdownEnabled,
  activeCount,
  ensureWatcher,
  gracefulShutdown,
  isRegistered,
  release,
} from "@/lib/heartbeat";
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
 *   - 缺少 sessionId：不退出（ignored）
 *   - 未知 / 未注册 sessionId：返回 400，不退出
 *   - 已注册且为最后一个 session：若启用 AUTO_SHUTDOWN 则退出，否则仅清空
 *   - 仍有其他 session：仅移除该 session
 */
export async function POST(req: Request) {
  ensureWatcher();
  const sid = await getSessionId(req);

  // 缺少 sessionId 不得立即退出
  if (!sid) {
    return ok({ ok: true, remaining: activeCount(), ignored: true });
  }

  // 只接受已注册的 sessionId；未知 sessionId 返回 400
  if (!isRegistered(sid)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "unknown session",
        remaining: activeCount(),
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const { removed, remaining } = release(sid);
  if (removed && remaining === 0) {
    if (autoShutdownEnabled()) {
      gracefulShutdown("all-sessions-closed");
      return new Response(
        JSON.stringify({ ok: true, remaining: 0, shuttingDown: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // 自动关闭被关闭：仅清空 session，不退出进程
    return ok({ ok: true, remaining: 0, autoShutdown: "disabled" });
  }

  return ok({ ok: true, remaining, removed });
}
