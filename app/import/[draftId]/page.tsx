"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import FieldConfigTable, {
  type EditableField,
} from "@/components/FieldConfigTable";
import QualityOverview from "@/components/QualityOverview";
import {
  confirmDataset,
  getPreviewDetail,
  updateFieldConfig,
  type PreviewDetail,
} from "@/lib/api-client";
import type {
  Aggregation,
  ColumnMeta,
  FieldFormat,
  FieldRole,
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await getPreviewDetail(draftId);
      setData(d);
      const editable = toEditable(d.columns);
      setFields(editable);
      setInitialFields(cloneFields(editable));
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
          </div>
          <div className="row">
            <Link className="btn" href="/">
              取消
            </Link>
            <button
              className="btn btn-primary"
              onClick={confirmAndGo}
              disabled={confirming || saving || data.status === "ready"}
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
