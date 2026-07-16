/**
 * lib/executor/task-cache.ts
 *
 * 任务结果缓存（SPEC 14.3）。命中时复用结果，避免重复计算。
 *
 * P0 阶段使用进程内 LRU；后续可平滑替换为磁盘缓存（保持 get/set 接口）。
 */
import type { TaskExecutionResult } from "@/lib/types";

const MAX_ENTRIES = 500;
const cache = new Map<string, TaskExecutionResult>();
let hitCount = 0;

/** 读取缓存结果；不存在返回 null。命中时统计 +1。 */
export function getCachedTaskResult(key: string): TaskExecutionResult | null {
  const hit = cache.get(key);
  if (hit) {
    // LRU：命中后重新插入到末尾
    cache.delete(key);
    cache.set(key, hit);
    hitCount++;
    return hit;
  }
  return null;
}

/** 写入缓存；超限时淘汰最旧条目 */
export function setCachedTaskResult(
  key: string,
  result: TaskExecutionResult,
): void {
  if (cache.has(key)) cache.delete(key);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, result);
}

/** 清空缓存（测试用） */
export function clearTaskCache(): void {
  cache.clear();
  hitCount = 0;
}

/** 当前缓存条目数（测试用） */
export function taskCacheSize(): number {
  return cache.size;
}

/** 累计命中次数（execute-plan 用于统计本轮命中） */
export function getCacheHits(): number {
  return hitCount;
}
