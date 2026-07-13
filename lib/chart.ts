import type { ChartSpec, DatasetRow, EChartsOption } from "./types";

const PALETTE = [
  "#6c8cff",
  "#45e0c8",
  "#ff7eb6",
  "#ffcf5c",
  "#9b8cff",
  "#5cc8ff",
  "#ff9f6c",
  "#7ee787",
];

/** 主题相关色 —— 运行时从 :root 读 CSS 变量，让图表跟随主题变 */
function themeColors() {
  const fallback = { axis: "#26304d", text: "#9aa6c2", labelBg: "rgba(15, 42, 41, 0.72)" };
  if (typeof document === "undefined") return fallback;
  const cs = getComputedStyle(document.documentElement);
  const axis = cs.getPropertyValue("--chart-axis").trim() || fallback.axis;
  const text = cs.getPropertyValue("--chart-text").trim() || fallback.text;
  // labelBg：默认从 --bg 派生 70% 透明
  const bg = cs.getPropertyValue("--bg").trim() || "#1f4a48";
  const labelBg = `color-mix(in srgb, ${bg} 70%, transparent)`;
  return { axis, text, labelBg };
}

function getNumber(row: DatasetRow, field: string): number | null {
  const v = row[field];
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function reduce(values: number[], agg: ChartSpec["agg"]): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case "count":
      return values.length;
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "sum":
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

interface SeriesData {
  categories: string[];
  seriesNames: string[];
  matrix: number[][]; // [groupIndex][categoryIndex]
}

function computeSeries(spec: ChartSpec, rows: DatasetRow[]): SeriesData {
  const xKey = spec.xField;
  const gKey = spec.groupBy;
  const isCount = spec.agg === "count" || spec.yField === "__count__";

  const groups = new Map<string, Map<string, number[]>>();
  const xSet = new Set<string>();

  for (const row of rows) {
    const xv = row[xKey];
    if (xv === null || xv === undefined || xv === "") continue;
    const x = String(xv);
    const g = gKey ? String(row[gKey] ?? "其他") : "__all__";
    if (!groups.has(g)) groups.set(g, new Map());
    const gmap = groups.get(g)!;
    if (!gmap.has(x)) gmap.set(x, []);
    if (isCount) gmap.get(x)!.push(1);
    else {
      const n = getNumber(row, spec.yField);
      if (n !== null) gmap.get(x)!.push(n);
    }
    xSet.add(x);
  }

  let categories = [...xSet];
  const seriesNames = [...groups.keys()];

  // 排序：折线按 x 升序（适配日期/时间）；柱/饼按总量降序
  if (spec.type === "line") {
    categories.sort();
  } else {
    const totals = new Map<string, number>();
    for (const x of categories) {
      let t = 0;
      for (const g of seriesNames) t += reduce(groups.get(g)!.get(x) ?? [], spec.agg);
      totals.set(x, t);
    }
    categories.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }

  const matrix = seriesNames.map((g) =>
    categories.map((x) => reduce(groups.get(g)!.get(x) ?? [], spec.agg)),
  );

  return { categories, seriesNames, matrix };
}

export function buildChartOption(
  spec: ChartSpec,
  rows: DatasetRow[],
): EChartsOption {
  const { categories, seriesNames, matrix } = computeSeries(spec, rows);
  const { axis: AXIS_COLOR, text: TEXT_COLOR, labelBg } = themeColors();

  const baseAxis = {
    axisLine: { lineStyle: { color: AXIS_COLOR } },
    axisLabel: { color: TEXT_COLOR },
    splitLine: { lineStyle: { color: AXIS_COLOR } },
  };

  if (spec.type === "pie") {
    const data = categories.map((name, i) => ({
      name,
      value: matrix[0]?.[i] ?? 0,
    }));
    return {
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: {
        type: "scroll",
        bottom: 0,
        textStyle: { color: TEXT_COLOR },
      },
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          center: ["50%", "46%"],
          data,
          label: {
            color: TEXT_COLOR,
            formatter: "{b}\n{c} ({d}%)",
          },
          labelLine: { lineStyle: { color: TEXT_COLOR } },
          itemStyle: { borderColor: "#131a2e", borderWidth: 2 },
        },
      ],
    };
  }

  // 数值标签格式：整数保留 0 位、大数保留整数、小数按需保留 1-2 位
  const fmt = (v: number) => {
    if (!Number.isFinite(v)) return "";
    const a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1).replace(/\.0$/, "");
    return v.toFixed(2).replace(/\.?0+$/, "");
  };

  // 折线图 + 柱状图：所有数据点都显示数值标签
  // 注：formatter 必须用字符串模板（不能是函数）—— 服务端 JSON 序列化会丢失函数
  // ECharts 支持 rich text："{a|{c}}" 等；这里用 rich 模式让数字更显眼
  const series = seriesNames.map((name, gi) => {
    const seriesData = matrix[gi];
    const isLine = spec.type === "line";

    //    const formatter = isLine ? "{a|{c}}" : "{c}";
    const formatter = "{c}";

    const labelCfg: Record<string, unknown> = {
      show: true,
      position: "top",
      color: TEXT_COLOR,
      fontSize: isLine ? 10 : 10.5,
      fontFamily:
        "JetBrains Mono, SF Mono, Cascadia Code, Consolas, monospace",
      formatter,
      // 折线图给个深色背景药丸；柱图用 text-shadow 让数字压住柱顶
      ...(isLine
        ? {
            backgroundColor: labelBg,
            padding: [2, 5],
            borderRadius: 4,
            borderColor: AXIS_COLOR,
            borderWidth: 0.5,
          }
        : {
            textShadowColor: labelBg,
            textShadowBlur: 3,
          }),
      // rich 文本样式
      rich: isLine
        ? {
            a: {
              color: TEXT_COLOR,
              fontSize: 10,
              fontWeight: 600,
              fontFamily:
                "JetBrains Mono, SF Mono, Cascadia Code, Consolas, monospace",
            },
          }
        : undefined,
      // 折线图密集时不避让（避免整张全藏）；柱图允许避让
      labelLayout: isLine ? undefined : { hideOverlap: true },
    };

    return {
      name,
      type: isLine ? "line" : "bar",
      data: seriesData,
      smooth: isLine,
      // 折线图必须 showSymbol=true 标签才能挂到点上；用 symbolSize:0 让圆点隐形
      showSymbol: isLine ? true : undefined,
      symbol: isLine ? "circle" : undefined,
      symbolSize: isLine ? 0 : undefined,
      itemStyle: { color: PALETTE[gi % PALETTE.length] },
      emphasis: { focus: "series" },
      label: labelCfg,
    };
  });

  return {
    tooltip: { trigger: "axis" },
    legend:
      seriesNames.length > 1
        ? { top: 0, textStyle: { color: TEXT_COLOR } }
        : undefined,
    grid: {
      // 给顶部预留标签空间；多系列时上方留更大区域给 legend
      left: 56,
      right: 24,
      top: seriesNames.length > 1 ? 56 : 48,
      bottom: 64,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories,
      ...baseAxis,
      axisLabel: { color: TEXT_COLOR, rotate: categories.length > 6 ? 30 : 0 },
    },
    yAxis: { type: "value", ...baseAxis },
    series,
  };
}
