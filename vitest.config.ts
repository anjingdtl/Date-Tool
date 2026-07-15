import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 涉及 document 的组件测试单独用 jsdom 环境文件级覆盖
    environmentMatchGlobs: [
      ["tests/**/*.dom.test.tsx", "jsdom"],
    ],
  },
});
