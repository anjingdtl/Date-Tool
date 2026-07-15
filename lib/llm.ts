import { config } from "./config";
import { readSettings } from "./settings";
import { logger } from "./logger";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 取当前生效的 LLM 配置：先看运行时 settings，再回退到 env。热更新支持。 */
async function activeLLM(): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  try {
    const s = await readSettings();
    if (s.llm.baseUrl && s.llm.apiKey) {
      return {
        baseUrl: s.llm.baseUrl,
        apiKey: s.llm.apiKey,
        model: s.llm.model,
      };
    }
  } catch {
    /* 读盘失败 → 用 env 兜底 */
  }
  return {
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    model: config.llm.model,
  };
}

function endpoint(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  return `${b}${path}`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

/** 非流式调用，要求模型返回 JSON。用于拿结构化分析结果。结构化解释 30 秒超时。 */
export async function chatJSON(
  system: string,
  user: string,
  requestId: string,
): Promise<unknown> {
  const llm = await activeLLM();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(endpoint(llm.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: authHeaders(llm.apiKey),
      body: JSON.stringify({
        model: llm.model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ] as ChatMessage[],
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      logger.warn("LLM JSON 调用失败", { requestId, status: res.status, txt });
      throw new Error(`LLM 调用失败(${res.status}): ${txt.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    return stripJson(content);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("LLM JSON 调用超时", { requestId });
      throw new Error("LLM 结构化解读超时");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 流式调用，逐 token 回调；返回完整文本。流式解读 60 秒超时，超时返回已生成部分。 */
export async function streamChat(
  system: string,
  user: string,
  onToken: (token: string) => void,
  requestId: string,
): Promise<string> {
  const llm = await activeLLM();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let full = "";
  try {
    const res = await fetch(endpoint(llm.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: authHeaders(llm.apiKey),
      body: JSON.stringify({
        model: llm.model,
        temperature: 0.6,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ] as ChatMessage[],
      }),
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`LLM 流式调用失败(${res.status}): ${txt.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const think: ThinkState = { thinking: false, tail: "" };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data);
          const token: string | undefined = chunk.choices?.[0]?.delta?.content;
          if (token) {
            const cleaned = filterThink(token, think);
            full += cleaned;
            if (cleaned) onToken(cleaned);
          }
        } catch {
          // 忽略不完整的 SSE 片段
        }
      }
    }
    logger.debug("LLM 流式完成", { requestId, chars: full.length });
    return full;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("LLM 流式解读超时", { requestId, chars: full.length });
      return full;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface ThinkState {
  thinking: boolean;
  /** 跨 chunk 被截断的未闭合标签头 */
  tail: string;
}

// 推理模型会把内部推理过程裹在特殊标签里随流输出，需逐 token 剥离（标签可能跨 chunk 截断）。
// 用拼接构造标记字符串，避免源码中出现完整字面量。
const THINK_OPEN = "<".concat("think>");
const THINK_CLOSE = "<".concat("/think>");
const THINK_OPEN_LEN = THINK_OPEN.length;
const THINK_CLOSE_LEN = THINK_CLOSE.length;

/** 过滤推理模型的内部思考标签，返回要展示给用户的正式文本。标签可能跨 chunk 截断。 */
function filterThink(token: string, state: ThinkState): string {
  let s = state.tail + token;
  state.tail = "";
  const lastLt = s.lastIndexOf("<");
  if (lastLt !== -1) {
    const suffix = s.slice(lastLt);
    if (/<(think|\/think)?$/.test(suffix)) {
      state.tail = suffix;
      s = s.slice(0, lastLt);
    }
  }
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (state.thinking) {
      const end = s.indexOf(THINK_CLOSE, i);
      if (end === -1) {
        i = s.length;
        break;
      }
      out += s.slice(end + THINK_CLOSE_LEN);
      state.thinking = false;
      i = end + THINK_CLOSE_LEN;
    } else {
      const start = s.indexOf(THINK_OPEN, i);
      if (start === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, start);
      state.thinking = true;
      i = start + THINK_OPEN_LEN;
    }
  }
  return out;
}

/** 去掉代码围栏、剥离推理模型的推理标签，返回可 JSON.parse 的文本 */
function stripJson(content: string): unknown {
  let s = content.trim();
  const thinkRe = new RegExp(
    THINK_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "[\\s\\S]*?" +
      THINK_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi",
  );
  s = s.replace(thinkRe, "").trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}
