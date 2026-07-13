"use client";

import { useEffect, useRef } from "react";

/**
 * AutoShutdown —— 每个标签页独占一个 session
 *
 * 生命周期：
 *   1. 组件 mount → 用 crypto.randomUUID() 生成 sessionId（保留在 useRef，不变）
 *   2. 首次心跳 + 每 25 秒定时心跳（带 X-Session-Id）
 *   3. 页面卸载（beforeunload / pagehide / visibilitychange→hidden）
 *      → 用 navigator.sendBeacon 发 POST /api/shutdown（也带 X-Session-Id）
 *      → 服务端从活跃集移除该 session
 *
 * 多标签场景：每个标签独立的 sessionId，服务端只在所有 session 都关闭时退出
 */
export default function AutoShutdown() {
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    // 一次生成永不变化（即使 React 重新渲染）
    if (!sessionIdRef.current) {
      sessionIdRef.current = crypto.randomUUID();
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
      try {
        // 用 query 拼装 sessionId（最兼容 sendBeacon）
        const url = `/api/shutdown?sid=${encodeURIComponent(sid)}`;
        // sendBeacon 不能加 header，所以放 query；body 用空 Blob
        const blob = new Blob([], { type: "application/json" });
        const ok = navigator.sendBeacon(url, blob);
        if (!ok) {
          // 兜底：fetch keepalive + header
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

    const onBeforeUnload = () => notifyShutdown();
    const onPageHide = () => notifyShutdown();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") notifyShutdown();
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}