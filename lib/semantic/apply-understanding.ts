/**
 * lib/semantic/apply-understanding.ts
 *
 * 用户对数据理解的修正与确认（SPEC 10.5 / 10.3）。
 *
 * - 用户修正只作用于 FieldUnderstanding（业务语义），不覆盖物理 ColumnMeta；
 * - 用户已确认的语义优先级最高，后续 LLM 不得覆盖（SPEC 6 / 10.5）；
 * - blocking ambiguity 必须处理后才能 confirm。
 */
import type {
  DatasetUnderstanding,
  FieldUnderstanding,
} from "@/lib/types";

/** 字段级修改项 */
export interface FieldChange {
  field: string;
  changes: Partial<FieldUnderstanding>;
}

/**
 * 把用户对字段理解的修改合并进 understanding。
 * - 只更新已存在字段；不引入新字段、不删除字段；
 * - 物理类型（ColumnMeta）不在本函数职责内，由 store 的字段配置流程处理。
 */
export function applyFieldUnderstandingChanges(
  understanding: DatasetUnderstanding,
  changes: FieldChange[],
): DatasetUnderstanding {
  const byField = new Map(changes.map((c) => [c.field, c.changes]));
  const fields = understanding.fields.map((f) => {
    const ch = byField.get(f.field);
    return ch ? { ...f, ...ch } : f;
  });
  return { ...understanding, fields };
}

/**
 * 处理某个 ambiguity：应用 choice 的字段 patch，并解除其 blocking。
 * 未匹配的 ambiguityId 原样返回。
 */
export function resolveAmbiguity(
  understanding: DatasetUnderstanding,
  ambiguityId: string,
  fieldChanges: FieldChange[],
): DatasetUnderstanding {
  const patched = applyFieldUnderstandingChanges(understanding, fieldChanges);
  const ambiguities = patched.ambiguities.map((a) =>
    a.id === ambiguityId ? { ...a, blocking: false } : a,
  );
  return { ...patched, ambiguities };
}

/** 是否存在未解除的 blocking ambiguity（SPEC 10.5：阻断默认 LLM 编排） */
export function hasUnresolvedBlocking(
  understanding: DatasetUnderstanding,
): boolean {
  return understanding.ambiguities.some((a) => a.blocking);
}

/** 确认理解：置 status=confirmed + confirmedAt（SPEC 10.5） */
export function confirmUnderstanding(
  understanding: DatasetUnderstanding,
  confirmedAt: string,
): DatasetUnderstanding {
  return { ...understanding, status: "confirmed", confirmedAt };
}
