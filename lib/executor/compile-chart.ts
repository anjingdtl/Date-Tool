/**
 * lib/executor/compile-chart.ts
 *
 * 从 DashboardItemPlan + TaskExecutionResult 编译图表（SPEC 20.4）。
 *
 * - 不让 LLM 直接生成 ECharts option，统一由本地编译；
 * - area/stacked_bar 复用基础坐标图后增强；scatter/heatmap 本地编译专用 option；
 * - table 携带受控任务结果行，kpi 携带 scalar，前端不再误用原始预览行；
 * - 旧 bar/line/pie/table 完全可读。
 */
import type {
  AnalysisPlan,
  AnalysisTask,
  ChartSpec,
  DashboardItemPlan,
  EChartsOption,
  PlanExecutionResult,
  PlannedChartType,
  TaskExecutionResult,
} from "@/lib/types";
import { buildChartOption } from "@/lib/chart";

export interface CompiledChart {
  itemId: string;
  taskId: string;
  title: string;
  originalType: PlannedChartType;
  visible: boolean;
  width: DashboardItemPlan["width"];
  spec: ChartSpec;
  option: EChartsOption;
  scalar?: number | string | null;
  evidenceId?: string;
}

function pickAxisColumns(
  task: AnalysisTask,
  result: TaskExecutionResult,
): { x?: string; y?: string } {
  const cols = result.columns;
  const x = task.dimensions[0] ?? cols.find((c) => c.type !== "number")?.name;
  const y = task.metrics[0] ?? cols.find((c) => c.type === "number")?.name;
  return { x, y };
}

function mapToBaseType(t: PlannedChartType): "bar" | "line" | "pie" | "table" {
  switch (t) {
    case "line":
    case "area":
      return "line";
    case "bar":
    case "stacked_bar":
    case "scatter":
    case "heatmap":
      return "bar";
    case "pie":
      return "pie";
    case "table":
    case "kpi":
      return "table";
    default:
      return "bar";
  }
}

export function compileChart(
  item: DashboardItemPlan,
  task: AnalysisTask | undefined,
  result: TaskExecutionResult | undefined,
): CompiledChart | null {
  if (!task || !result) return null;
  if (result.status === "failed" || result.status === "skipped") return null;

  if (item.type === "kpi") {
    const { y } = pickAxisColumns(task, result);
    const cellValue = y && result.rows[0] ? result.rows[0][y] : null;
    const scalar =
      result.scalar ??
      (typeof cellValue === "number" || typeof cellValue === "string"
        ? cellValue
        : null);
    return {
      itemId: item.id,
      taskId: task.id,
      title: item.title,
      originalType: item.type,
      visible: item.visible,
      width: item.width,
      spec: {
        id: item.id,
        title: item.title,
        type: "kpi",
        xField: task.dimensions[0] ?? "",
        yField: y ?? "",
        scalar,
      },
      option: {
        graphic: [
          {
            type: "text",
            left: "center",
            top: "middle",
            style: { text: scalar === null ? "—" : String(scalar), fontSize: 42, fontWeight: 700 },
          },
        ],
      },
      scalar,
      evidenceId: result.evidence[0]?.id,
    };
  }

  const { x, y } = pickAxisColumns(task, result);
  if (!x || !y) return null;

  if (item.type === "table") {
    return {
      itemId: item.id,
      taskId: task.id,
      title: item.title,
      originalType: item.type,
      visible: item.visible,
      width: item.width,
      spec: {
        id: item.id,
        title: item.title,
        type: "table",
        xField: x,
        yField: y,
        description: item.description,
        evidenceId: result.evidence[0]?.id,
        dataRows: result.rows,
      },
      option: {},
      evidenceId: result.evidence[0]?.id,
    };
  }

  const spec: ChartSpec = {
    id: item.id,
    title: item.title,
    type: item.type,
    xField: x,
    yField: y,
    agg: "sum",
    description: item.description,
    evidenceId: result.evidence[0]?.id,
    limit: task.limit,
    dataRows: result.rows,
  };
  let option: EChartsOption;
  if (item.type === "scatter") {
    const numeric = result.columns.filter((column) => column.type === "number");
    const xMetric = numeric[0]?.name ?? x;
    const yMetric = numeric[1]?.name ?? y;
    option = {
      tooltip: { trigger: "item" },
      xAxis: { type: "value", name: xMetric },
      yAxis: { type: "value", name: yMetric },
      series: [{
        type: "scatter",
        data: result.rows
          .map((row) => [row[xMetric], row[yMetric]])
          .filter((pair) => pair.every((value) => typeof value === "number")),
      }],
    };
  } else if (item.type === "heatmap" && task.dimensions.length >= 2) {
    const xField = task.dimensions[0];
    const yField = task.dimensions[1];
    const valueField = task.metrics[0] ?? y;
    const xs = [...new Set(result.rows.map((row) => String(row[xField] ?? "")))];
    const ys = [...new Set(result.rows.map((row) => String(row[yField] ?? "")))];
    const data = result.rows.map((row) => [
      xs.indexOf(String(row[xField] ?? "")),
      ys.indexOf(String(row[yField] ?? "")),
      typeof row[valueField] === "number" ? row[valueField] : 0,
    ]);
    const max = Math.max(0, ...data.map((point) => Number(point[2]) || 0));
    option = {
      tooltip: { position: "top" },
      xAxis: { type: "category", data: xs },
      yAxis: { type: "category", data: ys },
      visualMap: { min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 0 },
      series: [{ type: "heatmap", data, label: { show: true } }],
    };
  } else {
    const baseSpec = { ...spec, type: mapToBaseType(item.type) };
    option = buildChartOption(baseSpec, result.rows);
  }

  // 按原类型增强
  const series = option.series as Array<Record<string, unknown>> | undefined;
  if (item.type === "area" && series) {
    option.series = series.map((s) => ({ ...s, areaStyle: { opacity: 0.25 } }));
  } else if (item.type === "stacked_bar" && series) {
    option.series = series.map((s) => ({ ...s, stack: "total" }));
  }

  return {
    itemId: item.id,
    taskId: task.id,
    title: item.title,
    originalType: item.type,
    visible: item.visible,
    width: item.width,
    spec,
    option,
    evidenceId: result.evidence[0]?.id,
  };
}

/** 编译整个看板（仅 visible 项；按 task priority 排序） */
export function compileDashboard(
  plan: AnalysisPlan,
  execution: PlanExecutionResult,
): { charts: CompiledChart[]; issues: string[] } {
  const charts: CompiledChart[] = [];
  const issues: string[] = [];
  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));
  const itemPriority = new Map(
    plan.dashboard.items.map((item) => [item.id, item.priority]),
  );
  for (const item of plan.dashboard.items) {
    if (!item.visible) continue;
    const task = taskMap.get(item.taskId);
    const result = execution.results[item.taskId];
    const compiled = compileChart(item, task, result);
    if (compiled) charts.push(compiled);
    else issues.push(`图表「${item.title}」无法编译（任务缺失或失败）`);
  }
  charts.sort(
    (a, b) =>
      (itemPriority.get(a.itemId) ?? 0) - (itemPriority.get(b.itemId) ?? 0),
  );
  return { charts, issues };
}
