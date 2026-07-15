import { NextRequest } from "next/server";
import { ok, fail, newRequestId } from "@/lib/respond";
import {
  LLMSettings,
  maskApiKey,
  readSettings,
  writeSettings,
} from "@/lib/settings";
import { getActiveLLMConfig } from "@/lib/llm-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/settings —— 返回当前设置（apiKey 脱敏） */
export async function GET() {
  try {
    const s = await readSettings();
    return ok({
      ...s,
      llm: { ...s.llm, apiKey: s.llm.apiKey ? maskApiKey(s.llm.apiKey) : "" },
      /** 真实 key 仅服务端可见，前端永远拿不到明文 */
      _hasRealKey: s.llm.apiKey.length > 0,
    });
  } catch (e) {
    return fail(e, newRequestId());
  }
}

/** PUT /api/settings —— 更新设置（仅接收允许的字段） */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<{
      theme: string;
      llm: Partial<LLMSettings>;
    }>;
    const patch: import("@/lib/settings").DeepPartial<import("@/lib/settings").AppSettings> = {};
    if (typeof body.theme === "string") {
      patch.theme = body.theme as never;
    }
    if (body.llm && typeof body.llm === "object") {
      const llmIn = body.llm;
      // 仅接收 4 个白名单字段
      const safeLLM: Partial<LLMSettings> = {};
      if (typeof llmIn.provider === "string") safeLLM.provider = llmIn.provider;
      if (typeof llmIn.baseUrl === "string") safeLLM.baseUrl = llmIn.baseUrl;
      if (typeof llmIn.model === "string") safeLLM.model = llmIn.model;
      // apiKey 特殊处理：前端发来 "__KEEP__" 表示保留旧值（避免被遮罩覆盖）
      if (typeof llmIn.apiKey === "string") {
        if (llmIn.apiKey === "__KEEP__") {
          // 不改 apiKey
        } else if (llmIn.apiKey === "") {
          safeLLM.apiKey = "";
        } else {
          safeLLM.apiKey = llmIn.apiKey;
        }
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
    return fail(e, newRequestId());
  }
}

/** POST /api/settings/test —— 测试 LLM 连通性（不写盘），使用统一配置入口 */
export async function POST(req: NextRequest) {
  try {
    const c = await getActiveLLMConfig();
    if (!c.enabled) {
      return ok({
        ok: false,
        message: "未配置 API Key，当前为本地模式（local）",
      });
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
      const text = await res.text().catch(() => "");
      return ok({
        ok: false,
        message: `LLM 返回 ${res.status}: ${text.slice(0, 160)}`,
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