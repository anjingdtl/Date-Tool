/**
 * lib/executor/result-hash.ts
 *
 * 任务输入与结果哈希（SPEC 14.3 / 4.2）。用于任务缓存命中判定与可复现性。
 *
 * 缓存键 = datasetRowsHash + confirmedUnderstandingHash + executorVersion + 任务规范哈希。
 */
import crypto from "crypto";
import type { AnalysisTask, TaskExecutionResult } from "@/lib/types";

/** sha256（node crypto，确定性） */
export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/** 任务的规范化 JSON（key 排序，保证结构相同则哈希相同） */
export function canonicalTaskJson(task: AnalysisTask): string {
  return JSON.stringify(sortKeys(task));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export interface TaskInputHashParts {
  task: AnalysisTask;
  rowsHash: string;
  understandingHash: string;
  executorVersion: string;
}

/** 计算任务输入哈希（缓存键） */
export function hashTaskInput(parts: TaskInputHashParts): string {
  const blob = [
    parts.rowsHash,
    parts.understandingHash,
    parts.executorVersion,
    canonicalTaskJson(parts.task),
  ].join("|");
  return sha256(blob);
}

/** 计算结果哈希（用于校验结果稳定性） */
export function hashResult(result: TaskExecutionResult): string {
  const sample =
    result.scalar !== undefined
      ? String(result.scalar)
      : JSON.stringify(result.rows.slice(0, 100));
  return sha256(`${result.taskId}|${result.status}|${sample}`);
}
