"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { deleteDataset, listDatasets } from "@/lib/api-client";
import type { PublicDataset } from "@/lib/types";

export default function DatasetList() {
  const [list, setList] = useState<PublicDataset[]>([]);
  const [loading, setLoading] = useState(true);
  /** v0.2 阶段 H：列表加载错误反馈(SPEC 27.1) */
  const [loadError, setLoadError] = useState("");
  /** v0.2 阶段 H：删除操作错误反馈(SPEC 27.1: 数据集删除失败会提示) */
  const [deleteError, setDeleteError] = useState("");
  /** 正在删除的 id，用于禁用按钮 */
  const [deletingId, setDeletingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setList(await listDatasets());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "数据集列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onDelete(id: string) {
    if (!confirm("确定删除该数据集？此操作不可撤销。")) return;
    setDeletingId(id);
    setDeleteError("");
    try {
      await deleteDataset(id);
      await load();
    } catch (e) {
      // SPEC 27.1: 数据集删除失败会提示
      setDeleteError(
        e instanceof Error ? `删除失败：${e.message}` : "删除失败，请重试",
      );
    } finally {
      setDeletingId("");
    }
  }

  if (loading) {
    return (
      <div className="row">
        <span className="spinner" />
        <span className="muted">加载数据集列表…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <div className="banner error">{loadError}</div>
        <button className="btn" onClick={load}>
          重试
        </button>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="empty">
        还没有数据集，先在上面导入一份 Excel / CSV 吧～
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      {deleteError && <div className="banner error">{deleteError}</div>}
      {list.map((d) => (
        <div className="ds-item" key={d.id}>
          <div>
            <div className="name">{d.name}</div>
            <div className="meta">
              {d.rowCount} 行 · {d.columns.length} 列 · {d.fileName}
            </div>
            <div style={{ marginTop: 8 }} className="pill-group">
              <span className={`badge ${d.hasAnalysis ? "" : "muted"}`}>
                {d.hasAnalysis ? "已分析" : "未分析"}
              </span>
              <span className="badge muted">{d.source.toUpperCase()}</span>
              {d.status && d.status !== "ready" && d.status !== "completed" && (
                <span className="badge muted">{d.status}</span>
              )}
            </div>
          </div>
          <div className="row">
            <Link className="btn" href={`/dashboard/${d.id}`}>
              打开看板
            </Link>
            <button
              className="btn"
              onClick={() => onDelete(d.id)}
              disabled={deletingId === d.id}
            >
              {deletingId === d.id ? "删除中…" : "删除"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
