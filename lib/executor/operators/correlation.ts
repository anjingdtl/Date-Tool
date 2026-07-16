/**
 * lib/executor/operators/correlation.ts
 *
 * correlation 操作符（SPEC 13.5）：Pearson 相关系数。
 * 有效成对样本 <8 跳过；常量列返回 null；不得描述为因果。
 */
import type {
  AnalysisTask,
  ResultColumn,
  TaskExecutionResult,
  ToolDefinition,
} from "@/lib/types";
import {
  applyFilters,
  asNumber,
  makeTaskEvidence,
  validateFieldsExist,
} from "./_shared";
import { hashResult } from "../result-hash";

const MIN_PAIRS = 8;

export const correlationTool: ToolDefinition = {
  operator: "correlation",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const issues = validateFieldsExist(task.metrics, available);
    if (task.metrics.length < 2)
      issues.push({
        code: "NEED_TWO_METRICS",
        message: "correlation 至少 2 个数值指标",
        level: "error",
      });
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const m1 = task.metrics[0];
    const m2 = task.metrics[1];
    const filtered = applyFilters(ctx.dataset.rows, task.filters);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of filtered) {
      const a = asNumber(r[m1]);
      const b = asNumber(r[m2]);
      if (a !== null && b !== null) {
        xs.push(a);
        ys.push(b);
      }
    }
    const n = xs.length;
    let pearson: number | null = null;
    const warnings: string[] = [];

    if (n < MIN_PAIRS) {
      warnings.push(`有效成对样本 ${n} 不足 ${MIN_PAIRS}，相关性不可靠`);
    } else {
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < n; i++) {
        const d1 = xs[i] - mx;
        const d2 = ys[i] - my;
        num += d1 * d2;
        dx += d1 * d1;
        dy += d2 * d2;
      }
      if (dx === 0 || dy === 0) {
        pearson = null;
        warnings.push("存在常量列，相关性无法计算");
      } else {
        pearson = num / Math.sqrt(dx * dy);
      }
    }
    warnings.push("相关性不等于因果，需结合业务判断");

    const outRows = [{ metric1: m1, metric2: m2, pearson, sampleSize: n }];
    const columns: ResultColumn[] = [
      { name: "metric1", type: "string" },
      { name: "metric2", type: "string" },
      { name: "pearson", type: "number" },
      { name: "sampleSize", type: "number" },
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "correlation",
      status: "success",
      columns,
      rows: outRows,
      scalar: pearson,
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
        operator: "correlation",
        title: `相关性：${m1} vs ${m2}`,
        description: `Pearson 相关系数 ${
          pearson !== null ? pearson.toFixed(3) : "N/A"
        }（有效样本 ${n}）。注意：相关性不等于因果。`,
        fields: [m1, m2],
        method: "correlation",
        parameters: { metric1: m1, metric2: m2, sampleSize: n },
        result: { pearson, sampleSize: n },
        sampleSize: n,
        resultHash,
      }),
    ];
    return base;
  },
};
