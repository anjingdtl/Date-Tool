import { NextRequest } from "next/server";
import { getDataset, isValidDatasetId, updateDatasetConfig } from "@/lib/store";
import {
  FieldConfigUpdateSchema,
  hasBlockingIssues,
  validateFieldConfig,
} from "@/lib/schemas/dataset";
import { BadRequestError, NotFoundError, UnprocessableEntityError } from "@/lib/errors";
import { fail, newRequestId, ok } from "@/lib/respond";
import type { DatasetAnalysisConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/datasets/{id}/config
 * 预检阶段更新字段配置（SPEC 17.3）。
 *
 * 1. Zod 结构校验；
 * 2. 服务端业务校验（SPEC 9.7）；
 * 3. 落盘并返回最新 columns + issues。
 *
 * 即使存在 warning 也允许保存，阻断错误才拒绝。
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
    const existing = await getDataset(params.id);
    if (!existing) throw new NotFoundError("数据集不存在");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new BadRequestError("请求体不是合法 JSON");
    }

    const parsed = FieldConfigUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError("字段配置结构非法", parsed.error.flatten());
    }

    const issues = validateFieldConfig(parsed.data);
    const blocked = hasBlockingIssues(issues);

    if (blocked) {
      // 阻断错误：不落盘，返回 422 让前端定位
      throw new UnprocessableEntityError(
        "字段配置存在阻断错误，请先修复",
        issues,
      );
    }

    const updated = await updateDatasetConfig(
      params.id,
      parsed.data.columns,
      parsed.data.analysisConfig as DatasetAnalysisConfig | undefined,
    );
    if (!updated) throw new NotFoundError("数据集不存在");

    return ok({
      columns: updated.columns,
      config: updated.config,
      issues,
    });
  } catch (err) {
    return fail(err, requestId);
  }
}
