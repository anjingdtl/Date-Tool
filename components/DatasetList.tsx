"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { deleteDataset, listDatasets } from "@/lib/api-client";
import type { PublicDataset } from "@/lib/types";

export default function DatasetList() {
  const [list, setList] = useState<PublicDataset[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setList(await listDatasets());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onDelete(id: string) {
    if (!confirm("确定删除该数据集？此操作不可撤销。")) return;
    await deleteDataset(id);
    load();
  }

  if (loading) {
    return (
      <div className="row">
        <span className="spinner" />
        <span className="muted">加载数据集列表…</span>
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
            </div>
          </div>
          <div className="row">
            <Link className="btn" href={`/dashboard/${d.id}`}>
              打开看板
            </Link>
            <button className="btn" onClick={() => onDelete(d.id)}>
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
