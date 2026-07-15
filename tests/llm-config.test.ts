/**
 * tests/llm-config.test.ts
 *
 * SPEC 6.6 / 18.3：统一运行时 LLM 配置解析（getActiveLLMConfig）。
 *
 * 覆盖：
 * - Case A：env 无 Key、settings.json 有 Key → enabled=true（进入 LLM 分支）
 * - Case B：env 有 Key、settings.json Key 为空 → 回退 env Key
 * - Case C：保存新 model → 下次读取使用新 model
 * - Case D：清空 API Key → enabled=false（provider=local）
 * - 热更新：保存后无需重启即生效（mtime 缓存失效）
 * - env baseUrl 回退
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { getActiveLLMConfig } from "@/lib/llm-config";
import {
  writeSettings,
  __resetSettingsCacheForTests,
} from "@/lib/settings";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "LLM_API_KEY",
  "OPENAI_BASE_URL",
  "LLM_BASE_URL",
  "OPENAI_MODEL",
  "LLM_MODEL",
];

let savedEnv: Record<string, string | undefined> = {};

function dataDir(): string {
  const raw = process.env.DATA_DIR || ".data";
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}
function settingsPath(): string {
  return path.join(dataDir(), "settings.json");
}

beforeEach(async () => {
  // 保存并清空所有 LLM 相关 env，确保只受 settings.json 控制
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  // 删除可能残留的 settings.json，强制下次读取走文件/默认分支
  await fs.unlink(settingsPath()).catch(() => {});
  __resetSettingsCacheForTests();
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await fs.unlink(settingsPath()).catch(() => {});
  __resetSettingsCacheForTests();
});

describe("getActiveLLMConfig - SPEC 6.6", () => {
  it("Case A: env 无 Key、settings.json 有 Key → enabled=true", async () => {
    await writeSettings({ llm: { apiKey: "sk-settings-abc" } });
    __resetSettingsCacheForTests();
    const c = await getActiveLLMConfig();
    expect(c.enabled).toBe(true);
    expect(c.apiKey).toBe("sk-settings-abc");
  });

  it("Case B: env 有 Key、settings.json Key 为空 → 回退 env Key", async () => {
    process.env.OPENAI_API_KEY = "sk-env-xyz";
    // 显式把 settings 的 apiKey 写空，使其回退到 env
    await writeSettings({ llm: { apiKey: "" } });
    __resetSettingsCacheForTests();
    const c = await getActiveLLMConfig();
    expect(c.apiKey).toBe("sk-env-xyz");
    expect(c.enabled).toBe(true);
  });

  it("Case C: 保存新 model → 下次读取使用新 model", async () => {
    await writeSettings({ llm: { apiKey: "k", model: "my-new-model" } });
    __resetSettingsCacheForTests();
    const c = await getActiveLLMConfig();
    expect(c.model).toBe("my-new-model");
  });

  it("Case D: 清空 API Key → enabled=false（provider=local）", async () => {
    // 先配置一个有效 key
    await writeSettings({ llm: { apiKey: "sk-will-clear" } });
    __resetSettingsCacheForTests();
    expect((await getActiveLLMConfig()).enabled).toBe(true);
    // 清空
    await writeSettings({ llm: { apiKey: "" } });
    __resetSettingsCacheForTests();
    const c = await getActiveLLMConfig();
    expect(c.enabled).toBe(false);
    expect(c.apiKey).toBe("");
  });

  it("热更新：保存后无需重启即生效（连续分析拿新值）", async () => {
    await writeSettings({ llm: { apiKey: "first", model: "m1" } });
    __resetSettingsCacheForTests();
    expect((await getActiveLLMConfig()).model).toBe("m1");

    await writeSettings({ llm: { model: "m2" } });
    // 不再手动 reset，模拟连续两次分析之间 settings.json 已变更
    expect((await getActiveLLMConfig()).model).toBe("m2");
  });

  it("env baseUrl 在 settings 为空时回退生效", async () => {
    process.env.OPENAI_BASE_URL = "https://env.example.com/v1";
    process.env.OPENAI_API_KEY = "sk-env";
    await writeSettings({ llm: { apiKey: "sk-env", baseUrl: "" } });
    __resetSettingsCacheForTests();
    const c = await getActiveLLMConfig();
    expect(c.baseUrl).toBe("https://env.example.com/v1");
    expect(c.enabled).toBe(true);
  });

  it("enabled 不沿用持久化旧 enabled：以当前 apiKey 为准", async () => {
    // 直接写入一个 enabled=true 但 apiKey 为空的非法 settings，验证不信任旧 enabled
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(
      settingsPath(),
      JSON.stringify({
        theme: "verdigris",
        llm: {
          provider: "MiniMax",
          baseUrl: "",
          apiKey: "",
          model: "m",
          enabled: true, // 伪造的旧 enabled
        },
      }),
      "utf-8",
    );
    __resetSettingsCacheForTests();
    const c = await getActiveLLMConfig();
    expect(c.apiKey).toBe("");
    // 即使持久化里写着 enabled=true，也必须按 apiKey 判定为未启用
    expect(c.enabled).toBe(false);
  });
});
