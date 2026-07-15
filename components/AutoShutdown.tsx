"use client";

import { useEffect, useRef } from "react";

/**
 * AutoShutdown —— 每个标签页独占一个 session
 *
 * 生命周期：
 *   1. 组件 mount → 生成 sessionId（useRef 固定）
 *   2. 首次心跳 + 每 25 秒定时心跳（Header: X-Session-Id）
 *   3. 页面真正卸载（pagehide / beforeunload）时 sendBeacon 通知服务端
 *
 * 注意：不要在 visibilitychange→hidden 时 shutdown。
 * 切标签 / 最小化 / 失焦都会触发 hidden，会导致服务被误杀。
 * 多标签：每个标签独立 sessionId，全部关闭后服务端才退出。
 */
export default function AutoShutdown() {
  const sessionIdRef = useRef<string>("");
  const shutOnceRef = useRef(false);

  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    const sid = sessionIdRef.current;

    const ping = () => {
      try {
        fetch("/api/heartbeat", {
          method: "POST",
          headers: { "X-Session-Id": sid },
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    ping();
    const intervalId = window.setInterval(ping, 25_000);

    const notifyShutdown = () => {
      if (shutOnceRef.current) return;
      shutOnceRef.current = true;
      try {
        // sendBeacon 不能自定义 header，sessionId 放 query
        const url = `/api/shutdown?sid=${encodeURIComponent(sid)}`;
        const blob = new Blob([], { type: "application/json" });
        const ok = navigator.sendBeacon(url, blob);
        if (!ok) {
          fetch("/api/shutdown", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Session-Id": sid,
            },
            keepalive: true,
            body: JSON.stringify({ sessionId: sid }),
          }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    };

    // pagehide：关闭标签 / 刷新 / 跳外站；比 beforeunload 更可靠（含移动端）
    // beforeunload：桌面浏览器关闭前兜底
    // 切勿监听 visibilitychange——切标签会误关服务
    window.addEventListener("pagehide", notifyShutdown);
    window.addEventListener("beforeunload", notifyShutdown);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", notifyShutdown);
      window.removeEventListener("beforeunload", notifyShutdown);
      // React Strict Mode 会模拟卸载：不要在 cleanup 里 shutdown
    };
  }, []);

  return null;
}
