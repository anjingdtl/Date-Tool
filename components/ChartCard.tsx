import * as echarts from "echarts";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildChartOption } from "@/lib/chart";
import type { ChartSpec, DatasetRow, EChartsOption } from "@/lib/types";
import DataTable from "./DataTable";

type ExportStatus = "idle" | "copying" | "copied" | "downloading" | "error";

// 用设计系统的 --bg，避免 PNG 透底造成黑边；挑选品牌基底色让导出图与页面观感一致
const CARD_BG = "#1f4a48";

function slug(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
}

export default function ChartCard({
  spec,
  rows = [],
  option,
  index = 0,
}: {
  spec: ChartSpec;
  rows?: DatasetRow[];
  option?: EChartsOption;
  /** 第几张图，用于 PNG 文件名排序 */
  index?: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");

  useEffect(() => {
    if (spec.type === "table" || spec.type === "kpi") return;
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, {
      renderer: "canvas",
    });
    chartInstance.current = chart;
    const opt = option ?? buildChartOption(spec, rows);
    chart.setOption(opt as unknown as echarts.EChartsCoreOption);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartInstance.current = null;
    };
  }, [spec, rows, option]);

  // 导出 PNG：用 html2canvas 抓整张卡片（含标题/说明/图），得到更接近"所见即所得"的成品图
  const capturePng = useCallback(async (): Promise<Blob> => {
    if (!cardRef.current) throw new Error("卡片尚未挂载");
    const mod = await import("html2canvas");
    const html2canvas = mod.default;

    // 在截图前临时锁高，避免动画中 resize 造成截图截断
    const chartBox = chartRef.current;
    const prevH = chartBox?.style.height;
    if (chartBox) chartBox.style.height = chartBox.offsetHeight + "px";

    let blob: Blob;
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: CARD_BG,
        scale: Math.min(window.devicePixelRatio || 1, 2) * 2, // 输出 2x 高清
        useCORS: true,
        logging: false,
        // 不抓工具栏本身（按钮会显得多余）
        ignoreElements: (el) =>
          el.classList?.contains("chart-toolbar") ?? false,
        // html2canvas 1.4.1 不支持 color-mix() —— chart-card 子树已用 --export-* 预计算 rgba
        // 此处 onclone 仅做兜底：万一子树内仍残留 color-mix 字符串，用 inline style 替换掉
        onclone: (doc) => {
          const root = doc.documentElement;
          const cv = (n: string) =>
            getComputedStyle(root).getPropertyValue(n).trim();
          const accent = cv("--accent");
          const parse = (s: string): [number, number, number, number] => {
            s = s.trim();
            if (s === "transparent") return [0, 0, 0, 0];
            if (s.startsWith("#")) {
              let h = s.slice(1);
              if (h.length === 3) h = h.split("").map((x) => x + x).join("");
              const n = parseInt(h, 16);
              return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
            }
            const m = s.match(/rgba?\((.+)\)/);
            if (m) {
              const p = m[1].split(",").map((x) => x.trim());
              return [
                Number(p[0]),
                Number(p[1]),
                Number(p[2]),
                p[3] === undefined ? 1 : Number(p[3]),
              ];
            }
            return [0, 0, 0, 1];
          };
          const mix = (a: string, aPct: number, b: string) => {
            const [r1, g1, b1, a1] = parse(a);
            const [r2, g2, b2, a2] = parse(b);
            const k = aPct / 100;
            const r = Math.round(r1 * k + r2 * (1 - k));
            const g = Math.round(g1 * k + g2 * (1 - k));
            const bl = Math.round(b1 * k + b2 * (1 - k));
            const al = a1 * k + a2 * (1 - k);
            return al < 1
              ? `rgba(${r},${g},${bl},${al.toFixed(3)})`
              : `rgb(${r},${g},${bl})`;
          };
          const evalMix = (raw: string): string =>
            raw.replace(
              /color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)/gi,
              (_m, a, pa, b) => mix(a.trim(), parseFloat(pa), b.trim()),
            );
          const walk = (el: Element) => {
            const cs = doc.defaultView!.getComputedStyle(el);
            const props = [
              "background",
              "background-color",
              "background-image",
              "box-shadow",
              "border-color",
              "border-top-color",
              "border-right-color",
              "border-bottom-color",
              "border-left-color",
              "color",
              "outline-color",
              "fill",
              "stroke",
              "text-shadow",
            ];
            for (const p of props) {
              let v = cs.getPropertyValue(p);
              if (!v || !v.includes("color-mix")) continue;
              v = evalMix(v);
              if (v && !v.includes("color-mix")) {
                (el as HTMLElement).style.setProperty(p, v);
              }
            }
            // 用 accent 兜底防止 CSS 变量解析不到
            if (accent && !accent.startsWith("#") === false) void accent;
            for (const c of Array.from(el.children)) walk(c);
          };
          walk(doc.body);
        },
      });
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob 失败"))),
          "image/png",
        );
      });
    } finally {
      if (chartBox) chartBox.style.height = prevH ?? "";
    }

    return blob;
  }, []);

  // 复制到剪贴板
  const handleCopy = useCallback(async () => {
    if (exportStatus === "copying") return;
    setExportStatus("copying");
    try {
      const blob = await capturePng();
      // Safari/iOS 不支持 image/png 写入剪贴板时静默降级为下载
      const canClipboardImage =
        typeof ClipboardItem !== "undefined" &&
        typeof window !== "undefined" &&
        "ClipboardItem" in window;
      if (canClipboardImage) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          setExportStatus("copied");
          setTimeout(() => setExportStatus("idle"), 1600);
          return;
        } catch {
          /* fallback to download */
        }
      }
      triggerDownload(blob);
      setExportStatus("downloading");
      setTimeout(() => setExportStatus("idle"), 1600);
    } catch (e) {
      console.error("[ChartCard] export failed", e);
      setExportStatus("error");
      setTimeout(() => setExportStatus("idle"), 2000);
    }
  }, [capturePng, exportStatus]);

  // 直接下载文件
  const handleDownload = useCallback(async () => {
    if (exportStatus === "downloading") return;
    setExportStatus("downloading");
    try {
      const blob = await capturePng();
      triggerDownload(blob);
      setTimeout(() => setExportStatus("idle"), 1200);
    } catch (e) {
      console.error("[ChartCard] download failed", e);
      setExportStatus("error");
      setTimeout(() => setExportStatus("idle"), 2000);
    }
  }, [capturePng, exportStatus]);

  function triggerDownload(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(index + 1).padStart(2, "0")}_${slug(spec.title)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const copyLabel =
    exportStatus === "copying"
      ? "复制中…"
      : exportStatus === "copied"
      ? "已复制"
      : exportStatus === "downloading"
      ? "已下载"
      : exportStatus === "error"
      ? "失败"
      : "复制 PNG";

  const downloadLabel =
    exportStatus === "downloading" ? "下载中…" : "下载 PNG";

  return (
    <div className="chart-card" ref={cardRef}>
      <div className="chart-card-head">
        <div className="chart-card-titles">
          <p className="chart-title">{spec.title}</p>
          {spec.description && (
            <p className="chart-desc">{spec.description}</p>
          )}
        </div>

        {spec.type !== "table" && (
          <div className="chart-toolbar" role="toolbar" aria-label="图表操作">
            <button
              type="button"
              className={`chart-icon-btn ${exportStatus}`}
              onClick={handleCopy}
              disabled={exportStatus === "copying" || exportStatus === "downloading"}
              title="复制为 PNG 图片（可粘贴到微信/飞书/PPT）"
              aria-label="复制为 PNG 图片"
            >
              {exportStatus === "copying" ? (
                <Spinner />
              ) : exportStatus === "copied" ? (
                <CheckIcon />
              ) : (
                <CopyIcon />
              )}
              <span>{copyLabel}</span>
            </button>
            <button
              type="button"
              className="chart-icon-btn"
              onClick={handleDownload}
              disabled={exportStatus === "copying" || exportStatus === "downloading"}
              title="下载为 PNG 文件"
              aria-label="下载为 PNG 文件"
            >
              {exportStatus === "downloading" ? <Spinner /> : <DownloadIcon />}
              <span>{downloadLabel}</span>
            </button>
          </div>
        )}
      </div>

      {spec.type === "table" ? (
        <DataTable rows={spec.dataRows ?? rows} />
      ) : spec.type === "kpi" ? (
        <div className="kpi-value">{spec.scalar ?? "—"}</div>
      ) : (
        <div className="chart-box" ref={chartRef} />
      )}
    </div>
  );
}

/* —— icon —— */

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <rect
        x="4.5"
        y="4.5"
        width="8"
        height="9"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.5 11V3.5A1 1 0 0 1 4.5 2.5H10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M8 2v8m0 0l-3-3m3 3l3-3M3.5 13.5h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return <span className="spinner spinner-mini" aria-hidden />;
}
