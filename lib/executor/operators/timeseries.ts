/**
 * lib/executor/operators/timeseries.ts
 *
 * timeseries 操作符（SPEC 13.5）：day/week/month/quarter/year 分桶，
 * 多指标；默认聚合按指标行为（stock→last, rate/score→avg, 其余→sum）。
 */
import type {
  AnalysisTask,
  MeasureBehavior,
  ResultColumn,
  TaskExecutionResult,
  ToolDefinition,
} from "@/lib/types";
import {
  aggregateValues,
  applyFilters,
  asNumber,
  makeTaskEvidence,
  validateFieldsExist,
  type TaskAgg,
} from "./_shared";
import { hashResult } from "../result-hash";

export function toDateStr(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isoWeek(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const tmp = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    (tmp.getTime() - yearStart.getTime()) / 86400000 / 7 + 1,
  );
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function bucketOf(dateStr: string, grain: string): string {
  switch (grain) {
    case "day":
      return dateStr.slice(0, 10);
    case "week":
      return isoWeek(dateStr);
    case "month":
      return dateStr.slice(0, 7);
    case "quarter": {
      const m = parseInt(dateStr.slice(5, 7), 10);
      return `${dateStr.slice(0, 4)}-Q${Math.ceil(m / 3)}`;
    }
    case "year":
      return dateStr.slice(0, 4);
    default:
      return dateStr.slice(0, 7);
  }
}

function defaultAggForBehavior(mb: MeasureBehavior | undefined): TaskAgg {
  if (mb === "stock") return "last";
  if (mb === "rate" || mb === "score") return "avg";
  return "sum";
}

export const timeseriesTool: ToolDefinition = {
  operator: "timeseries",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const timeField = task.time?.field;
    const issues = validateFieldsExist(
      [...(timeField ? [timeField] : []), ...task.metrics],
      available,
    );
    if (!timeField)
      issues.push({
        code: "NO_TIME",
        message: "timeseries 需要 time.field",
        level: "error",
      });
    if (task.metrics.length === 0)
      issues.push({
        code: "NO_METRIC",
        message: "timeseries 至少 1 个指标",
        level: "error",
      });
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const colNames = new Set(ctx.dataset.columns.map((c) => c.name));
    const timeField = task.time?.field ?? "";
    const grain = task.time?.grain ?? "month";
    const metrics = task.metrics.filter((m) => colNames.has(m));
    const filtered = applyFilters(ctx.dataset.rows, task.filters);

    const measureBeh = new Map(
      ctx.understanding.fields.map((f) => [f.field, f.measureBehavior]),
    );
    const aggFor = (m: string): TaskAgg =>
      task.aggregation
        ? (task.aggregation as TaskAgg)
        : defaultAggForBehavior(measureBeh.get(m));

    const buckets = new Map<string, Record<string, number[]>>();
    for (const r of filtered) {
      const dstr = toDateStr(r[timeField]);
      if (!dstr) continue;
      const label = bucketOf(dstr, grain);
      let b = buckets.get(label);
      if (!b) {
        b = {};
        buckets.set(label, b);
      }
      for (const m of metrics) {
        const n = asNumber(r[m]);
        if (n === null) continue;
        if (!b[m]) b[m] = [];
        b[m].push(n);
      }
    }

    const sortedLabels = [...buckets.keys()].sort();
    const outRows = sortedLabels.map((label) => {
      const b = buckets.get(label)!;
      const row: Record<string, unknown> = { [timeField]: label };
      for (const m of metrics) row[m] = aggregateValues(b[m] ?? [], aggFor(m));
      return row;
    });

    const columns: ResultColumn[] = [
      { name: timeField, type: "date" },
      ...metrics.map((m) => ({ name: m, type: "number" as const })),
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "timeseries",
      status: outRows.length === 0 ? "partial" : "success",
      columns,
      rows: outRows,
      summary: { rowCount: outRows.length, nullCount: 0, truncated: false },
      warnings:
        outRows.length === 0 ? ["无有效时间桶，可能时间字段解析失败"] : [],
      evidence: [],
      inputHash: "",
      resultHash: "",
      durationMs: Date.now() - start,
    };
    const resultHash = hashResult(base);
    base.resultHash = resultHash;
    base.evidence = [
      makeTaskEvidence({
        taskId: task.id,
        operator: "timeseries",
        title: `时间趋势：${metrics.join("、")}（${grain}）`,
        description: `按 ${grain} 粒度对 ${metrics.join("、")} 聚合，共 ${outRows.length} 个周期。`,
        fields: [timeField, ...metrics],
        method: "trend",
        parameters: { timeField, grain, metrics, aggregations: metrics.map(aggFor) },
        result: {
          periodCount: outRows.length,
          sample: outRows.slice(0, 12),
        },
        sampleSize: filtered.length,
        resultHash,
      }),
    ];
    return base;
  },
};
