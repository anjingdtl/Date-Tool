import { promises as fs } from "node:fs";
import path from "node:path";

/** 主题预设 id —— 与 globals.css 中 :root[data-theme="xxx"] 一一对应 */
export const THEMES = ["verdigris", "ocean", "sunset", "ink"] as const;
export type ThemeId = (typeof THEMES)[number];

export interface LLMSettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 用户是否启用 LLM 编排（未启用则走本地规则模式） */
  enabled: boolean;
}

export interface AppSettings {
  theme: ThemeId;
  llm: LLMSettings;
  privacy: {
    /** 是否允许把已脱敏的代表行样本发送给 LLM。 */
    sendRowSamples: boolean;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "verdigris",
  llm: {
    provider: "MiniMax",
    baseUrl: "",
    apiKey: "",
    model: "MiniMax-M3",
    enabled: false,
  },
  privacy: {
    sendRowSamples: true,
  },
};

function dataDir(): string {
  // 与 lib/config.ts 保持一致，避免数据集与 settings 落到不同目录
  const raw = process.env.DATA_DIR || ".data";
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function settingsPath(): string {
  return path.join(dataDir(), "settings.json");
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return patch as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] =
      v && typeof v === "object" && !Array.isArray(v)
        ? deepMerge((base as Record<string, unknown>)[k], v)
        : v;
  }
  return out as T;
}

let cache: { value: AppSettings; mtime: number } | null = null;

/** 读取设置（含本地 .data/settings.json 与 env 回退）。带 mtime 缓存。 */
export async function readSettings(): Promise<AppSettings> {
  const fp = settingsPath();
  try {
    const stat = await fs.stat(fp);
    if (cache && cache.mtime === stat.mtimeMs) return cache.value;
    const raw = await fs.readFile(fp, "utf-8");
    const parsed = JSON.parse(raw);
    const merged = deepMerge(DEFAULT_SETTINGS, parsed);
    // apiKey 为空 → 走 env 回退；并据此刷新 enabled 标记
    const envBase =
      process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "";
    const envKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
    const envModel =
      process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
    if (!merged.llm.baseUrl && envBase) merged.llm.baseUrl = envBase;
    if (!merged.llm.apiKey && envKey) merged.llm.apiKey = envKey;
    if (!merged.llm.model) merged.llm.model = envModel;
    merged.llm.enabled = merged.llm.apiKey.length > 0;
    cache = { value: merged, mtime: stat.mtimeMs };
    return merged;
  } catch {
    // 文件不存在 → 返回 env 兜底
    const envBase =
      process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL ||
      "https://api.openai.com/v1";
    const envKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
    const envModel =
      process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
    return {
      ...DEFAULT_SETTINGS,
      llm: {
        ...DEFAULT_SETTINGS.llm,
        baseUrl: envBase,
        apiKey: envKey,
        model: envModel,
        enabled: envKey.length > 0,
      },
    };
  }
}

/** 嵌套 Partial：只覆盖给到的字段 */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

export async function writeSettings(
  patch: DeepPartial<AppSettings>,
): Promise<AppSettings> {
  const current = await readSettings();
  const next = deepMerge(current, patch);
  next.llm.enabled = next.llm.apiKey.length > 0;
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf-8");
  // 清缓存，让下次读取拿到新值
  cache = null;
  return next;
}

/** 仅供测试：清除 mtime 缓存，确保每个用例读取最新盘上内容与当前 env */
export function __resetSettingsCacheForTests(): void {
  cache = null;
}

/** 隐藏 API Key 后六位之前的部分，用于在前端展示"已配置"标识 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 4) + "•".repeat(Math.max(0, key.length - 8)) + key.slice(-4);
}
