"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadDataset } from "@/lib/api-client";

export default function Uploader() {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setBusy(true);
    setErr("");
    try {
      const r = await uploadDataset(file);
      // v0.2 阶段 D：上传后进入预检页，而不是直接看板
      router.push(`/import/${r.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "上传失败，请重试");
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <div className="big">把 Excel / CSV 拖进来 ✨</div>
        <div className="hint">
          或点击选择文件 · 支持 .xlsx / .xls / .csv · 单文件 ≤ 15MB
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.txt"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>
      {busy && (
        <div className="row" style={{ marginTop: 14 }}>
          <span className="spinner" />
          <span className="muted">正在解析并入库…</span>
        </div>
      )}
      {err && <div className="banner error" style={{ marginTop: 14 }}>{err}</div>}
    </div>
  );
}
