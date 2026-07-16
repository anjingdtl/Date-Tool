/**
 * lib/executor/operators/anomaly.ts
 *
 * anomaly 操作符（SPEC 13.5）：IQR（复用 lib/analysis/outliers）或 z-score。
 * 样本 < 8 跳过；只称「统计异常」，不直接断言业务错误。
 */
import type {
  AnalysisTask,
  DatasetRow,
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
import { detectOutliers } from "@/lib/analysis/outliers";
import { hashResult } from "../result-hash";

const MIN_SAMPLES = 8;

export const anomalyTool: ToolDefinition = {
  operator: "anomaly",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const issues = validateFieldsExist(task.metrics, available);
    if (task.metrics.length === 0)
      issues.push({
        code: "NO_METRIC",
        message: "anomaly 至少 1 个指标",
        level: "error",
      });
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const field = task.metrics[0];
    const method = task.anomalyMethod ?? "iqr";
    const filtered = applyFilters(ctx.dataset.rows, task.filters);
    const limit = task.limit ?? 50;

    const anomalies: Array<{ row: DatasetRow; value: number; direction: string }> = [];
    let stats: Record<string, unknown>;
    let sampleSize = 0;
    const warnings: string[] = [];

    if (method === "iqr") {
      const res = detectOutliers(filtered, field);
      sampleSize = res.sampleSize;
      for (const s of res.samples) {
        if (s.rowIndex < filtered.length) {
          anomalies.push({
            row: filtered[s.rowIndex],
            value: s.value,
            direction: s.direction,
          });
        }
      }
      stats = {
        method: "iqr",
        q1: res.q1,
        q3: res.q3,
        iqr: res.iqr,
        lowerBound: res.lowerBound,
        upperBound: res.upperBound,
        outlierCount: res.outlierCount,
      };
    } else {
      const vals: number[] = [];
      for (const r of filtered) {
        const n = asNumber(r[field]);
        if (n !== null) vals.push(n);
      }
      sampleSize = vals.length;
      if (vals.length < MIN_SAMPLES) {
        stats = { method: "zscore", sampleSize, detected: false };
      } else {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd = Math.sqrt(
          vals.reduce((a, b) => a + (b - mean) ** 2, 0) /
            Math.max(vals.length - 1, 1),
        );
        const threshold = 3;
        for (const r of filtered) {
          const n = asNumber(r[field]);
          if (n === null) continue;
          const z = sd > 0 ? Math.abs((n - mean) / sd) : 0;
          if (z > threshold) {
            anomalies.push({
              row: r,
              value: n,
              direction: n > mean ? "upper" : "lower",
            });
          }
        }
        stats = {
          method: "zscore",
          mean,
          std: sd,
          threshold,
          outlierCount: anomalies.length,
        };
      }
    }

    if (sampleSize < MIN_SAMPLES) {
      warnings.push(
        `样本数 ${sampleSize} 不足 ${MIN_SAMPLES}，异常检测结果仅供参考。`,
      );
    }
    if (anomalies.length === 0 && sampleSize >= MIN_SAMPLES) {
      warnings.push("未检出统计异常。");
    }

    const outRows = anomalies
      .slice(0, limit)
      .map((a) => ({ ...a.row, [field]: a.value, _direction: a.direction }));

    const columns: ResultColumn[] = [
      { name: field, type: "number" },
      { name: "_direction", type: "string" },
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "anomaly",
      status: "success",
      columns,
      rows: outRows,
      summary: { rowCount: outRows.length, nullCount: 0, truncated: anomalies.length > limit },
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
        operator: "anomaly",
        title: `异常检测：${field}（${method}）`,
        description: `对字段「${field}」使用 ${method.toUpperCase()} 方法检测，样本 ${sampleSize}，发现 ${anomalies.length} 个统计异常。`,
        fields: [field],
        method: "outlier",
        parameters: { field, method, limit, ...stats },
        result: { anomalyCount: anomalies.length, stats },
        sampleSize,
        resultHash,
      }),
    ];
    return base;
  },
};
