"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import FieldConfigTable, {
  type EditableField,
} from "@/components/FieldConfigTable";
import QualityOverview from "@/components/QualityOverview";
import UnderstandingOverview from "@/components/UnderstandingOverview";
import FieldUnderstandingTable from "@/components/FieldUnderstandingTable";
import AmbiguityPanel from "@/components/AmbiguityPanel";
import DerivedMetricSuggestions from "@/components/DerivedMetricSuggestions";
import UnderstandingStatus, {
  type UnderstandingPhase,
} from "@/components/UnderstandingStatus";
import {
  confirmDataset,
  getPreviewDetail,
  getUnderstanding,
  runUnderstand,
  updateFieldConfig,
  updateUnderstanding,
  type FieldUnderstandingChange,
  type PreviewDetail,
} from "@/lib/api-client";
import type {
  Aggregation,
  ColumnMeta,
  DatasetUnderstanding,
  FieldFormat,
  FieldRole,
  UnderstandingStateValue,
} from "@/lib/types";
import type {
  FieldConfigIssue,
  FieldConfigUpdate,
} from "@/lib/schemas/dataset";

/** 把服务端 ColumnMeta[] 转成可编辑字段 */
function toEditable(cols: ColumnMeta[]): EditableField[] {
  return cols.map((c) => ({
    name: c.name,
    originalName: c.originalName,
    type: c.type,
    role: (c.role ?? "dimension") as FieldRole,
    format: (c.format ?? "plain") as FieldFormat,
    defaultAggregation: (c.defaultAggregation ?? "count") as Aggregation,
    includeInAnalysis: c.includeInAnalysis ?? true,
    sampleValues: c.sampleValues ?? [],
    confidence: c.confidence,
    nullRate: c.nullRate,
    distinctCount: c.distinctCount,
  }));
}

/** 从可编辑字段构造提交给服务端的 FieldConfigUpdate */
function toUpdateBody(fields: EditableField[]): FieldConfigUpdate {
  return {
    columns: fields.map((f) => ({
      name: f.name,
      type: f.type,
      role: f.role,
      format: f.format,
      defaultAggregation: f.defaultAggregation,
      includeInAnalysis: f.includeInAnalysis,
    })),
  };
}

/** 简单深拷贝（字段配置是纯数据） */
function cloneFields(fields: EditableField[]): EditableField[] {
  return fields.map((f) => ({ ...f, sampleValues: [...f.sampleValues] }));
}

export default function ImportPreviewPage({
  params,
}: {
  params: { draftId: string };
}) {
  const router = useRouter();
  const draftId = params.draftId;

  const [data, setData] = useState<PreviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<EditableField[]>([]);
  const [initialFields, setInitialFields] = useState<EditableField[]>([]);
  const [issues, setIssues] = useState<FieldConfigIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [banner, setBanner] = useState<{
    type: "error" | "warn" | "ok";
    msg: string;
  } | null>(null);

  /* —— v0.3：AI 数据理解状态（SPEC 20.1） —— */
  const [understanding, setUnderstanding] = useState<DatasetUnderstanding | null>(null);
  const [understandingPhase, setUnderstandingPhase] = useState<UnderstandingPhase>("idle");
  const [understandingMsg, setUnderstandingMsg] = useState("");
  const [pendingChanges, setPendingChanges] = useState<FieldUnderstandingChange[]>([]);
  const [useLocalFallback, setUseLocalFallback] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await getPreviewDetail(draftId);
      setData(d);
      const editable = toEditable(d.columns);
      setFields(editable);
      setInitialFields(cloneFields(editable));
      // v0.3：加载已有 AI 理解（SPEC 19.3）
      try {
        const u = await getUnderstanding(draftId);
        if (u.understanding) {
          setUnderstanding(u.understanding);
          const s = u.understanding.status;
          setUnderstandingPhase(
            s === "confirmed"
              ? "confirmed"
              : s === "needs_user_input"
                ? "needs_input"
                : "ready",
          );
        }
      } catch {
        /* 理解加载失败不阻断预检 */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载预检详情失败");
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => {
    if (fields.length !== initialFields.length) return true;
    return fields.some((f, i) => {
      const o = initialFields[i];
      if (!o) return true;
      return (
        f.type !== o.type ||
        f.role !== o.role ||
        f.format !== o.format ||
        f.defaultAggregation !== o.defaultAggregation ||
        f.includeInAnalysis !== o.includeInAnalysis
      );
    });
  }, [fields, initialFields]);

  const truncated = data
    ? (data.originalRowCount ?? data.rowCount) > data.rowCount
    : false;

  const hasBlocking =
    understanding?.ambiguities.some((a) => a.blocking) ?? false;

  /* —— v0.3：AI 数据理解（SPEC 20.1） —— */

  async function startUnderstand(force = false) {
    setUnderstandingPhase("loading");
    setUnderstandingMsg("正在理解数据…");
    setPendingChanges([]);
    setUseLocalFallback(false);
    await runUnderstand(
      draftId,
      {
        onStage: (s) => setUnderstandingMsg(s),
        onUnderstanding: (u) => setUnderstanding(u),
        onAmbiguity: (u) => setUnderstanding(u),
        onDone: (status) => {
          if (status === "fallback") {
            setUnderstandingPhase("fallback");
            setUseLocalFallback(true);
            setUnderstandingMsg("未配置 LLM，可使用本地模式生成看板。");
          } else if (status === "needs_user_input") {
            setUnderstandingPhase("needs_input");
          } else {
            setUnderstandingPhase("ready");
          }
        },
        onError: (m) => {
          setUnderstandingPhase("failed");
          setUnderstandingMsg(m);
        },
      },
      { force },
    );
  }

  function applyFieldChange(changes: FieldUnderstandingChange[]) {
    setPendingChanges((prev) => {
      const merged = [...prev];
      for (const c of changes) {
        const idx = merged.findIndex((m) => m.field === c.field);
        if (idx >= 0)
          merged[idx] = {
            field: c.field,
            changes: { ...merged[idx].changes, ...c.changes },
          };
        else merged.push(c);
      }
      return merged;
    });
    setUnderstanding((prev) => {
      if (!prev) return prev;
      const fields = prev.fields.map((f) => {
        const c = changes.find((x) => x.field === f.field);
        return c ? { ...f, ...c.changes } : f;
      });
      return { ...prev, fields };
    });
  }

  async function saveUnderstandingChanges() {
    if (!understanding || pendingChanges.length === 0) return;
    try {
      const r = await updateUnderstanding(draftId, {
        fieldChanges: pendingChanges,
      });
      setUnderstanding(r.understanding);
      setPendingChanges([]);
      setBanner({ type: "ok", msg: "语义修改已保存。" });
    } catch (e) {
      setBanner({ type: "error", msg: e instanceof Error ? e.message : "保存失败" });
    }
  }

  async function resolveUnderstandingAmbiguity(
    ambiguityId: string,
    choiceChanges: FieldUnderstandingChange[],
  ) {
    if (!understanding) return;
    const ambiguity = understanding.ambiguities.find((item) => item.id === ambiguityId);
    const relevantPending = pendingChanges.filter((change) =>
      ambiguity?.fields.includes(change.field),
    );
    const merged = [...relevantPending];
    for (const change of choiceChanges) {
      const index = merged.findIndex((item) => item.field === change.field);
      if (index >= 0) {
        merged[index] = {
          field: change.field,
          changes: { ...merged[index].changes, ...change.changes },
        };
      } else {
        merged.push(change);
      }
    }
    try {
      const result = await updateUnderstanding(draftId, {
        ambiguityResolutions: [{ ambiguityId, fieldChanges: merged }],
      });
      setUnderstanding(result.understanding);
      setPendingChanges((previous) =>
        previous.filter((change) => !merged.some((item) => item.field === change.field)),
      );
      setUnderstandingPhase(
        result.understanding.ambiguities.some((item) => item.blocking)
          ? "needs_input"
          : "ready",
      );
      setBanner({ type: "ok", msg: "歧义答案已保存。" });
    } catch (e) {
      setBanner({
        type: "error",
        msg: e instanceof Error ? e.message : "保存歧义答案失败",
      });
    }
  }

  async function confirmUnderstandingAction() {
    if (!understanding) return;
    try {
      if (pendingChanges.length > 0) {
        const r = await updateUnderstanding(draftId, {
          fieldChanges: pendingChanges,
        });
        setUnderstanding(r.understanding);
        setPendingChanges([]);
      }
      const r = await updateUnderstanding(draftId, { confirm: true });
      setUnderstanding(r.understanding);
      setUnderstandingPhase("confirmed");
      setBanner({ type: "ok", msg: "AI 数据理解已确认。" });
    } catch (e) {
      setBanner({
        type: "error",
        msg: e instanceof Error
          ? e.message
          : "确认失败（可能存在未处理的阻塞问题）",
      });
      setUnderstandingPhase("needs_input");
    }
  }

  /* —— 快捷操作（SPEC 9.6） —— */

  function acceptAll() {
    // 接受当前推断：相当于清除 userModified 提示，但保留当前值
    setBanner({ type: "ok", msg: "已接受当前全部推断，可直接生成看板。" });
  }

  function resetAll() {
    setFields(cloneFields(initialFields));
    setIssues([]);
    setBanner({ type: "ok", msg: "已重置为初始推断。" });
  }

  function ignoreEmptyFields() {
    setFields((prev) =>
      prev.map((f) => ({
        ...f,
        includeInAnalysis:
          (f.nullRate ?? 0) >= 1 ? false : f.includeInAnalysis,
      })),
    );
    setBanner({
      type: "ok",
      msg: "已自动排除全部为空的字段。",
    });
  }

  /* —— 保存字段配置（PUT /config） —— */

  async function saveConfig() {
    if (!data) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await updateFieldConfig(draftId, toUpdateBody(fields));
      setIssues(res.issues);
      // 同步服务端返回的最新 columns（含 userModified 标记等）
      if (res.columns && res.columns.length > 0) {
        const editable = toEditable(res.columns);
        setFields(editable);
        setInitialFields(cloneFields(editable));
      }
      const errs = res.issues.filter((i) => i.level === "error");
      if (errs.length > 0) {
        setBanner({
          type: "error",
          msg: `保存成功，但存在 ${errs.length} 条阻断错误，请先修复后再生成看板。`,
        });
      } else {
        setBanner({ type: "ok", msg: "字段配置已保存。" });
      }
    } catch (e) {
      const err = e as Error & { details?: FieldConfigIssue[] };
      if (Array.isArray(err.details)) {
        setIssues(err.details);
      }
      setBanner({
        type: "error",
        msg: err.message || "保存失败",
      });
    } finally {
      setSaving(false);
    }
  }

  /* —— 确认并生成看板（POST /confirm） —— */

  async function confirmAndGo() {
    if (!data) return;
    setConfirming(true);
    setBanner(null);
    try {
      // 先保存当前编辑（即便没改动也提交一次，让服务端做最终校验）
      const updateBody = toUpdateBody(fields);
      let savedIssues: FieldConfigIssue[] = [];
      try {
        const saved = await updateFieldConfig(draftId, updateBody);
        savedIssues = saved.issues;
        setIssues(saved.issues);
        if (saved.columns && saved.columns.length > 0) {
          const editable = toEditable(saved.columns);
          setFields(editable);
          setInitialFields(cloneFields(editable));
        }
      } catch (e) {
        const err = e as Error & { details?: FieldConfigIssue[] };
        if (Array.isArray(err.details)) {
          setIssues(err.details);
        }
        const errs = (err.details ?? []).filter((i) => i.level === "error");
        if (errs.length > 0) {
          setBanner({
            type: "error",
            msg: `字段配置有 ${errs.length} 条阻断错误，无法生成看板。`,
          });
          setConfirming(false);
          return;
        }
        throw e;
      }

      const errs = savedIssues.filter((i) => i.level === "error");
      if (errs.length > 0) {
        setBanner({
          type: "error",
          msg: `字段配置有 ${errs.length} 条阻断错误，无法生成看板。`,
        });
        setConfirming(false);
        return;
      }

      const result = await confirmDataset(draftId, updateBody);
      setBanner({ type: "ok", msg: "已确认，正在跳转到看板…" });
      // 给用户一瞬反馈再跳
      setTimeout(() => {
        router.push(result.redirectTo);
      }, 300);
    } catch (e) {
      const err = e as Error & { details?: FieldConfigIssue[] };
      if (Array.isArray(err.details)) {
        setIssues(err.details);
      }
      setBanner({
        type: "error",
        msg: err.message || "确认失败",
      });
    } finally {
      setConfirming(false);
    }
  }

  /* —— 渲染 —— */

  if (loading) {
    return (
      <div className="container">
        <div className="row">
          <span className="spinner" />
          <span className="muted">正在加载数据预检详情…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="banner error">{error}</div>
        <div className="row" style={{ marginTop: 14 }}>
          <Link className="btn" href="/">
            返回首页
          </Link>
          <button className="btn" onClick={load}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logo">🔍</div>
          <div>
            <h1>数据预检 · {data.name}</h1>
            <p>
              确认字段类型与角色后，再生成看板 ·
              <span className="muted"> 状态：</span>
              <span
                className={`fc-status-pill ${
                  data.status === "ready" ? "ready" : "draft"
                }`}
                style={{ marginLeft: 6 }}
              >
                {data.status === "ready" ? "已确认" : "草稿"}
              </span>
            </p>
          </div>
        </div>
        <div className="row">
          <Link className="btn" href="/" aria-label="返回首页">
            ← 返回
          </Link>
        </div>
      </div>

      {/* 1. 文件摘要（SPEC 9.3） */}
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="section-title">文件摘要</p>
        <div className="fc-summary">
          <div className="fc-summary-item">
            <p className="fc-summary-label">数据集名</p>
            <div className="fc-summary-value" style={{ fontSize: 14 }}>
              {data.name}
            </div>
          </div>
          <div className="fc-summary-item">
            <p className="fc-summary-label">文件名</p>
            <div
              className="fc-summary-value"
              style={{ fontSize: 13, wordBreak: "break-all" }}
            >
              {data.fileName}
            </div>
          </div>
          {data.sheetName && (
            <div className="fc-summary-item">
              <p className="fc-summary-label">工作表</p>
              <div className="fc-summary-value" style={{ fontSize: 14 }}>
                {data.sheetName}
              </div>
            </div>
          )}
          <div className="fc-summary-item">
            <p className="fc-summary-label">原始行数</p>
            <div className={`fc-summary-value ${truncated ? "trunc" : ""}`}>
              {data.originalRowCount ?? data.rowCount}
            </div>
          </div>
          <div className="fc-summary-item">
            <p className="fc-summary-label">存储行数</p>
            <div className="fc-summary-value">{data.storedRowCount ?? data.rowCount}</div>
          </div>
          <div className="fc-summary-item">
            <p className="fc-summary-label">列数</p>
            <div className="fc-summary-value">{data.columns.length}</div>
          </div>
          <div className="fc-summary-item">
            <p className="fc-summary-label">是否截断</p>
            <div
              className={`fc-summary-value ${truncated ? "trunc" : ""}`}
              style={{ fontSize: 14 }}
            >
              {truncated ? "是" : "否"}
            </div>
          </div>
          <div className="fc-summary-item">
            <p className="fc-summary-label">来源</p>
            <div className="fc-summary-value" style={{ fontSize: 14 }}>
              {data.source.toUpperCase()}
            </div>
          </div>
        </div>
      </div>

      {/* 2. 数据质量概览（SPEC 9.4） */}
      <div style={{ marginBottom: 20 }}>
        <QualityOverview quality={data.quality} />
      </div>

      {/* 2.5 AI 数据理解（v0.3，SPEC 20.1） */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="row spread" style={{ marginBottom: 12 }}>
          <p className="section-title" style={{ margin: 0 }}>
            AI 数据理解
          </p>
          <UnderstandingStatus phase={understandingPhase} />
        </div>

        {understandingPhase === "loading" && (
          <div className="row">
            <span className="spinner" />
            <span className="muted">{understandingMsg || "正在理解数据…"}</span>
          </div>
        )}

        {understandingPhase === "idle" && (
          <div className="row spread">
            <span className="muted" style={{ fontSize: 13, maxWidth: 600 }}>
              让 AI 先理解数据语义与字段关系，再生成更贴切的分析。未配置 LLM 时可使用本地规则模式。
            </span>
            <button className="btn btn-primary" onClick={() => startUnderstand()}>
              开始 AI 理解
            </button>
          </div>
        )}

        {understandingPhase === "fallback" && (
          <div className="banner warn">
            {understandingMsg ||
              "未配置 LLM。可直接在下方生成看板（本地规则引擎）。"}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => startUnderstand(true)}>
                重试
              </button>
            </div>
          </div>
        )}

        {understandingPhase === "failed" && (
          <div className="banner error">
            {understandingMsg || "数据理解失败。"}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => startUnderstand(true)}>
                重试
              </button>
              <button className="btn" onClick={() => setUseLocalFallback(true)}>
                使用本地规则模式
              </button>
            </div>
          </div>
        )}

        {understanding &&
          (understandingPhase === "ready" ||
            understandingPhase === "needs_input" ||
            understandingPhase === "confirmed") && (
            <>
              <UnderstandingOverview understanding={understanding} />
              <AmbiguityPanel
                ambiguities={understanding.ambiguities}
                pendingFields={pendingChanges.map((change) => change.field)}
                onResolve={resolveUnderstandingAmbiguity}
              />
              <div style={{ marginTop: 12 }}>
                <p
                  className="section-title"
                  style={{ fontSize: 13, marginBottom: 6 }}
                >
                  字段语义（可修正，不影响物理类型）
                </p>
                <FieldUnderstandingTable
                  fields={understanding.fields}
                  onChange={applyFieldChange}
                />
              </div>
              <DerivedMetricSuggestions
                derivedMetrics={understanding.derivedMetrics}
              />
              <div className="row" style={{ marginTop: 12, gap: 8 }}>
                {understandingPhase !== "confirmed" && (
                  <>
                    <button
                      className="btn"
                      onClick={saveUnderstandingChanges}
                      disabled={pendingChanges.length === 0}
                    >
                      保存修改
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={confirmUnderstandingAction}
                      disabled={hasBlocking}
                      title={
                        hasBlocking
                          ? "存在未处理的阻塞问题"
                          : "确认 AI 理解"
                      }
                    >
                      确认理解
                    </button>
                    <button className="btn" onClick={() => startUnderstand(true)}>
                      重新理解
                    </button>
                    <button
                      className="btn"
                      onClick={() => setUseLocalFallback(true)}
                    >
                      使用本地规则模式
                    </button>
                  </>
                )}
                {understandingPhase === "confirmed" && (
                  <span className="muted">
                    ✓ 已确认。可继续生成看板。
                  </span>
                )}
              </div>
            </>
          )}
      </div>

      {/* 3. 字段配置表（SPEC 9.5） */}
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="section-title">字段配置</p>

        {/* 快捷操作（SPEC 9.6） */}
        <div className="fc-toolbar">
          <button
            className="btn"
            onClick={acceptAll}
            disabled={data.status === "ready"}
            title="接受当前全部推断，不再修改"
          >
            接受全部推断
          </button>
          <button
            className="btn"
            onClick={resetAll}
            disabled={!dirty || data.status === "ready"}
            title="撤销所有修改，回到服务端推断"
          >
            重置推断
          </button>
          <button
            className="btn"
            onClick={ignoreEmptyFields}
            disabled={data.status === "ready"}
            title="把全部为空的字段排除出分析"
          >
            忽略空字段
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={saveConfig}
            disabled={saving || confirming || !dirty}
            title="保存当前字段配置到服务端（不生成看板）"
          >
            {saving ? "保存中…" : "保存配置"}
          </button>
        </div>

        <FieldConfigTable
          fields={fields}
          onChange={setFields}
          issues={issues}
        />

        {data.status === "ready" && (
          <div className="banner warn" style={{ marginTop: 14 }}>
            该数据集已确认。如需修改字段，请返回看板后重新导入。
          </div>
        )}

        {banner && (
          <div
            className={`banner ${
              banner.type === "ok"
                ? "warn"
                : banner.type === "warn"
                  ? "warn"
                  : "error"
            }`}
            style={{ marginTop: 14 }}
          >
            {banner.msg}
          </div>
        )}
      </div>

      {/* 4. 前 20 行数据预览（SPEC 9.2.4） */}
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="section-title">前 20 行预览</p>
        {data.previewRows.length === 0 ? (
          <div className="empty">没有可预览的行。</div>
        ) : (
          <div className="table-wrap fc-preview-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  {data.columns.map((c) => (
                    <th key={c.name}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.previewRows.map((row, ri) => (
                  <tr key={ri}>
                    <td className="faint">{ri + 1}</td>
                    {data.columns.map((c) => (
                      <td key={c.name}>
                        {formatCell(row[c.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. 生成看板（SPEC 9.2.5 / 9.7） */}
      <div className="card">
        <p className="section-title">生成看板</p>
        <div className="row spread">
          <div className="muted" style={{ fontSize: 13, maxWidth: 600 }}>
            点击「生成看板」后，系统会再次校验字段配置（SPEC 9.7），
            通过则进入分析阶段。如有阻断错误将定位到具体字段。
            {useLocalFallback && " 当前已明确选择本地规则模式。"}
          </div>
          <div className="row">
            <Link className="btn" href="/">
              取消
            </Link>
            <button
              className="btn btn-primary"
              onClick={confirmAndGo}
              disabled={
                confirming ||
                saving ||
                data.status === "ready" ||
                (!!understanding &&
                  understanding.status !== "confirmed" &&
                  !useLocalFallback)
              }
            >
              {confirming ? "校验中…" : "✨ 生成看板"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
