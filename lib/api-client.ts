import type {
  AnalysisResult,
  ChartSpec,
  DatasetDetail,
  DatasetRow,
  EChartsOption,
  PublicDataset,
  UploadResult,
} from "./types";
import type {
  FieldConfigIssue,
  FieldConfigUpdate,
} from "./schemas/dataset";

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

/* ----------------------- v0.2 阶段 D：预检 API ----------------------- */

/** 预检详情（GET /api/datasets/{id}?mode=preview，前 20 行 + columns + config + quality） */
export interface PreviewDetail {
  id: string;
  name: string;
  fileName: string;
  source: "csv" | "excel";
  rowCount: number;
  originalRowCount?: number;
  storedRowCount?: number;
  sheetName?: string;
  columns: DatasetDetail["columns"];
  createdAt: string;
  status?: DatasetDetail["status"];
  quality?: DatasetDetail["quality"];
  config?: DatasetDetail["config"];
  previewRows: DatasetRow[];
  analysis: AnalysisResult | null;
  hasAnalysis: boolean;
}

export async function getPreviewDetail(id: string): Promise<PreviewDetail> {
  const res = await fetch(`${BASE}/api/datasets/${id}?mode=preview`, {
    method: "GET",
  });
  return parse<PreviewDetail>(res);
}

/** 字段配置更新响应 */
export interface FieldConfigUpdateResponse {
  columns: DatasetDetail["columns"];
  config?: DatasetDetail["config"];
  issues: FieldConfigIssue[];
}

/**
 * 更新字段配置。返回服务端校验后的 issues。
 * 阻断错误时服务端返回 422，本函数抛错，err.details 是 issues 数组。
 */
export async function updateFieldConfig(
  id: string,
  body: FieldConfigUpdate,
): Promise<FieldConfigUpdateResponse> {
  const res = await fetch(`${BASE}/api/datasets/${id}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `请求失败 (${res.status})`;
    let details: unknown;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
      if (j?.details) details = j.details;
    } catch {
      /* ignore */
    }
    const e = new Error(detail) as Error & { details?: unknown };
    if (details !== undefined) e.details = details;
    throw e;
  }
  return parse<FieldConfigUpdateResponse>(res);
}

/** confirm 数据集：draft → ready，返回跳转地址 */
export interface ConfirmResult {
  id: string;
  status: string;
  redirectTo: string;
}

export async function confirmDataset(
  id: string,
  body?: FieldConfigUpdate,
): Promise<ConfirmResult> {
  const res = await fetch(`${BASE}/api/datasets/${id}/confirm`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `请求失败 (${res.status})`;
    let details: unknown;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
      if (j?.details) details = j.details;
    } catch {
      /* ignore */
    }
    const e = new Error(detail) as Error & { details?: unknown };
    if (details !== undefined) e.details = details;
    throw e;
  }
  return parse<ConfirmResult>(res);
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
