import { z } from "zod";

export const ThemeSchema = z.enum(["verdigris", "ocean", "sunset", "ink"]);

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
});
