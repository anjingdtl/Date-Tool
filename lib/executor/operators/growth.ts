/**
 * lib/executor/operators/growth.ts
 *
 * growth 操作符（SPEC 13.5）：period-over-period 增长。
 * absolute（原值序列）/ difference（环比差）/ rate（环比率，分母 0 返回 null + warning）。
 */
import type {
  AnalysisTask,
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
import { bucketOf, toDateStr } from "./timeseries";
import { hashResult } from "../result-hash";

export const growthTool: ToolDefinition = {
  operator: "growth",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const timeField = task.time?.field;
    const issues = validateFieldsExist(
      [...(timeField ? [timeField] : []), ...task.metrics],
      available,
    );
    if (!timeField)
      issues.push({ code: "NO_TIME", message: "growth 需要 time.field", level: "error" });
    if (task.metrics.length === 0)
      issues.push({ code: "NO_METRIC", message: "growth 至少 1 个指标", level: "error" });
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const timeField = task.time!.field;
    const grain = task.time!.grain;
    const metric = task.metrics[0];
    const mode = task.compareMode ?? "rate";
    const agg = (task.aggregation ?? "sum") as TaskAgg;
    const filtered = applyFilters(ctx.dataset.rows, task.filters);

    const buckets = new Map<string, number[]>();
    for (const r of filtered) {
      const dstr = toDateStr(r[timeField]);
      if (!dstr) continue;
      const label = bucketOf(dstr, grain);
      const n = asNumber(r[metric]);
      if (n === null) continue;
      let arr = buckets.get(label);
      if (!arr) {
        arr = [];
        buckets.set(label, arr);
      }
      arr.push(n);
    }
    const periods = [...buckets.keys()].sort();
    const series = periods.map((p) => ({
      period: p,
      value: aggregateValues(buckets.get(p)!, agg),
    }));

    const warnings: string[] = [];
    const outRows = series.map((s, i) => {
      const row: Record<string, unknown> = { [timeField]: s.period, [metric]: s.value };
      if (i === 0) {
        row.change = null;
        row.growthRate = null;
        return row;
      }
      const prev = series[i - 1].value;
      const change = s.value - prev;
      row.change = change;
      if (mode === "rate") {
        if (prev === 0) {
          row.growthRate = null;
          warnings.push(`周期 ${s.period} 的上一周期值为 0，增长率无法计算（返回 null）`);
        } else {
          row.growthRate = change / Math.abs(prev);
        }
      } else {
        row.growthRate = null;
      }
      return row;
    });

    const columns: ResultColumn[] = [
      { name: timeField, type: "date" },
      { name: metric, type: "number" },
      { name: "change", type: "number" },
      { name: "growthRate", type: "number", format: "percentage" },
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "growth",
      status: outRows.length < 2 ? "partial" : "success",
      columns,
      rows: outRows,
      summary: { rowCount: outRows.length, nullCount: 0, truncated: false },
      warnings,
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
        operator: "growth",
        title: `增长：${metric}（${grain} 环比，${mode}）`,
        description: `按 ${grain} 粒度对 ${metric} 聚合后计算相邻周期变化，共 ${outRows.length} 期。`,
        fields: [timeField, metric],
        method: "growth",
        parameters: { timeField, grain, metric, mode, aggregation: agg },
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
