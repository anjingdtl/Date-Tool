function required(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`[config] missing required env var: ${name}`);
}

// 兼容 OPENAI_* 与 LLM_* 两套变量名（.env.example 用前者，用户常写后者）
const llmBaseUrl =
  process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1";
const llmApiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
const llmModel =
  process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),
  dataDir: process.env.DATA_DIR || ".data",
  llm: {
    baseUrl: llmBaseUrl,
    apiKey: llmApiKey,
    model: llmModel,
    /** 配置了他家 key 才启用真实 LLM，否则走本地 Mock 分析器 */
    get enabled(): boolean {
      return this.apiKey.length > 0;
    },
  },
} as const;

export function assertConfig(): void {
  // 触发一次读取，确保无致命缺失（当前所有项均有默认值，故这里只是占位 fail-fast 钩子）
  required("NODE_ENV", "development");
}
