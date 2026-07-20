"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import ChartCard from "@/components/ChartCard";
import InsightPanel from "@/components/InsightPanel";
import AnalysisTimeline from "@/components/AnalysisTimeline";
import AnalysisTaskStatus, { type TaskStatusItem } from "@/components/AnalysisTaskStatus";
import ReviewPanel from "@/components/ReviewPanel";
import AnalysisChat from "@/components/AnalysisChat";
import RevisionHistory from "@/components/RevisionHistory";
import {
  getAnalysisSession,
  getDataset,
  restoreAnalysisRevision,
  runAnalysis,
  runAnalysisFeedback,
  type RevisionListItem,
} from "@/lib/api-client";
import type {
  AnalysisResult,
  AnalysisEvidence,
  ChartSpec,
  ComputedInsight,
  DatasetDetail,
  EChartsOption,
  FinalAnalysisResult,
  ReviewStatus,
} from "@/lib/types";

export default function DashboardPage() {
  const params = useParams();
  const id = String(params.id);
  const searchParams = useSearchParams();
  const autostartRequested = searchParams?.get("autostart") === "1";
  const forceLocalRequested = searchParams?.get("forceLocal") === "1";
  const autostartFiredRef = useRef(false);

  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState("");
  const [insights, setInsights] = useState<string[]>([]);
  const [charts, setCharts] = useState<ChartSpec[]>([]);
  const [options, setOptions] = useState<EChartsOption[]>([]);
  const [narrative, setNarrative] = useState("");
  const [provider, setProvider] = useState<
    "local" | "local+llm" | undefined
  >();
  const [streaming, setStreaming] = useState(false);
  const [runError, setRunError] = useState("");
  /** v0.2 阶段 H：分析阶段状态(SPEC 13.2) */
  const [stage, setStage] = useState("");
  /** v0.2 阶段 H：计算依据(SPEC 10.8) */
  const [evidence, setEvidence] = useState<AnalysisEvidence[]>([]);
  /** v0.2 阶段 H：本地确定性洞察(SPEC 10.8) */
  const [computedInsights, setComputedInsights] = useState<ComputedInsight[]>(
    [],
  );
  /** v0.2 阶段 H：数据警告(SPEC 8.8/10.7) */
  const [warnings, setWarnings] = useState<string[]>([]);
  const [analysisMode, setAnalysisMode] = useState<FinalAnalysisResult["analysisMode"]>();
  const [sessionId, setSessionId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>();
  const [questions, setQuestions] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskStatusItem[]>([]);
  const [revisions, setRevisions] = useState<RevisionListItem[]>([]);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [objectives, setObjectives] = useState<string[]>([]);
  /** SSE 中断控制：分析/反馈/理解各持一个 controller，新调用先 abort 旧流。 */
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const feedbackAbortRef = useRef<AbortController | null>(null);

  /** 组件卸载时中断所有 SSE 流，避免后台脏 setState。 */
  useEffect(() => {
    return () => {
      analyzeAbortRef.current?.abort();
      feedbackAbortRef.current?.abort();
    };
  }, []);

  const applyResult = useCallback((result: AnalysisResult) => {
    setSummary(result.summary);
    setInsights(result.insights);
    setCharts(result.charts);
    setOptions(result.options);
    setNarrative(result.narrative);
    setProvider(result.provider);
    setEvidence(result.evidence ?? []);
    setComputedInsights(result.computedInsights ?? []);
    setWarnings(result.warnings ?? []);
    if ("analysisMode" in result) {
      const final = result as FinalAnalysisResult;
      setAnalysisMode(final.analysisMode);
      setSessionId(final.sessionId ?? "");
      setRevisionId(final.revisionId ?? "");
      setReviewStatus(final.reviewStatus);
      setQuestions(final.questionsForUser ?? []);
    } else {
      setAnalysisMode(undefined);
      setSessionId("");
      setRevisionId("");
      setReviewStatus(undefined);
      setQuestions([]);
    }
  }, []);

  const loadSession = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId) return;
    try {
      const session = await getAnalysisSession(targetSessionId);
      setRevisions(session.revisions);
      if (session.activeRevision) {
        setRevisionId(session.activeRevision.id);
        setReviewStatus(session.activeRevision.finalResult?.reviewStatus);
        setQuestions(session.activeRevision.finalResult?.questionsForUser ?? []);
        setObjectives(session.activeRevision.plan.objectives);
      }
    } catch {
      setRevisions([]);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await getDataset(id);
      setDetail(d);
      if (d.analysis) {
        applyResult(d.analysis);
        if ("sessionId" in d.analysis && d.analysis.sessionId) {
          await loadSession(String(d.analysis.sessionId));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [applyResult, id, loadSession]);

  useEffect(() => {
    load();
  }, [load]);

  const startAnalysis = useCallback(async (forceLocal = false) => {
    // 中断上一次未完成的分析 SSE，避免新旧流同时 setState。
    analyzeAbortRef.current?.abort();
    const ac = new AbortController();
    analyzeAbortRef.current = ac;
    setStreaming(true);
    setRunError("");
    setSummary("");
    setInsights([]);
    setCharts([]);
    setOptions([]);
    setNarrative("");
    setProvider(undefined);
    setStage("");
    setEvidence([]);
    setComputedInsights([]);
    setWarnings([]);
    setTimeline([]);
    setTasks([]);
    setQuestions([]);
    setObjectives([]);
    let completedSessionId = "";
    try {
      await runAnalysis(id, {
        onStructured: (p) => {
          setSummary(p.summary);
          setInsights(p.insights);
          setCharts(p.charts);
          setOptions(p.options);
          if (p.evidence) setEvidence(p.evidence);
          if (p.computedInsights) setComputedInsights(p.computedInsights);
          if (p.warnings) setWarnings(p.warnings);
          if (p.provider) setProvider(p.provider);
        },
        onStage: (s) => {
          setStage(s);
          setTimeline((previous) => [...previous, s]);
        },
        onPlan: (plan) => {
          setObjectives(plan.objectives);
          setTimeline((previous) => [...previous, `计划已生成：${plan.taskCount} 个任务`]);
        },
        onTaskStarted: (task) =>
          setTasks((previous) => [
            ...previous.filter((item) => item.id !== task.taskId),
            { id: task.taskId, title: task.title, status: "running" },
          ]),
        onTaskCompleted: (task) =>
          setTasks((previous) =>
            previous.map((item) =>
              item.id === task.taskId ? { ...item, status: "success" } : item,
            ),
          ),
        onTaskFailed: (task) =>
          setTasks((previous) =>
            previous.map((item) =>
              item.id === task.taskId
                ? { ...item, status: "failed", message: task.message }
                : item,
            ),
          ),
        onReview: (review) =>
          setTimeline((previous) => [...previous, `终审：${review.message}`]),
        onQuestion: (payload) => setQuestions(payload.questions),
        onRevision: (revision) => setRevisionId(revision.revisionId),
        onToken: (t) => setNarrative((prev) => prev + t),
        onFinal: (p) => {
          // SPEC 9.4：final 到达后整体刷新，确保 LLM 的 summary/actions/图表标题立即生效
          setSummary(p.summary);
          setInsights(p.insights);
          setCharts(p.charts);
          setOptions(p.options);
          if (p.narrative !== undefined) setNarrative(p.narrative);
          if (p.provider) setProvider(p.provider);
          if (p.evidence) setEvidence(p.evidence);
          if (p.computedInsights) setComputedInsights(p.computedInsights);
          if (p.warnings) setWarnings(p.warnings);
          if ("analysisMode" in p) {
            completedSessionId = p.sessionId ?? "";
            setAnalysisMode(p.analysisMode);
            setSessionId(completedSessionId);
            setRevisionId(p.revisionId ?? "");
            setReviewStatus(p.reviewStatus);
            setQuestions(p.questionsForUser ?? []);
          }
        },
        onDone: (m) => {
          setProvider(m.provider);
          setStage("");
          if (completedSessionId) void loadSession(completedSessionId);
        },
        onError: (m) => setRunError(m),
      }, { forceLocal, signal: ac.signal });
    } catch (e) {
      if (ac.signal.aborted) return; // 主动取消，不报错
      setRunError(e instanceof Error ? e.message : "分析失败");
    } finally {
      if (analyzeAbortRef.current === ac) analyzeAbortRef.current = null;
      setStreaming(false);
      setStage("");
    }
  }, [id, loadSession]);

  // import 页带 autostart=1 跳转过来时自动启动分析，省掉用户再点一次「运行分析」。
  // 只在 detail 就绪、状态允许分析、且未触发过时执行一次。
  useEffect(() => {
    if (!autostartRequested || autostartFiredRef.current) return;
    if (!detail || streaming) return;
    if (detail.status !== "ready" && detail.status !== "completed") return;
    autostartFiredRef.current = true;
    void startAnalysis(forceLocalRequested);
  }, [autostartRequested, detail, streaming, forceLocalRequested, startAnalysis]);

  const sendFeedback = useCallback(async (message: string) => {
    if (!sessionId || !revisionId) return;
    // 中断上一次未完成的反馈 SSE。
    feedbackAbortRef.current?.abort();
    const ac = new AbortController();
    feedbackAbortRef.current = ac;
    setFeedbackBusy(true);
    setRunError("");
    setTimeline([]);
    setTasks([]);
    try {
      await runAnalysisFeedback(sessionId, revisionId, message, {
        onStage: (value) => {
          setStage(value);
          setTimeline((previous) => [...previous, value]);
        },
        onPlan: (plan) => {
          setObjectives(plan.objectives);
          setTimeline((previous) => [...previous, `修改计划已生成：${plan.taskCount} 个任务`]);
        },
        onTaskStarted: (task) =>
          setTasks((previous) => [
            ...previous.filter((item) => item.id !== task.taskId),
            { id: task.taskId, title: task.title, status: "running" },
          ]),
        onTaskCompleted: (task) =>
          setTasks((previous) =>
            previous.map((item) => item.id === task.taskId ? { ...item, status: "success" } : item),
          ),
        onTaskFailed: (task) =>
          setTasks((previous) =>
            previous.map((item) =>
              item.id === task.taskId
                ? { ...item, status: "failed", message: task.message }
                : item,
            ),
          ),
        onReview: (review) =>
          setTimeline((previous) => [...previous, `终审：${review.message}`]),
        onQuestion: (payload) => setQuestions(payload.questions),
        onRevision: (revision) => setRevisionId(revision.revisionId),
        onToken: () => {},
        onFinal: (result) => applyResult(result as FinalAnalysisResult),
        onDone: (meta) => {
          setRevisionId(meta.revisionId);
          void loadSession(sessionId);
        },
        onError: (messageText) => setRunError(messageText),
      }, { signal: ac.signal });
    } catch (e) {
      if (ac.signal.aborted) return; // 主动取消，不报错
      setRunError(e instanceof Error ? e.message : "修改失败");
    } finally {
      if (feedbackAbortRef.current === ac) feedbackAbortRef.current = null;
      setFeedbackBusy(false);
      setStage("");
    }
  }, [applyResult, loadSession, revisionId, sessionId]);

  const restoreRevision = useCallback(async (targetRevisionId: string) => {
    if (!sessionId) return;
    setFeedbackBusy(true);
    setRunError("");
    try {
      const restored = await restoreAnalysisRevision(sessionId, targetRevisionId);
      if (restored.revision.finalResult) applyResult(restored.revision.finalResult);
      await loadSession(sessionId);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "恢复 Revision 失败");
    } finally {
      setFeedbackBusy(false);
    }
  }, [applyResult, loadSession, sessionId]);

  if (loading) {
    return (
      <div className="container">
        <div className="row">
          <span className="spinner" />
          <span className="muted">加载中…</span>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="container">
        <div className="banner error">{error || "数据集不存在"}</div>
        <Link className="btn" href="/">
          返回首页
        </Link>
      </div>
    );
  }

  const hasAnalysis = charts.length > 0;

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logo">📊</div>
          <div>
            <h1>{detail.name}</h1>
            <p>
              {detail.rowCount} 行 · {detail.columns.length} 列 ·{" "}
              {detail.fileName}
            </p>
          </div>
        </div>
        <div className="row">
          <Link className="btn" href="/">
            返回
          </Link>
          <Link className="btn" href={`/import/${id}`}>
            重新理解数据
          </Link>
          <Link className="btn btn-icon" href="/settings" aria-label="设置" title="设置">
            <span aria-hidden>⚙</span>
          </Link>
          <button
            className="btn"
            onClick={() => startAnalysis(true)}
            disabled={streaming}
            title="跳过 LLM 编排，直接运行本地确定性规则分析"
          >
            本地分析
          </button>
          <button
            className="btn btn-primary"
            onClick={() => startAnalysis(false)}
            disabled={streaming}
          >
            {streaming ? (
              <>
                <span className="spinner" /> 分析中…
              </>
            ) : hasAnalysis ? (
              "重新分析"
            ) : (
              "运行分析 ✨"
            )}
          </button>
        </div>
      </div>

      {runError && <div className="banner error">{runError}</div>}

      <AnalysisTimeline events={timeline} active={streaming || feedbackBusy} />
      <AnalysisTaskStatus tasks={tasks} />

      {!hasAnalysis && !streaming && (
        <div className="card">
          <div className="empty">
            这份数据还没有分析结果。点右上角「运行分析」：配置 LLM 时会按已确认语义制订并执行计划，
            未配置时自动使用本地规则模式。
          </div>
        </div>
      )}

      {hasAnalysis && (
        <div className="grid" style={{ gap: 20 }}>
          <InsightPanel
            summary={summary}
            insights={insights}
            narrative={narrative}
            streaming={streaming}
            provider={provider}
            stage={stage}
            evidence={evidence}
            computedInsights={computedInsights}
            warnings={warnings}
          />
          {analysisMode && (
            <div className="row">
              <span className="badge">
                {analysisMode === "llm_orchestrated" ? "LLM 编排模式" : "本地规则模式"}
              </span>
              {revisionId && <span className="badge muted">Revision {revisionId}</span>}
              {sessionId && <span className="badge muted">Session {sessionId}</span>}
            </div>
          )}
          {objectives.length > 0 && (
            <div className="card agent-panel">
              <h3>分析目标</h3>
              <div className="muted">{objectives.join("；")}</div>
            </div>
          )}
          <ReviewPanel status={reviewStatus} questions={questions} />
          <div className="grid grid-charts">
            {charts.map((c, i) => (
              <ChartCard
                key={c.id}
                spec={c}
                option={options[i]}
                rows={detail.previewRows}
                index={i}
              />
            ))}
          </div>
          {sessionId && revisionId && (
            <div className="grid grid-2">
              <AnalysisChat disabled={feedbackBusy || streaming} onSend={sendFeedback} />
              <RevisionHistory
                revisions={revisions}
                busy={feedbackBusy || streaming}
                onRestore={restoreRevision}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
