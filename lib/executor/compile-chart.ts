/**
 * lib/executor/compile-chart.ts
 *
 * 从 DashboardItemPlan + TaskExecutionResult 编译图表（SPEC 20.4）。
 *
 * - 不让 LLM 直接生成 ECharts option，统一由本地编译；
 * - PlannedChartType 映射到基础 ChartType（bar/line/pie/table）经 buildChartOption，
 *   再按原类型增强（area→areaStyle、stacked_bar→stack）；
 * - kpi 返回 scalar 卡片信息；scatter/heatmap 记录 originalType 供前端增强。
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

function mapToBaseType(t: PlannedChartType): ChartSpec["type"] {
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
        type: "table",
        xField: task.dimensions[0] ?? "",
        yField: y ?? "",
      },
      option: {},
      scalar,
      evidenceId: result.evidence[0]?.id,
    };
  }

  const { x, y } = pickAxisColumns(task, result);
  if (!x || !y) return null;

  const spec: ChartSpec = {
    id: item.id,
    title: item.title,
    type: mapToBaseType(item.type),
    xField: x,
    yField: y,
    agg: "sum",
    description: item.description,
    evidenceId: result.evidence[0]?.id,
    limit: task.limit,
  };
  const option = buildChartOption(spec, result.rows);

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
      (taskMap.get(a.taskId)?.priority ?? 0) -
      (taskMap.get(b.taskId)?.priority ?? 0),
  );
  return { charts, issues };
}
