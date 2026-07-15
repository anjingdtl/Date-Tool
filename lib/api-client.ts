import type {
  AnalysisResult,
  ChartSpec,
  DatasetDetail,
  DatasetRow,
  EChartsOption,
  PublicDataset,
  UploadResult,
} from "./types";

const BASE = "";

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `请求失败 (${res.status})`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function uploadDataset(
  file: File,
  name?: string,
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  if (name) fd.append("name", name);
  const res = await fetch(`${BASE}/api/datasets`, {
    method: "POST",
    body: fd,
  });
  return parse<UploadResult>(res);
}

export async function listDatasets(): Promise<PublicDataset[]> {
  const res = await fetch(`${BASE}/api/datasets`, { method: "GET" });
  const j = await parse<{ datasets: PublicDataset[] }>(res);
  return j.datasets;
}

export async function getDataset(id: string): Promise<DatasetDetail> {
  const res = await fetch(`${BASE}/api/datasets/${id}`, { method: "GET" });
  return parse<DatasetDetail>(res);
}

export async function deleteDataset(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/datasets/${id}`, { method: "DELETE" });
  await parse<{ deleted: boolean }>(res);
}

export interface AnalyzeHooks {
  onStructured?: (p: {
    summary: string;
    insights: string[];
    charts: ChartSpec[];
    options: EChartsOption[];
  }) => void;
  onToken?: (text: string) => void;
  onDone?: (meta: {
    provider: "local" | "local+llm" | "mock" | "llm";
    createdAt: string;
  }) => void;
  onError?: (message: string) => void;
}

/** 触发分析并以 SSE 流式接收结果 */
export async function runAnalysis(
  datasetId: string,
  hooks: AnalyzeHooks,
): Promise<void> {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datasetId }),
  });

  if (!res.ok || !res.body) {
    let msg = `分析请求失败 (${res.status})`;
    try {
      const j = await res.json();
      if (j?.detail) msg = j.detail;
    } catch {
      /* ignore */
    }
    hooks.onError?.(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let curEvent = "";
  let curData = "";

  const dispatch = () => {
    if (!curEvent || !curData) return;
    try {
      const payload = JSON.parse(curData);
      switch (curEvent) {
        case "result":
          hooks.onStructured?.(payload);
          break;
        case "token":
          hooks.onToken?.(payload.text ?? "");
          break;
        case "done":
          hooks.onDone?.(payload);
          break;
        case "error":
          hooks.onError?.(payload.message ?? "分析出错");
          break;
      }
    } catch {
      /* 忽略坏帧 */
    }
    curEvent = "";
    curData = "";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        curEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        curData = line.slice(5).trim();
      } else if (line.trim() === "") {
        dispatch();
      }
    }
  }
  dispatch();
}
