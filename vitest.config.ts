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
    // 需要 jsdom 的测试文件命名为 *.dom.test.tsx，并在文件顶部加：
    //   // @vitest-environment jsdom
    // （vitest 4 移除了 environmentMatchGlobs，改用文件级 pragma）
    // 测试共享同一个临时 DATA_DIR，部分用例会清理 datasets/ 目录。
    // 文件并行会在 saveJsonAtomic 的 rename 阶段产生竞态（ENOENT），
    // 因此强制串行执行，保证文件系统状态隔离。
    fileParallelism: false,
  },
});
