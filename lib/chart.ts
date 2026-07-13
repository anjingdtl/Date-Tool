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

const AXIS_COLOR = "#26304d";
const TEXT_COLOR = "#9aa6c2";

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
          label: { color: TEXT_COLOR },
          itemStyle: { borderColor: "#131a2e", borderWidth: 2 },
        },
      ],
    };
  }

  const series = seriesNames.map((name, gi) => ({
    name,
    type: spec.type === "line" ? "line" : "bar",
    data: matrix[gi],
    smooth: spec.type === "line",
    showSymbol: spec.type === "line" ? false : undefined,
    itemStyle: { color: PALETTE[gi % PALETTE.length] },
    emphasis: { focus: "series" },
  }));

  return {
    tooltip: { trigger: "axis" },
    legend:
      seriesNames.length > 1
        ? { top: 0, textStyle: { color: TEXT_COLOR } }
        : undefined,
    grid: { left: 48, right: 20, top: 30, bottom: 60, containLabel: true },
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
