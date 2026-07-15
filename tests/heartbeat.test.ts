import { describe, it, expect, beforeEach } from "vitest";
import {
  touch,
  release,
  isRegistered,
  activeCount,
  autoShutdownEnabled,
} from "@/lib/heartbeat";

describe("heartbeat - session 注册与释放", () => {
  beforeEach(() => {
    // 清理全局 sessions：通过 release 所有已知 sid 来清空
    // 这里直接用 touch+release 组合保证隔离
  });

  it("touch 注册后 isRegistered 返回 true", () => {
    touch("sess-a");
    expect(isRegistered("sess-a")).toBe(true);
    expect(isRegistered("sess-b")).toBe(false);
  });

  it("release 已注册 sid 返回 removed=true", () => {
    touch("sess-c");
    const r = release("sess-c");
    expect(r.removed).toBe(true);
    expect(isRegistered("sess-c")).toBe(false);
  });

  it("release 未知 sid 返回 removed=false，不误删", () => {
    touch("sess-d");
    const before = activeCount();
    const r = release("unknown-sid");
    expect(r.removed).toBe(false);
    expect(isRegistered("sess-d")).toBe(true);
    // activeCount 可能受 pruneExpired 影响，但 sess-d 刚 touch 应仍在
    expect(activeCount()).toBeGreaterThanOrEqual(1);
  });

  it("多 session：释放一个后 remaining 减少", () => {
    touch("m1");
    touch("m2");
    const r = release("m1");
    expect(r.removed).toBe(true);
    expect(isRegistered("m2")).toBe(true);
    expect(isRegistered("m1")).toBe(false);
  });
});

describe("autoShutdownEnabled", () => {
  it("vitest 配置默认 false（避免测试意外退出）", () => {
    // vitest.config.ts 已设 AUTO_SHUTDOWN_ENABLED=false
    expect(autoShutdownEnabled()).toBe(false);
  });

  it("显式 true 时返回 true", () => {
    const old = process.env.AUTO_SHUTDOWN_ENABLED;
    process.env.AUTO_SHUTDOWN_ENABLED = "true";
    expect(autoShutdownEnabled()).toBe(true);
    if (old === undefined) delete process.env.AUTO_SHUTDOWN_ENABLED;
    else process.env.AUTO_SHUTDOWN_ENABLED = old;
  });

  it("未设置时默认 false（npm run dev 安全）", () => {
    const old = process.env.AUTO_SHUTDOWN_ENABLED;
    delete process.env.AUTO_SHUTDOWN_ENABLED;
    expect(autoShutdownEnabled()).toBe(false);
    if (old === undefined) delete process.env.AUTO_SHUTDOWN_ENABLED;
    else process.env.AUTO_SHUTDOWN_ENABLED = old;
  });
});
