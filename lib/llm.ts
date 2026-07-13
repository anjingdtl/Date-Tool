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

/** 非流式调用，要求模型返回 JSON。用于拿结构化分析结果。 */
export async function chatJSON(
  system: string,
  user: string,
  requestId: string,
): Promise<unknown> {
  const llm = await activeLLM();
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
}

/** 流式调用，逐 token 回调；返回完整文本。用于「占卜师」实时解读。 */
export async function streamChat(
  system: string,
  user: string,
  onToken: (token: string) => void,
  requestId: string,
): Promise<string> {
  const llm = await activeLLM();
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
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`LLM 流式调用失败(${res.status}): ${txt.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  // 推理模型（MiniMax M3 等）会把思考过程裹在 <think> 中随流输出，需逐 token 过滤
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
}

interface ThinkState {
  thinking: boolean;
  /** 跨 chunk 被截断的 <think / </think 标签头 */
  tail: string;
}

/** 过滤推理模型的 <think>...</think> 思考过程（可能跨 chunk 截断）。返回要展示给用户的正式文本。 */
function filterThink(token: string, state: ThinkState): string {
  // 1) 拼回上次未闭合的标签头
  let s = state.tail + token;
  state.tail = "";
  // 2) 末尾若是不完整的 < 标签片段，暂存等下个 chunk
  const lastLt = s.lastIndexOf("<");
  if (lastLt !== -1) {
    const suffix = s.slice(lastLt);
    if (/<(think|\/think)?$/.test(suffix)) {
      state.tail = suffix;
      s = s.slice(0, lastLt);
    }
  }
  // 3) 逐段剥离思考内容
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (state.thinking) {
      const end = s.indexOf("</think>", i);
      if (end === -1) {
        i = s.length;
        break;
      }
      out += s.slice(end + 8);
      state.thinking = false;
      i = end + 8;
    } else {
      const start = s.indexOf("<think>", i);
      if (start === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, start);
      state.thinking = true;
      i = start + 7;
    }
  }
  return out;
}

/** 去掉 ```json ... ``` 代码围栏、剥离推理模型（MiniMax M3 等）的 <think> 标签，返回可 JSON.parse 的文本 */
function stripJson(content: string): unknown {
  let s = content.trim();
  // 1) 剥离 <think>...</think> 推理标签（M3 等推理模型会在 JSON 前裹一层思考）
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // 2) 去除 ```json ... ``` 代码围栏
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  // 3) 鲁棒截取：从第一个 { 到最后一个 }，避免前后杂糅文本
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}
