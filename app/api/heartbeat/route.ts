import { ok } from "@/lib/respond";
import {
  activeCount,
  ensureWatcher,
  getIdleMs,
  getLastSeen,
  listSessions,
  touch,
} from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getSessionId(req: Request): string | null {
  return (
    req.headers.get("x-session-id") ||
    req.headers.get("X-Session-Id") ||
    null
  );
}

/**
 * GET /api/heartbeat
 *   返回当前 idle 状态 + 活跃 session 数（前端自检 / 调试）
 */
export async function GET() {
  ensureWatcher();
  const alive = activeCount();
  return ok({
    lastSeen: getLastSeen(),
    idleMs: getIdleMs(),
    activeSessions: alive,
    sessions: listSessions(),
    now: Date.now(),
  });
}

/**
 * POST /api/heartbeat
 *   记录一次心跳。需要在 header 里带 X-Session-Id（浏览器每个标签页唯一）。
 *   静默消耗 body（sendBeacon 经常发 Blob）。
 */
export async function POST(req: Request) {
  ensureWatcher();
  const sid = getSessionId(req);
  if (sid) touch(sid);
  try {
    await req.arrayBuffer();
  } catch {
    /* ignore */
  }
  return ok({ ok: true, activeSessions: activeCount() });
}