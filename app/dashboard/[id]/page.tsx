"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ChartCard from "@/components/ChartCard";
import InsightPanel from "@/components/InsightPanel";
import { getDataset, runAnalysis } from "@/lib/api-client";
import type {
  ChartSpec,
  DatasetDetail,
  EChartsOption,
} from "@/lib/types";

export default function DashboardPage() {
  const params = useParams();
  const id = String(params.id);

  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [summary, setSummary] = useState("");
  const [insights, setInsights] = useState<string[]>([]);
  const [charts, setCharts] = useState<ChartSpec[]>([]);
  const [options, setOptions] = useState<EChartsOption[]>([]);
  const [narrative, setNarrative] = useState("");
  const [provider, setProvider] = useState<"mock" | "llm" | undefined>();
  const [streaming, setStreaming] = useState(false);
  const [runError, setRunError] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await getDataset(id);
      setDetail(d);
      if (d.analysis) {
        setSummary(d.analysis.summary);
        setInsights(d.analysis.insights);
        setCharts(d.analysis.charts);
        setOptions(d.analysis.options);
        setNarrative(d.analysis.narrative);
        setProvider(d.analysis.provider);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const startAnalysis = useCallback(async () => {
    setStreaming(true);
    setRunError("");
    setSummary("");
    setInsights([]);
    setCharts([]);
    setOptions([]);
    setNarrative("");
    setProvider(undefined);
    try {
      await runAnalysis(id, {
        onStructured: (p) => {
          setSummary(p.summary);
          setInsights(p.insights);
          setCharts(p.charts);
          setOptions(p.options);
        },
        onToken: (t) => setNarrative((prev) => prev + t),
        onDone: (m) => setProvider(m.provider as "mock" | "llm"),
        onError: (m) => setRunError(m),
      });
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setStreaming(false);
    }
  }, [id]);

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
          <Link className="btn btn-icon" href="/settings" aria-label="设置" title="设置">
            <span aria-hidden>⚙</span>
          </Link>
          <button
            className="btn btn-primary"
            onClick={startAnalysis}
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

      {!hasAnalysis && !streaming && (
        <div className="card">
          <div className="empty">
            这份数据还没被解读过。点右上角「运行分析」，让 LLM
            帮你把数字变成图表与洞察～
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
          />
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
        </div>
      )}
    </div>
  );
}
