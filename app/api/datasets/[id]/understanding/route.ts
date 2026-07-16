import { NextRequest } from "next/server";
import {
  getUnderstanding,
  isValidDatasetId,
  saveUnderstanding,
} from "@/lib/store";
import { validateDatasetUnderstanding } from "@/lib/schemas/understanding";
import {
  applyFieldUnderstandingChanges,
  confirmUnderstanding,
  hasUnresolvedBlocking,
  resolveAmbiguity,
  type FieldChange,
} from "@/lib/semantic/apply-understanding";
import {
  BadRequestError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/lib/errors";
import { fail, newRequestId, ok } from "@/lib/respond";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/datasets/{id}/understanding：返回当前理解（无则 understanding=null） */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const requestId = newRequestId();
  try {
    if (!isValidDatasetId(params.id)) {
      throw new BadRequestError("数据集 ID 不是合法 UUID");
    }
    const understanding = await getUnderstanding(params.id);
    return ok({ understanding, hasUnderstanding: understanding !== null });
  } catch (err) {
    return fail(err, requestId);
  }
}

interface AmbiguityResolution {
  ambiguityId: string;
  fieldChanges: FieldChange[];
}

interface PutBody {
  understanding?: unknown;
  fieldChanges?: FieldChange[];
  ambiguityResolutions?: AmbiguityResolution[];
  confirm?: boolean;
}

/**
 * PUT /api/datasets/{id}/understanding（SPEC 10.5 / 18.1）。
 *
 * 合并用户对理解的修正（字段语义修改 / ambiguity 解答），可选确认。
 * - 合并后必须通过 Zod 校验才落盘；
 * - confirm 时若存在未解除的 blocking ambiguity → 422 拒绝；
 * - 用户修正不覆盖物理 ColumnMeta（仅改 FieldUnderstanding）。
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const requestId = newRequestId();
  try {
    if (!isValidDatasetId(params.id)) {
      throw new BadRequestError("数据集 ID 不是合法 UUID");
    }
    const existing = await getUnderstanding(params.id);
    if (!existing) {
      throw new NotFoundError("尚未进行 AI 数据理解，无法修改");
    }

    let body: PutBody;
    try {
      body = (await req.json()) as PutBody;
    } catch {
      throw new BadRequestError("请求体不是合法 JSON");
    }

    let updated = existing;

    // 1. 整体替换（用户在 UI 编辑后提交完整 understanding）
    if (body.understanding !== undefined) {
      const valid = validateDatasetUnderstanding(body.understanding);
      if (!valid.ok) {
        throw new BadRequestError("理解结构非法", { error: valid.error });
      }
      // 保留服务端权威字段
      updated = {
        ...valid.data,
        id: existing.id,
        datasetId: existing.datasetId,
        createdAt: existing.createdAt,
        confirmedAt: existing.confirmedAt,
      };
    }

    // 2. 字段级合并
    if (body.fieldChanges && body.fieldChanges.length > 0) {
      updated = applyFieldUnderstandingChanges(updated, body.fieldChanges);
    }

    // 3. ambiguity 解答
    if (body.ambiguityResolutions && body.ambiguityResolutions.length > 0) {
      for (const res of body.ambiguityResolutions) {
        updated = resolveAmbiguity(
          updated,
          res.ambiguityId,
          res.fieldChanges ?? [],
        );
      }
    }

    // 4. 合并后必须仍合法
    const revalid = validateDatasetUnderstanding(updated);
    if (!revalid.ok) {
      throw new BadRequestError("合并后的理解结构非法", {
        error: revalid.error,
      });
    }
    updated = revalid.data;

    // 5. 可选确认
    if (body.confirm) {
      if (hasUnresolvedBlocking(updated)) {
        throw new UnprocessableEntityError(
          "存在未处理的阻塞性歧义，无法确认。请先解答所有 blocking 问题。",
        );
      }
      updated = confirmUnderstanding(updated, new Date().toISOString());
    }

    await saveUnderstanding(params.id, updated);
    logger.info("understanding_updated", {
      requestId,
      datasetId: params.id,
      status: updated.status,
      confirm: !!body.confirm,
    });

    return ok({ understanding: updated });
  } catch (err) {
    return fail(err, requestId);
  }
}
