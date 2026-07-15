/**
 * lib/llm-config.ts
 *
 * 统一的运行时 LLM 配置解析入口（SPEC 6.2）。
 *
 * 单一事实来源：当前是否启用 LLM、有效 baseUrl/apiKey/model/provider，都从这里取。
 * 优先级（SPEC 6.3）：settings.json 非空值 → 环境变量 → 默认值。
 * enabled 由最终生效的 apiKey 计算，不得使用持久化文件中的旧 enabled。
 *
 * analyzer 判定分支 / llm client / 测试连接 三处都调用本入口，
 * 不再各处自行推断（消除 config.llm.enabled 与 settings 两套来源的歧义）。
 */
import { readSettings } from "./settings";

export interface ActiveLLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

/**
 * 取当前生效的 LLM 配置。
 *
 * readSettings 已实现「settings 非空值 → env 回退 → 默认值」的合并逻辑，
 * 这里只负责把 enabled 按 SPEC 6.3 重新计算（apiKey.trim().length > 0），
 * 绝不沿用持久化文件里可能过期的 enabled 字段。
 */
export async function getActiveLLMConfig(): Promise<ActiveLLMConfig> {
  const s = await readSettings();
  const apiKey = (s.llm.apiKey ?? "").trim();
  const baseUrl = (s.llm.baseUrl ?? "").trim();
  const model = (s.llm.model ?? "").trim();
  const provider = (s.llm.provider ?? "").trim() || "openai";
  return {
    provider,
    baseUrl,
    apiKey,
    model,
    enabled: apiKey.length > 0,
  };
}
