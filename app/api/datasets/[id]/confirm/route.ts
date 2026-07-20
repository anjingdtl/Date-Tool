import { NextRequest } from "next/server";
import {
  getDataset,
  isValidDatasetId,
  reconfigureAndConfirm,
} from "@/lib/store";
import {
  FieldConfigUpdateSchema,
  hasBlockingIssues,
  validateFieldConfig,
  type FieldConfigUpdate,
} from "@/lib/schemas/dataset";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { fail, newRequestId, ok } from "@/lib/respond";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/datasets/{id}/confirm
 * 将 draft → ready，并按最终字段配置重新规范化数据（SPEC 7.4 / 23.2）。
 *
 * 1. 当前状态必须是 draft（非 draft 不允许 confirm，避免覆盖已分析数据集）；
 * 2. 校验最终字段配置（阻断错误禁止 confirm）；
 * 3. 按最终 columns 重新规范化 rows + 重算字段元数据 + 重算数据质量报告；
 * 4. 原子保存并置 status=ready。
 *
 * 请求体可携带最终字段配置（一次请求完成保存 + confirm）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  try {
    const { id } = await params;
    if (!isValidDatasetId(id)) {
      throw new BadRequestError("数据集 ID 不是合法 UUID");
    }
    const existing = await getDataset(id);
    if (!existing) throw new NotFoundError("数据集不存在");

    if (existing.status && existing.status !== "draft") {
      throw new ConflictError(
        `数据集当前状态为「${existing.status}」，仅 draft 状态可 confirm。`,
      );
    }

    // 可选请求体：最终字段配置
    let submittedColumns: FieldConfigUpdate["columns"] | undefined;
    let analysisConfig: FieldConfigUpdate["analysisConfig"] | undefined;
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      /* 允许空 body */
    }

    if (body && typeof body === "object") {
      const parsed = FieldConfigUpdateSchema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestError("字段配置结构非法", parsed.error.flatten());
      }
      const issues = validateFieldConfig(parsed.data);
      if (hasBlockingIssues(issues)) {
        throw new BadRequestError("字段配置存在阻断错误，无法 confirm", issues);
      }
      submittedColumns = parsed.data.columns;
      analysisConfig = parsed.data.analysisConfig;
    } else {
      // 无 body：用现有 columns 自检阻断错误
      const cols = existing.columns.map((c) => ({
        name: c.name,
        type: c.type,
        role: (c.role ?? "dimension") as FieldConfigUpdate["columns"][number]["role"],
        format: (c.format ?? "plain") as FieldConfigUpdate["columns"][number]["format"],
        defaultAggregation: (c.defaultAggregation ??
          "count") as FieldConfigUpdate["columns"][number]["defaultAggregation"],
        includeInAnalysis: c.includeInAnalysis ?? true,
      }));
      const issues = validateFieldConfig({ columns: cols });
      if (hasBlockingIssues(issues)) {
        throw new BadRequestError(
          "当前字段配置存在阻断错误，请回到预检页修复后再 confirm",
          issues,
        );
      }
    }

    const updated = await reconfigureAndConfirm(
      id,
      submittedColumns,
      analysisConfig,
    );
    if (!updated) throw new NotFoundError("数据集不存在");

    if (submittedColumns) {
      logger.info("dataset_reconfigured", {
        requestId,
        datasetId: id,
        columnCount: submittedColumns.length,
      });
    }
    logger.info("dataset_confirmed", {
      requestId,
      datasetId: id,
      status: updated.status,
      columnCount: updated.columns.length,
    });
    logger.info("dataset_normalized", {
      requestId,
      datasetId: id,
      rowCount: updated.rows.length,
      qualityWarnings: updated.quality?.warnings.length ?? 0,
    });

    return ok({
      id: updated.id,
      status: updated.status,
      redirectTo: `/dashboard/${updated.id}`,
    });
  } catch (err) {
    return fail(err, requestId);
  }
}
