/**
 * lib/orchestrator/limits.ts
 *
 * 编排器硬限制常量（SPEC 4.2 / 14.2 / 19.4）。所有自动循环必须有限。
 */
export const MAX_REVIEW_ROUNDS = 2;
export const MAX_REVIEW_ADDED_TASKS = 8;
export const DEFAULT_CONCURRENCY = 3;
export const MAX_SESSIONS_PER_DATASET = 5;
export const MAX_REVISIONS_PER_SESSION = 20;
