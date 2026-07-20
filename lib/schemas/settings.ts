import { z } from "zod";

export const ThemeSchema = z.enum(["light", "dark"]);

/** API 协议常量：前端发该值表示保留旧 API Key（SPEC 14.4），不得与真实 Key 混淆 */
export const KEEP_API_KEY_TOKEN = "__KEEP__";

export const LLMSettingsSchema = z.object({
  provider: z.string(),
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});

export const AppSettingsSchema = z.object({
  theme: ThemeSchema,
  llm: LLMSettingsSchema,
  privacy: z.object({
    sendRowSamples: z.boolean(),
  }),
});

/**
 * 设置更新（SPEC 14.2）：仅接收白名单字段。
 * apiKey 用 KEEP_API_KEY_TOKEN 表示保留旧值，空串表示清除。
 */
export const SettingsUpdateSchema = z.object({
  theme: ThemeSchema.optional(),
  llm: z
    .object({
      provider: z.string().trim().max(100).optional(),
      baseUrl: z.string().trim().max(500).optional(),
      apiKey: z.string().max(500).optional(),
      model: z.string().trim().max(200).optional(),
    })
    .optional(),
  privacy: z
    .object({
      sendRowSamples: z.boolean().optional(),
    })
    .optional(),
});

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

