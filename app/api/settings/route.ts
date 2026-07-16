import { NextRequest } from "next/server";
import { ok, fail, newRequestId } from "@/lib/respond";
import { maskApiKey, readSettings, writeSettings } from "@/lib/settings";
import type { AppSettings, DeepPartial } from "@/lib/settings";
import { getActiveLLMConfig } from "@/lib/llm-config";
import {
  KEEP_API_KEY_TOKEN,
  SettingsUpdateSchema,
} from "@/lib/schemas/settings";
import { BadRequestError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/settings —— 返回当前设置（apiKey 脱敏，真实 key 仅服务端可见） */
export async function GET() {
  try {
    const s = await readSettings();
    return ok({
      ...s,
      llm: { ...s.llm, apiKey: s.llm.apiKey ? maskApiKey(s.llm.apiKey) : "" },
      _hasRealKey: s.llm.apiKey.length > 0,
    });
  } catch (e) {
    return fail(e, newRequestId());
  }
}

/**
 * PUT /api/settings —— 更新设置（SPEC 14：Zod 校验 + Base URL 协议校验）。
 * apiKey：KEEP_API_KEY_TOKEN 保留旧值，空串清除，其它覆盖。
 */
export async function PUT(req: NextRequest) {
  const requestId = newRequestId();
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = SettingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError("设置结构非法", parsed.error.flatten());
    }

    const patch: DeepPartial<AppSettings> = {};
    if (parsed.data.theme) patch.theme = parsed.data.theme;
    if (parsed.data.privacy?.sendRowSamples !== undefined) {
      patch.privacy = {
        sendRowSamples: parsed.data.privacy.sendRowSamples,
      };
    }

    if (parsed.data.llm) {
      const llmIn = parsed.data.llm;
      const safeLLM: Record<string, string> = {};
      if (llmIn.provider !== undefined) safeLLM.provider = llmIn.provider;
      if (llmIn.model !== undefined) safeLLM.model = llmIn.model;
      if (llmIn.baseUrl !== undefined) {
        // URL 校验（SPEC 14.3）：空串允许（表示未配置），否则必须 http/https
        const u = llmIn.baseUrl;
        if (u !== "") {
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(u);
          } catch {
            throw new BadRequestError("Base URL 不是合法 URL");
          }
          if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            throw new BadRequestError("Base URL 只允许 http/https 协议");
          }
        }
        safeLLM.baseUrl = llmIn.baseUrl;
      }
      if (llmIn.apiKey !== undefined && llmIn.apiKey !== KEEP_API_KEY_TOKEN) {
        // 非 __KEEP__：空串清除，其它覆盖
        safeLLM.apiKey = llmIn.apiKey;
      }
      patch.llm = safeLLM;
    }

    const next = await writeSettings(patch);
    return ok({
      ...next,
      llm: { ...next.llm, apiKey: next.llm.apiKey ? maskApiKey(next.llm.apiKey) : "" },
      _hasRealKey: next.llm.apiKey.length > 0,
    });
  } catch (e) {
    return fail(e, requestId);
  }
}

/** POST /api/settings —— 测试 LLM 连通性（不写盘），使用统一配置入口 */
export async function POST() {
  try {
    const c = await getActiveLLMConfig();
    if (!c.enabled) {
      return ok({ ok: false, message: "未配置 API Key，当前为本地模式（local）" });
    }
    if (!c.baseUrl) {
      return ok({ ok: false, message: "未配置 Base URL" });
    }
    const url = c.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.apiKey}`,
        },
        body: JSON.stringify({
          model: c.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: ctrl.signal,
      });
      if (res.ok) return ok({ ok: true, message: `连通正常（${res.status}）` });
      // 供应商错误正文可能包含内部追踪信息或回显内容，不进入客户端响应。
      await res.body?.cancel().catch(() => undefined);
      return ok({
        ok: false,
        message: `LLM 返回 ${res.status}，请检查模型、Base URL、额度与密钥权限`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return ok({ ok: false, message: `连接失败: ${msg.slice(0, 160)}` });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return fail(e, newRequestId());
  }
}
