/**
 * lib/planner/validate-analysis-plan.ts
 *
 * 计划校验（SPEC 12.7，20 条规则）。
 *
 * 物理类型取自 ColumnMeta，业务语义取自 DatasetUnderstanding；
 * 聚合与类型/语义冲突阻断（error），图表高基数等提示（warning）。
 */
import type {
  AnalysisPlan,
  AnalysisTask,
  ColumnMeta,
  DatasetUnderstanding,
  FieldUnderstanding,
  StoredDataset,
} from "@/lib/types";
import { validateFormulaAST } from "@/lib/executor/formula-engine";
import { detectCycle } from "./plan-dependencies";

export interface PlanValidationIssue {
  code: string;
  taskId?: string;
  itemId?: string;
  message: string;
  level: "warning" | "error";
}

export interface PlanValidationContext {
  dataset: StoredDataset;
  understanding: DatasetUnderstanding;
  userHardConstraints?: string[];
}

export type PlanValidationResult = {
  ok: boolean;
  issues: PlanValidationIssue[];
};

const MAX_TASKS = 24;
const PIE_MAX = 8;
const NUMERIC_AGGS = ["sum", "avg", "min", "max", "median"];

export function validateAnalysisPlan(
  plan: AnalysisPlan,
  ctx: PlanValidationContext,
): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];
  const physical = new Map(ctx.dataset.columns.map((c) => [c.name, c]));
  const semantic = new Map(ctx.understanding.fields.map((f) => [f.field, f]));
  const allFieldNames = new Set<string>([
    ...physical.keys(),
    ...semantic.keys(),
  ]);
  const taskIds = new Set(plan.tasks.map((t) => t.id));

  // 规则 1：ID 唯一
  const idSeen = new Set<string>();
  for (const t of plan.tasks) {
    if (idSeen.has(t.id))
      issues.push({
        code: "DUPLICATE_TASK_ID",
        taskId: t.id,
        message: `任务 ID「${t.id}」重复`,
        level: "error",
      });
    idSeen.add(t.id);
  }

  // 规则 5：任务数硬上限
  if (plan.tasks.length > MAX_TASKS)
    issues.push({
      code: "TOO_MANY_TASKS",
      message: `任务数 ${plan.tasks.length} 超过硬上限 ${MAX_TASKS}`,
      level: "error",
    });

  // 规则 4：依赖环
  const cycle = detectCycle(plan.tasks);
  if (cycle)
    issues.push({
      code: "DEPENDENCY_CYCLE",
      message: `依赖存在环：${cycle.join(" → ")}`,
      level: "error",
    });

  for (const t of plan.tasks) {
    validateTaskFields(t, physical, semantic, allFieldNames, taskIds, issues);
    validateTaskAggregation(t, physical, semantic, issues);
  }

  validateDashboard(plan, taskIds, physical, issues);

  return { ok: !issues.some((i) => i.level === "error"), issues };
}

function validateTaskFields(
  t: AnalysisTask,
  physical: Map<string, ColumnMeta>,
  semantic: Map<string, FieldUnderstanding>,
  allFieldNames: Set<string>,
  taskIds: Set<string>,
  issues: PlanValidationIssue[],
): void {
  // 规则 3：字段存在
  for (const f of [...t.metrics, ...t.dimensions]) {
    if (!physical.has(f) && !semantic.has(f))
      issues.push({
        code: "UNKNOWN_FIELD",
        taskId: t.id,
        message: `任务「${t.id}」引用未知字段「${f}」`,
        level: "error",
      });
  }
  for (const fl of t.filters)
    if (!physical.has(fl.field))
      issues.push({
        code: "UNKNOWN_FIELD",
        taskId: t.id,
        message: `任务「${t.id}」filter 引用未知字段「${fl.field}」`,
        level: "error",
      });
  if (t.sort && !physical.has(t.sort.field))
    issues.push({
      code: "UNKNOWN_FIELD",
      taskId: t.id,
      message: `任务「${t.id}」sort 引用未知字段「${t.sort.field}」`,
      level: "error",
    });
  if (t.time && !physical.has(t.time.field))
    issues.push({
      code: "UNKNOWN_FIELD",
      taskId: t.id,
      message: `任务「${t.id}」time 引用未知字段「${t.time.field}」`,
      level: "error",
    });
  // dependsOn 引用存在
  for (const d of t.dependsOn)
    if (!taskIds.has(d))
      issues.push({
        code: "UNKNOWN_DEPENDENCY",
        taskId: t.id,
        message: `任务「${t.id}」依赖不存在的任务「${d}」`,
        level: "error",
      });

  // 规则 6：公式合法
  if (t.formula) {
    const fcheck = validateFormulaAST(t.formula.expression, allFieldNames);
    for (const fi of fcheck.issues)
      issues.push({
        code: fi.code,
        taskId: t.id,
        message: fi.message,
        level: "error",
      });
  }

  // 规则 15：between filter 需数值数组
  for (const fl of t.filters) {
    if (fl.operator === "between" && (!Array.isArray(fl.value) || fl.value.length < 2))
      issues.push({
        code: "BAD_BETWEEN",
        taskId: t.id,
        message: `任务「${t.id}」between filter 需 [lo, hi] 数组`,
        level: "error",
      });
  }
}

function validateTaskAggregation(
  t: AnalysisTask,
  physical: Map<string, ColumnMeta>,
  semantic: Map<string, FieldUnderstanding>,
  issues: PlanValidationIssue[],
): void {
  const agg = t.aggregation;
  if (!agg) return;

  // 规则 13：last 需 time 或 sort
  if (agg === "last" && !t.time && !t.sort)
    issues.push({
      code: "LAST_NEEDS_ORDER",
      taskId: t.id,
      message: `任务「${t.id}」使用 last 但无 time/sort，顺序不稳定`,
      level: "warning",
    });

  for (const m of t.metrics) {
    const phys = physical.get(m);
    const sem = semantic.get(m);
    // 规则 8：数值聚合要求数值类型
    if (NUMERIC_AGGS.includes(agg) && phys && phys.type !== "number")
      issues.push({
        code: "AGG_TYPE_MISMATCH",
        taskId: t.id,
        message: `任务「${t.id}」对非数值字段「${m}」使用 ${agg}`,
        level: "error",
      });
    // 规则 10：percentage/rate 禁 sum
    if (
      agg === "sum" &&
      (phys?.format === "percentage" || sem?.measureBehavior === "rate")
    )
      issues.push({
        code: "RATE_NO_SUM",
        taskId: t.id,
        message: `任务「${t.id}」对比率字段「${m}」使用 sum（应为 avg）`,
        level: "error",
      });
    // 规则 11：identifier 禁 sum/avg
    if (
      ["sum", "avg"].includes(agg) &&
      (phys?.role === "identifier" || sem?.role === "identifier")
    )
      issues.push({
        code: "IDENTIFIER_NO_SUM_AVG",
        taskId: t.id,
        message: `任务「${t.id}」对标识字段「${m}」使用 ${agg}（应为 count）`,
        level: "error",
      });
    // 规则 12：stock 跨时间禁 sum
    if (t.operator === "timeseries" && agg === "sum" && sem?.measureBehavior === "stock")
      issues.push({
        code: "STOCK_NO_TIMESERIES_SUM",
        taskId: t.id,
        message: `任务「${t.id}」对存量字段「${m}」跨时间 sum（应为 last）`,
        level: "error",
      });
  }
}

function validateDashboard(
  plan: AnalysisPlan,
  taskIds: Set<string>,
  physical: Map<string, ColumnMeta>,
  issues: PlanValidationIssue[],
): void {
  for (const item of plan.dashboard.items) {
    // 规则 2/19：图表引用任务存在，可见图表需有效任务
    if (!taskIds.has(item.taskId))
      issues.push({
        code: "DANGLING_TASK_REF",
        itemId: item.id,
        message: `图表「${item.id}」引用不存在的任务「${item.taskId}」`,
        level: "error",
      });
    const task = plan.tasks.find((t) => t.id === item.taskId);
    if (item.visible && !task)
      issues.push({
        code: "VISIBLE_CHART_NO_TASK",
        itemId: item.id,
        message: `可见图表「${item.id}」无有效任务`,
        level: "error",
      });
    // 规则 17：pie 类别数
    if (task && item.type === "pie") {
      const dim = task.dimensions[0];
      const phys = dim ? physical.get(dim) : undefined;
      if (phys && (phys.distinctCount ?? 0) > PIE_MAX)
        issues.push({
          code: "PIE_TOO_MANY_CATEGORIES",
          itemId: item.id,
          message: `饼图「${item.id}」类别 ${phys.distinctCount} 超过 ${PIE_MAX}，建议改 bar`,
          level: "warning",
        });
    }
  }
}
