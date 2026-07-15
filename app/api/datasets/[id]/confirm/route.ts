import { NextRequest } from "next/server";
import { getDataset, isValidDatasetId, setDatasetStatus } from "@/lib/store";
import {
  FieldConfigUpdateSchema,
  hasBlockingIssues,
  validateFieldConfig,
} from "@/lib/schemas/dataset";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/errors";
import { fail, newRequestId, ok } from "@/lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/datasets/{id}/confirm
 * 将 draft → ready（SPEC 17.4）。
 *
 * 1. 当前状态必须是 draft（非 draft 不允许 confirm，避免覆盖已分析数据集）；
 * 2. 对当前 columns 跑一次 SPEC 9.7 校验，阻断错误禁止 confirm；
 * 3. 状态置为 ready，允许后续 analyze。
 *
 * 可选：请求体可携带最终字段配置，先保存再 confirm（一次请求完成）。
 */
export async function POST(
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

    if (existing.status && existing.status !== "draft") {
      throw new ConflictError(
        `数据集当前状态为「${existing.status}」，仅 draft 状态可 confirm。`,
      );
    }

    // 可选请求体：再次提交字段配置
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
      // 复用 config 路由的落盘逻辑：动态导入避免循环依赖
      const { updateDatasetConfig } = await import("@/lib/store");
      await updateDatasetConfig(
        params.id,
        parsed.data.columns,
        parsed.data.analysisConfig,
      );
    } else {
      // 没有 body：用现有 columns 自检
      const cols = existing.columns.map((c) => ({
        name: c.name,
        type: c.type,
        role: (c.role ?? "dimension") as
          | "time"
          | "metric"
          | "dimension"
          | "status"
          | "identifier"
          | "ignored",
        format: (c.format ?? "plain") as
          | "plain"
          | "integer"
          | "decimal"
          | "percentage"
          | "currency"
          | "duration"
          | "date"
          | "datetime",
        defaultAggregation: (c.defaultAggregation ?? "count") as
          | "sum"
          | "avg"
          | "count"
          | "max"
          | "min",
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

    const updated = await setDatasetStatus(params.id, "ready");
    if (!updated) throw new NotFoundError("数据集不存在");

    return ok({
      id: updated.id,
      status: updated.status,
      redirectTo: `/dashboard/${updated.id}`,
    });
  } catch (err) {
    return fail(err, requestId);
  }
}
