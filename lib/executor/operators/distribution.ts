/**
 * lib/executor/operators/distribution.ts
 *
 * distribution 操作符（SPEC 13.5）：分类分布与数值等宽分箱（count/rate）。
 * pie 仅用于 2~8 分类；超过 8 类自动 warning 建议改 bar。
 */
import type {
  AnalysisTask,
  ResultColumn,
  TaskExecutionResult,
  ToolDefinition,
} from "@/lib/types";
import {
  applyFilters,
  makeTaskEvidence,
  toKey,
  validateFieldsExist,
} from "./_shared";
import { hashResult } from "../result-hash";

const PIE_MAX = 8;
const HARD_LIMIT = 100;

export const distributionTool: ToolDefinition = {
  operator: "distribution",
  validate(task, ctx) {
    const available = new Set(ctx.dataset.columns.map((c) => c.name));
    const field = task.dimensions[0];
    const issues = validateFieldsExist(task.dimensions, available);
    if (!field)
      issues.push({
        code: "NO_CATEGORY",
        message: "distribution 至少 1 个分类字段（dimensions[0]）",
        level: "error",
      });
    return { ok: !issues.some((i) => i.level === "error"), issues };
  },
  async execute(task, ctx) {
    const start = Date.now();
    const field = task.dimensions[0];
    const filtered = applyFilters(ctx.dataset.rows, task.filters);
    const column = ctx.dataset.columns.find((item) => item.name === field);
    if (column?.type === "number") {
      const values = filtered
        .map((row) => Number(row[field]))
        .filter((value) => Number.isFinite(value));
      const requestedBins = Math.min(task.limit ?? 10, 20);
      const min = values.length > 0 ? Math.min(...values) : 0;
      const max = values.length > 0 ? Math.max(...values) : 0;
      const binCount = min === max ? 1 : Math.min(requestedBins, values.length);
      const width = binCount > 1 ? (max - min) / binCount : 0;
      const counts = Array.from({ length: binCount }, () => 0);
      for (const value of values) {
        const index = width === 0
          ? 0
          : Math.min(Math.floor((value - min) / width), binCount - 1);
        counts[index]++;
      }
      const outRows = counts.map((count, index) => {
        const lower = width === 0 ? min : min + index * width;
        const upper = width === 0 ? max : min + (index + 1) * width;
        const label = width === 0
          ? String(min)
          : `${lower.toPrecision(6)}${index === binCount - 1 ? " ≤ x ≤ " : " ≤ x < "}${upper.toPrecision(6)}`;
        return {
          [field]: label,
          lower,
          upper,
          count,
          rate: values.length > 0 ? count / values.length : 0,
        };
      });
      const columns: ResultColumn[] = [
        { name: field, type: "string" },
        { name: "lower", type: "number" },
        { name: "upper", type: "number" },
        { name: "count", type: "number" },
        { name: "rate", type: "number", format: "percentage" },
      ];
      const base: TaskExecutionResult = {
        taskId: task.id,
        operator: "distribution",
        status: "success",
        columns,
        rows: outRows,
        summary: { rowCount: outRows.length, nullCount: filtered.length - values.length, truncated: false },
        warnings: [],
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
          operator: "distribution",
          title: `数值分布：${field}`,
          description: `字段「${field}」按 ${binCount} 个等宽区间分箱，有效样本 ${values.length} 条。`,
          fields: [field],
          method: "distribution",
          parameters: { field, binCount, min, max },
          result: { binCount, bins: outRows },
          sampleSize: values.length,
          resultHash,
        }),
      ];
      return base;
    }
    const counts = new Map<string, number>();
    let total = 0;
    for (const r of filtered) {
      const k = toKey(r[field]);
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      total++;
    }
    const entries = [...counts.entries()]
      .map(([value, count]) => ({ value, count, rate: total > 0 ? count / total : 0 }))
      .sort((a, b) => b.count - a.count);

    const truncated = entries.length > HARD_LIMIT;
    const outRows = entries.slice(0, task.limit ?? HARD_LIMIT).map((e) => ({
      [field]: e.value,
      count: e.count,
      rate: e.rate,
    }));

    const warnings: string[] = [];
    if (entries.length > PIE_MAX)
      warnings.push(
        `分类数 ${entries.length} 超过 ${PIE_MAX}，pie 图建议改为 bar；已取 Top ${outRows.length}。`,
      );
    if (truncated)
      warnings.push(`分类数超过 ${HARD_LIMIT}，已截断为 Top ${outRows.length}。`);

    const columns: ResultColumn[] = [
      { name: field, type: "string" },
      { name: "count", type: "number" },
      { name: "rate", type: "number", format: "percentage" },
    ];

    const base: TaskExecutionResult = {
      taskId: task.id,
      operator: "distribution",
      status: "success",
      columns,
      rows: outRows,
      summary: {
        rowCount: outRows.length,
        nullCount: 0,
        truncated,
      },
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
        operator: "distribution",
        title: `分布：${field}`,
        description: `字段「${field}」共 ${entries.length} 个不同取值，有效样本 ${total} 条。`,
        fields: [field],
        method: "distribution",
        parameters: { field, total, distinctCount: entries.length },
        result: { distinctCount: entries.length, top: outRows.slice(0, 10) },
        sampleSize: total,
        resultHash,
      }),
    ];
    return base;
  },
};
