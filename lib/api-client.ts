import type {
  AnalysisEvidence,
  AnalysisRevision,
  AnalysisResult,
  AnalysisSession,
  ChartSpec,
  ComputedInsight,
  DatasetDetail,
  DatasetRow,
  DatasetUnderstanding,
  EChartsOption,
  FinalAnalysisResult,
  PublicDataset,
  UploadResult,
} from "./types";
import type {
  FieldConfigIssue,
  FieldConfigUpdate,
} from "./schemas/dataset";
import type { FinalAnalysisPayload } from "./analyzer";

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
    /** v0.2 阶段 H：本地计算证据(SPEC 10.8) */
    evidence?: AnalysisEvidence[];
    /** v0.2 阶段 H：本地确定性洞察(SPEC 10.8) */
    computedInsights?: ComputedInsight[];
    /** v0.2 阶段 H：数据警告(SPEC 8.8/10.7) */
    warnings?: string[];
    /** v0.2 阶段 H：分析来源(SPEC 12.6) */
    provider?: "local" | "local+llm";
  }) => void;
  /** v0.2 阶段 H：分析阶段状态(SPEC 13.2) */
  onStage?: (stage: string, code?: string) => void;
  onToken?: (text: string) => void;
  /** SPEC 9.4: final 事件，LLM/local 完成后整体刷新 summary/图表/标题/行动建议 */
  onFinal?: (p: FinalAnalysisPayload | FinalAnalysisResult) => void;
  onDone?: (meta: {
    provider: "local" | "local+llm";
    createdAt: string;
  }) => void;
  onError?: (message: string) => void;
  /** v0.3 编排事件（SPEC 18.3，向后兼容：旧回调保留） */
  onPlan?: (p: { id: string; taskCount: number; objectives: string[] }) => void;
  onTaskStarted?: (p: { taskId: string; title: string }) => void;
  onTaskCompleted?: (p: {
    taskId: string;
    status: string;
    evidenceCount: number;
  }) => void;
  onTaskFailed?: (p: { taskId: string; status: string; message?: string }) => void;
  onReview?: (p: { status: string; message: string }) => void;
  onQuestion?: (p: { questions: string[] }) => void;
  onRevision?: (p: {
    revisionId: string;
    sequence: number;
    source: string;
  }) => void;
}

/** 触发分析并以 SSE 流式接收结果 */
export async function runAnalysis(
  datasetId: string,
  hooks: AnalyzeHooks,
  options?: { userGoal?: string; forceLocal?: boolean },
): Promise<void> {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      datasetId,
      userGoal: options?.userGoal,
      forceLocal: options?.forceLocal,
    }),
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
        case "stage":
          hooks.onStage?.(payload.stage ?? "");
          break;
        case "token":
          hooks.onToken?.(payload.text ?? "");
          break;
        case "final":
          hooks.onFinal?.(payload);
          break;
        case "done":
          hooks.onDone?.(payload);
          break;
        case "error":
          hooks.onError?.(payload.message ?? "分析出错");
          break;
        case "plan":
          hooks.onPlan?.(payload);
          break;
        case "task_started":
          hooks.onTaskStarted?.(payload);
          break;
        case "task_completed":
          hooks.onTaskCompleted?.(payload);
          break;
        case "task_failed":
          hooks.onTaskFailed?.(payload);
          break;
        case "review":
          hooks.onReview?.(payload);
          break;
        case "question":
          hooks.onQuestion?.(payload);
          break;
        case "revision":
          hooks.onRevision?.(payload);
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

/* ----------------------- v0.3：AI 数据理解 API（SPEC 18.1） ----------------------- */

export interface UnderstandingResult {
  understanding: DatasetUnderstanding | null;
  hasUnderstanding: boolean;
}

/** GET /api/datasets/{id}/understanding */
export async function getUnderstanding(
  datasetId: string,
): Promise<UnderstandingResult> {
  const res = await fetch(`${BASE}/api/datasets/${datasetId}/understanding`);
  return parse<UnderstandingResult>(res);
}

/** 字段级语义修改项（与服务端 FieldChange 对应） */
export interface FieldUnderstandingChange {
  field: string;
  changes: Partial<DatasetUnderstanding["fields"][number]>;
}

/** PUT /api/datasets/{id}/understanding：合并用户修正 / 确认 */
export async function updateUnderstanding(
  datasetId: string,
  body: {
    fieldChanges?: FieldUnderstandingChange[];
    ambiguityResolutions?: Array<{
      ambiguityId: string;
      fieldChanges?: FieldUnderstandingChange[];
    }>;
    confirm?: boolean;
  },
): Promise<{ understanding: DatasetUnderstanding }> {
  const res = await fetch(`${BASE}/api/datasets/${datasetId}/understanding`, {
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
  return parse<{ understanding: DatasetUnderstanding }>(res);
}

export interface UnderstandSSEHooks {
  onStage?: (stage: string, code?: string) => void;
  onUnderstanding?: (u: DatasetUnderstanding) => void;
  onAmbiguity?: (u: DatasetUnderstanding) => void;
  onDone?: (status: string) => void;
  onError?: (message: string) => void;
}

/**
 * POST /api/datasets/{id}/understand（SSE）。
 * 事件：stage → understanding|ambiguity → done|error。
 * done.status 为 fallback 时表示 LLM 未启用，前端引导本地模式。
 */
export async function runUnderstand(
  datasetId: string,
  hooks: UnderstandSSEHooks,
  options?: { userDescription?: string; force?: boolean },
): Promise<void> {
  const res = await fetch(`${BASE}/api/datasets/${datasetId}/understand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userDescription: options?.userDescription,
      force: options?.force,
    }),
  });

  if (!res.ok || !res.body) {
    let msg = `理解请求失败 (${res.status})`;
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
        case "stage":
          hooks.onStage?.(payload.message ?? payload.stage ?? "", payload.code);
          break;
        case "understanding":
          hooks.onUnderstanding?.(payload.understanding as DatasetUnderstanding);
          break;
        case "ambiguity":
          hooks.onAmbiguity?.(payload.understanding as DatasetUnderstanding);
          break;
        case "done":
          hooks.onDone?.(payload.status ?? "");
          break;
        case "error":
          hooks.onError?.(payload.message ?? "数据理解出错");
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

/* ----------------------- v0.3：Session / Feedback / Revision ----------------------- */

export interface RevisionListItem {
  id: string;
  sequence: number;
  status: AnalysisRevision["status"];
  source: AnalysisRevision["source"];
  parentRevisionId?: string;
  summary: string;
  createdAt: string;
  isActive: boolean;
}

export interface AnalysisSessionDetail {
  session: AnalysisSession;
  activeRevision: AnalysisRevision | null;
  revisions: RevisionListItem[];
}

export async function getAnalysisSession(
  sessionId: string,
): Promise<AnalysisSessionDetail> {
  const res = await fetch(`${BASE}/api/analysis/${sessionId}`);
  return parse<AnalysisSessionDetail>(res);
}

export async function getAnalysisRevision(
  sessionId: string,
  revisionId: string,
): Promise<AnalysisRevision> {
  const res = await fetch(
    `${BASE}/api/analysis/${sessionId}/revisions/${revisionId}`,
  );
  const data = await parse<{ revision: AnalysisRevision }>(res);
  return data.revision;
}

export async function restoreAnalysisRevision(
  sessionId: string,
  revisionId: string,
): Promise<{ session: AnalysisSession; revision: AnalysisRevision }> {
  const res = await fetch(
    `${BASE}/api/analysis/${sessionId}/revisions/${revisionId}/restore`,
    { method: "POST" },
  );
  return parse<{ session: AnalysisSession; revision: AnalysisRevision }>(res);
}

export interface FeedbackDoneMeta {
  provider: "local" | "local+llm";
  createdAt: string;
  revisionId: string;
  impact: {
    presentationOnly: boolean;
    affectedTaskIds: string[];
    reusedTaskIds: string[];
    reasons: string[];
  };
}

export type FeedbackHooks = Omit<AnalyzeHooks, "onDone"> & {
  onDone?: (meta: FeedbackDoneMeta) => void;
};

export async function runAnalysisFeedback(
  sessionId: string,
  revisionId: string,
  message: string,
  hooks: FeedbackHooks,
): Promise<void> {
  const res = await fetch(`${BASE}/api/analysis/${sessionId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revisionId, message }),
  });
  if (!res.ok || !res.body) {
    let error = `修改请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) error = body.detail;
    } catch {
      /* ignore */
    }
    hooks.onError?.(error);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data = "";
  const dispatch = () => {
    if (!event || !data) return;
    try {
      const payload = JSON.parse(data);
      switch (event) {
        case "stage": hooks.onStage?.(payload.message ?? payload.stage ?? "", payload.code); break;
        case "plan": hooks.onPlan?.(payload); break;
        case "task_started": hooks.onTaskStarted?.(payload); break;
        case "task_completed": hooks.onTaskCompleted?.(payload); break;
        case "task_failed": hooks.onTaskFailed?.(payload); break;
        case "review": hooks.onReview?.(payload); break;
        case "question": hooks.onQuestion?.(payload); break;
        case "revision": hooks.onRevision?.(payload); break;
        case "token": hooks.onToken?.(payload.text ?? ""); break;
        case "final": hooks.onFinal?.(payload); break;
        case "done": hooks.onDone?.(payload); break;
        case "error": hooks.onError?.(payload.message ?? "修改失败"); break;
      }
    } catch {
      /* 忽略坏帧 */
    }
    event = "";
    data = "";
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
      else if (!line.trim()) dispatch();
    }
  }
  dispatch();
}
