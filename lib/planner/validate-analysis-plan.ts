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
import { getTool } from "@/lib/executor/registry";
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
  const canonicalSeen = new Map<string, string>();
  for (const t of plan.tasks) {
    if (idSeen.has(t.id))
      issues.push({
        code: "DUPLICATE_TASK_ID",
        taskId: t.id,
        message: `任务 ID「${t.id}」重复`,
        level: "error",
      });
    idSeen.add(t.id);
    const canonical = JSON.stringify({
      operator: t.operator,
      dimensions: t.dimensions,
      metrics: t.metrics,
      filters: t.filters,
      aggregation: t.aggregation,
      time: t.time,
      formula: t.formula,
      compareMode: t.compareMode,
      anomalyMethod: t.anomalyMethod,
      sort: t.sort,
      limit: t.limit,
      dependsOn: t.dependsOn,
      expectedOutput: t.expectedOutput,
    });
    const duplicateOf = canonicalSeen.get(canonical);
    if (duplicateOf) {
      issues.push({
        code: "DUPLICATE_TASK_DEFINITION",
        taskId: t.id,
        message: `任务「${t.id}」与「${duplicateOf}」计算定义重复`,
        level: "error",
      });
    } else {
      canonicalSeen.set(canonical, t.id);
    }
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
    validateTaskAggregation(
      t,
      physical,
      semantic,
      ctx.userHardConstraints ?? [],
      issues,
    );
    validateOperatorContract(t, ctx, issues);
    validateFilterTypes(t, physical, issues);
  }

  validateDashboard(plan, taskIds, physical, issues);
  validateHardConstraints(plan, ctx.userHardConstraints ?? [], issues);

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
    for (const field of collectFormulaFields(t.formula.expression)) {
      const column = physical.get(field);
      if (column && column.type !== "number") {
        issues.push({
          code: "FORMULA_NON_NUMERIC_FIELD",
          taskId: t.id,
          message: `任务「${t.id}」的公式引用非数值字段「${field}」`,
          level: "error",
        });
      }
    }
  }

  // 规则 15：between filter 需数值数组
  for (const fl of t.filters) {
    if (fl.operator === "between" && (!Array.isArray(fl.value) || fl.value.length !== 2))
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
  userHardConstraints: string[],
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
      level: "error",
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
    const stockSumOverridden = userHardConstraints.some((constraint) => {
      const text = constraint.toLowerCase();
      return (
        text.includes(m.toLowerCase()) &&
        /(允许|使用|按).*(sum|求和|累加)/i.test(text)
      );
    });
    if (
      t.operator === "timeseries" &&
      agg === "sum" &&
      sem?.measureBehavior === "stock" &&
      !stockSumOverridden
    )
      issues.push({
        code: "STOCK_NO_TIMESERIES_SUM",
        taskId: t.id,
        message: `任务「${t.id}」对存量字段「${m}」跨时间 sum（应为 last）`,
        level: "error",
      });
  }
}

function validateOperatorContract(
  task: AnalysisTask,
  ctx: PlanValidationContext,
  issues: PlanValidationIssue[],
): void {
  const tool = getTool(task.operator);
  if (!tool) {
    issues.push({
      code: "UNKNOWN_OPERATOR",
      taskId: task.id,
      message: `任务「${task.id}」使用未注册操作符「${task.operator}」`,
      level: "error",
    });
    return;
  }
  const validated = tool.validate(task, {
    dataset: ctx.dataset,
    understanding: ctx.understanding,
    priorResults: {},
    requestId: "plan-validation",
  });
  for (const issue of validated.issues) {
    issues.push({
      code: `OPERATOR_${issue.code}`,
      taskId: task.id,
      message: `任务「${task.id}」：${issue.message}`,
      level: issue.level,
    });
  }

  if (task.operator === "ratio" && task.formula) {
    const fields = collectFormulaFields(task.formula.expression);
    for (const field of fields) {
      const physical = ctx.dataset.columns.find((column) => column.name === field);
      if (physical && physical.type !== "number") {
        issues.push({
          code: "RATIO_NON_NUMERIC_FIELD",
          taskId: task.id,
          message: `任务「${task.id}」的比率公式引用非数值字段「${field}」`,
          level: "error",
        });
      }
    }
  }
}

function collectFormulaFields(
  expression: import("@/lib/types").FormulaExpression,
): Set<string> {
  const fields = new Set<string>();
  const visit = (node: import("@/lib/types").FormulaExpression) => {
    if (node.op === "field") fields.add(node.field);
    else if (
      node.op === "add" ||
      node.op === "subtract" ||
      node.op === "multiply" ||
      node.op === "divide"
    ) {
      visit(node.left);
      visit(node.right);
    } else if (node.op === "safe_divide") {
      visit(node.numerator);
      visit(node.denominator);
    } else if (node.op === "abs" || node.op === "round") {
      visit(node.value);
    }
  };
  visit(expression);
  return fields;
}

function valueCompatible(value: unknown, column: ColumnMeta): boolean {
  if (value === null || value === undefined) return true;
  if (column.type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (column.type === "boolean") return typeof value === "boolean";
  if (column.type === "date") {
    return (
      (typeof value === "string" || value instanceof Date) &&
      Number.isFinite(new Date(value).getTime())
    );
  }
  return typeof value === "string";
}

function validateFilterTypes(
  task: AnalysisTask,
  physical: Map<string, ColumnMeta>,
  issues: PlanValidationIssue[],
): void {
  for (const filter of task.filters) {
    const column = physical.get(filter.field);
    if (!column) continue;
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    if (["in", "not_in", "between"].includes(filter.operator) && !Array.isArray(filter.value)) {
      issues.push({
        code: "FILTER_VALUE_TYPE",
        taskId: task.id,
        message: `任务「${task.id}」的 ${filter.operator} 筛选值必须是数组`,
        level: "error",
      });
      continue;
    }
    if (filter.operator === "between" && values.length !== 2) continue;
    if (filter.operator === "contains" && column.type !== "string") {
      issues.push({
        code: "FILTER_OPERATOR_TYPE",
        taskId: task.id,
        message: `任务「${task.id}」不能对非文本字段「${filter.field}」使用 contains`,
        level: "error",
      });
    }
    if (!values.every((value) => valueCompatible(value, column))) {
      issues.push({
        code: "FILTER_VALUE_TYPE",
        taskId: task.id,
        message: `任务「${task.id}」的筛选值与字段「${filter.field}」物理类型不兼容`,
        level: "error",
      });
    }
  }
}

function validateDashboard(
  plan: AnalysisPlan,
  taskIds: Set<string>,
  physical: Map<string, ColumnMeta>,
  issues: PlanValidationIssue[],
): void {
  const itemIds = new Set<string>();
  for (const item of plan.dashboard.items) {
    if (itemIds.has(item.id)) {
      issues.push({
        code: "DUPLICATE_DASHBOARD_ITEM_ID",
        itemId: item.id,
        message: `图表 ID「${item.id}」重复`,
        level: "error",
      });
    }
    itemIds.add(item.id);
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
          level: "error",
        });
    }
    if (task && !chartMatchesOutput(item.type, task.expectedOutput)) {
      issues.push({
        code: "CHART_OUTPUT_MISMATCH",
        itemId: item.id,
        message: `图表「${item.id}」类型 ${item.type} 与任务输出 ${task.expectedOutput} 不兼容`,
        level: "error",
      });
    }
  }
  for (const section of plan.dashboard.sections) {
    for (const itemId of section.itemIds) {
      if (!itemIds.has(itemId)) {
        issues.push({
          code: "DANGLING_SECTION_ITEM",
          itemId,
          message: `看板分区「${section.id}」引用不存在的图表「${itemId}」`,
          level: "error",
        });
      }
    }
  }
}

function chartMatchesOutput(
  type: AnalysisPlan["dashboard"]["items"][number]["type"],
  output: AnalysisTask["expectedOutput"],
): boolean {
  if (type === "table") return true;
  if (type === "kpi") return output === "scalar";
  if (type === "heatmap") return output === "matrix" || output === "category_table";
  if (type === "scatter") return output === "records" || output === "category_table";
  if (type === "line" || type === "area") return output === "series" || output === "category_table";
  return output === "category_table" || output === "series";
}

function validateHardConstraints(
  plan: AnalysisPlan,
  constraints: string[],
  issues: PlanValidationIssue[],
): void {
  const serialized = JSON.stringify(plan);
  for (const constraint of constraints) {
    const noPie = /(不要|不使用|禁止).*(饼图|pie)/i.test(constraint);
    if (noPie && plan.dashboard.items.some((item) => item.type === "pie")) {
      issues.push({
        code: "USER_HARD_CONSTRAINT_VIOLATED",
        message: `计划违反用户硬约束：「${constraint}」`,
        level: "error",
      });
    }
    const onlyValue = constraint.match(/只(?:看|保留|分析)\s*[「“\"]?([^「」“”\"，。；;]+)[」”\"]?/);
    if (onlyValue && !serialized.includes(onlyValue[1].trim())) {
      issues.push({
        code: "USER_HARD_CONSTRAINT_VIOLATED",
        message: `计划未落实用户硬约束：「${constraint}」`,
        level: "error",
      });
    }
    const maxCharts = constraint.match(/最多\s*(\d+)\s*张?图/);
    if (maxCharts && plan.dashboard.items.filter((item) => item.visible).length > Number(maxCharts[1])) {
      issues.push({
        code: "USER_HARD_CONSTRAINT_VIOLATED",
        message: `计划可见图表数违反用户硬约束：「${constraint}」`,
        level: "error",
      });
    }
  }
}
