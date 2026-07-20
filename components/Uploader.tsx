"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadDataset } from "@/lib/api-client";

const MAX_SIZE = 15 * 1024 * 1024; // 15MB，与 route.ts bodySizeLimit 一致
const ACCEPTED_EXT = [".csv", ".xlsx", ".xls", ".txt"];

export default function Uploader() {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function validateFile(file: File): string | null {
    if (file.size > MAX_SIZE) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      return `文件 ${mb}MB 超过 15MB 上限，请拆分或精简后再上传`;
    }
    const lower = file.name.toLowerCase();
    if (!ACCEPTED_EXT.some((ext) => lower.endsWith(ext))) {
      return "仅支持 .xlsx / .xls / .csv / .txt 格式";
    }
    if (file.size === 0) {
      return "文件为空，请检查后重试";
    }
    return null;
  }

  async function handleFile(file: File) {
    const validateErr = validateFile(file);
    if (validateErr) {
      setErr(validateErr);
      return;
    }
    setBusy(true);
    setErr("");
    setProgress(0);
    try {
      const r = await uploadDataset(file, undefined, {
        onProgress: (loaded, total) => {
          setProgress(Math.round((loaded / total) * 100));
        },
      });
      // 上传完成后服务端还在解析/入库，progress 置为 null 表示进入下一阶段
      setProgress(null);
      // v0.2 阶段 D：上传后进入预检页，而不是直接看板
      router.push(`/import/${r.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "上传失败，请重试");
      setBusy(false);
      setProgress(null);
    }
  }

  const pctText =
    progress === null
      ? "正在解析并入库…"
      : progress < 100
        ? `正在上传 ${progress}%`
        : "上传完成，正在解析入库…";

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
        <div className="row" style={{ marginTop: 14, flexDirection: "column", alignItems: "stretch" }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="spinner" />
            <span className="muted">{pctText}</span>
          </div>
          {progress !== null && (
            <div
              style={{
                marginTop: 8,
                height: 6,
                borderRadius: 3,
                background: "var(--glass-border, rgba(255,255,255,0.1))",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "var(--accent, #4f8cff)",
                  transition: "width 120ms ease-out",
                }}
              />
            </div>
          )}
        </div>
      )}
      {err && <div className="banner error" style={{ marginTop: 14 }}>{err}</div>}
    </div>
  );
}
