/**
 * 服务端心跳 + 闲置自动关闭
 *
 * 设计：
 *   - 每个浏览器标签页（client component mount）生成一个 sessionId
 *   - 定时发心跳 POST /api/heartbeat 带 sessionId → 服务端记入 activeSessions
 *   - 浏览器关闭时 sendBeacon('/api/shutdown') 带 sessionId → 服务端从 activeSessions 移除
 *   - 只有 activeSessions 清空时，才真正退出（这样多标签不会被一个关掉）
 *   - 万一浏览器被强杀没机会发通知 → watcher 检查所有 session 都超过 IDLE_TIMEOUT_MS → 自动退出（兜底）
 *
 * 全局单例：HMR 不会重复启动 watcher。
 */

const HEARTBEAT_INTERVAL_MS = 30_000; // watcher 检查频率
const IDLE_TIMEOUT_MS = 5 * 60_000; // 5 分钟无活动自动关

declare global {
  // eslint-disable-next-line no-var
  var __activeSessions: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __heartbeatWatcher: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __lastSeenAt: number | undefined;
}

function sessions(): Map<string, number> {
  if (!globalThis.__activeSessions) globalThis.__activeSessions = new Map();
  return globalThis.__activeSessions;
}

export function touch(sessionId: string): void {
  const now = Date.now();
  sessions().set(sessionId, now);
  globalThis.__lastSeenAt = now;
}

export function release(sessionId: string): number {
  sessions().delete(sessionId);
  return sessions().size;
}

export function activeCount(): number {
  // 清理已超时的 session（不算活跃）
  const now = Date.now();
  let changed = false;
  for (const [id, t] of sessions().entries()) {
    if (now - t > IDLE_TIMEOUT_MS) {
      sessions().delete(id);
      changed = true;
    }
  }
  if (changed) globalThis.__lastSeenAt = now; // 触发下次 watcher
  return sessions().size;
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
    // 顺便清理过期 session（让 activeCount 准确）
    const alive = activeCount();
    if (alive === 0 && getLastSeen() > 0) {
      // 全部 session 都关了且超过一次心跳周期没新访问 → 退出
      const idle = getIdleMs();
      if (idle > HEARTBEAT_INTERVAL_MS) {
        // eslint-disable-next-line no-console
        console.log(
          `[heartbeat] all sessions closed, idle ${Math.round(idle / 1000)}s, shutting down`,
        );
        setTimeout(() => process.exit(0), 200);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (typeof globalThis.__heartbeatWatcher.unref === "function") {
    globalThis.__heartbeatWatcher.unref();
  }
}

/**
 * 主动触发关闭。给前端 sendBeacon 用。
 * 延迟 300ms 让 sendBeacon 完成 + 响应刷回浏览器。
 */
export function gracefulShutdown(reason: string): void {
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