/**
 * 服务端心跳 + 闲置自动关闭
 *
 * 设计：
 *   - 每个浏览器标签页生成 sessionId，定时 POST /api/heartbeat
 *   - 浏览器关闭时 sendBeacon('/api/shutdown?sid=...') → 从 activeSessions 移除
 *   - 仅当 activeSessions 清空时真正退出（多标签安全）
 *   - 浏览器被强杀来不及通知 → watcher 发现全部 session 超时后自动退出
 *
 * 全局单例：HMR 不会重复启动 watcher。
 */

const HEARTBEAT_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 5 * 60_000; // 单 session 5 分钟无心跳视为失效
const EMPTY_GRACE_MS = 45_000; // 全部 session 清空后再等 45s，避免误杀

declare global {
  // eslint-disable-next-line no-var
  var __activeSessions: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __heartbeatWatcher: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __lastSeenAt: number | undefined;
  // eslint-disable-next-line no-var
  var __emptySince: number | undefined;
  // eslint-disable-next-line no-var
  var __shuttingDown: boolean | undefined;
}

function sessions(): Map<string, number> {
  if (!globalThis.__activeSessions) globalThis.__activeSessions = new Map();
  return globalThis.__activeSessions;
}

export function touch(sessionId: string): void {
  const now = Date.now();
  sessions().set(sessionId, now);
  globalThis.__lastSeenAt = now;
  globalThis.__emptySince = undefined;
}

/**
 * 移除 session。
 * - removed=false：sid 本就不在集合里（重复 beacon / 未知 sid），不应据此关机
 * - remaining：当前仍活跃数量
 */
export function release(sessionId: string): { removed: boolean; remaining: number } {
  const map = sessions();
  const removed = map.delete(sessionId);
  const remaining = pruneExpired();
  if (remaining === 0 && removed) {
    globalThis.__emptySince = globalThis.__emptySince ?? Date.now();
  }
  return { removed, remaining };
}

function pruneExpired(): number {
  const now = Date.now();
  const map = sessions();
  for (const [id, t] of map.entries()) {
    if (now - t > IDLE_TIMEOUT_MS) {
      map.delete(id);
    }
  }
  return map.size;
}

export function activeCount(): number {
  return pruneExpired();
}

export function getLastSeen(): number {
  return globalThis.__lastSeenAt ?? 0;
}

export function getIdleMs(): number {
  const last = getLastSeen();
  return last === 0 ? -1 : Date.now() - last;
}

/**
 * 确保 watcher 已启动（幂等）。每个进程最多一个 watcher。
 * 在 API 路由首次被访问时触发。
 */
export function ensureWatcher(): void {
  if (globalThis.__heartbeatWatcher) return;
  if (!globalThis.__lastSeenAt) globalThis.__lastSeenAt = Date.now();

  globalThis.__heartbeatWatcher = setInterval(() => {
    if (globalThis.__shuttingDown) return;

    const alive = pruneExpired();
    if (alive > 0) {
      globalThis.__emptySince = undefined;
      return;
    }

    // 从未有过任何 session（例如刚启动还没打开页面）→ 不关
    if (!globalThis.__lastSeenAt) return;

    const emptySince = globalThis.__emptySince ?? Date.now();
    if (!globalThis.__emptySince) globalThis.__emptySince = emptySince;

    if (Date.now() - emptySince > EMPTY_GRACE_MS) {
      // eslint-disable-next-line no-console
      console.log(
        `[heartbeat] no active sessions for ${Math.round((Date.now() - emptySince) / 1000)}s, shutting down`,
      );
      gracefulShutdown("idle-empty-sessions");
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (typeof globalThis.__heartbeatWatcher.unref === "function") {
    globalThis.__heartbeatWatcher.unref();
  }
}

/**
 * 主动触发关闭。延迟一点让响应刷回浏览器。
 */
export function gracefulShutdown(reason: string): void {
  if (globalThis.__shuttingDown) return;
  globalThis.__shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`[heartbeat] shutting down: ${reason}`);
  setTimeout(() => process.exit(0), 300);
}

/** 供调试用：列出当前所有活跃 session（脱敏） */
export function listSessions(): Array<{ id: string; lastSeen: number }> {
  return Array.from(sessions().entries()).map(([id, t]) => ({
    id: id.slice(0, 8) + "…",
    lastSeen: t,
  }));
}
