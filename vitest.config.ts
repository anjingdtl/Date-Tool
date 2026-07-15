import { defineConfig } from "vitest/config";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// 测试专用数据目录：在加载任何 @/lib/config 之前设置，确保 .data 不污染仓库
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "datatool-test-"));
}
// 测试默认关闭自动关闭，避免 heartbeat watcher 干扰
if (process.env.AUTO_SHUTDOWN_ENABLED === undefined) {
  process.env.AUTO_SHUTDOWN_ENABLED = "false";
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    environmentMatchGlobs: [
      ["tests/**/*.dom.test.tsx", "jsdom"],
    ],
  },
});
