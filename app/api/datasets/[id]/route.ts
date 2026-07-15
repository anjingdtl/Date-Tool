import { NextRequest } from "next/server";
import {
  deleteDataset,
  getDataset,
  isValidDatasetId,
  toPublicDataset,
} from "@/lib/store";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { fail, newRequestId, ok } from "@/lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_ROWS = 10;
const PREVIEW_MODE_ROWS = 20;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const requestId = newRequestId();
  try {
    if (!isValidDatasetId(params.id)) {
      throw new BadRequestError("数据集 ID 不是合法 UUID");
    }
    const ds = await getDataset(params.id);
    if (!ds) throw new NotFoundError("数据集不存在");

    // v0.2 阶段 D：?mode=preview 用于预检页，返回前 20 行 + columns + config + quality
    const mode = req.nextUrl.searchParams.get("mode");
    if (mode === "preview") {
      return ok({
        id: ds.id,
        name: ds.name,
        fileName: ds.fileName,
        source: ds.source,
        rowCount: ds.rowCount,
        originalRowCount: ds.originalRowCount,
        storedRowCount: ds.storedRowCount,
        sheetName: ds.sheetName,
        columns: ds.columns,
        createdAt: ds.createdAt,
        status: ds.status,
        quality: ds.quality,
        config: ds.config,
        previewRows: ds.rows.slice(0, PREVIEW_MODE_ROWS),
        analysis: ds.analysis,
        analyses: ds.analyses ?? (ds.analysis ? [ds.analysis] : []),
        hasAnalysis: !!ds.analysis,
      });
    }

    // 直接从已读取的 ds 构造公开投影，避免二次读盘（SPEC 16）
    const pub = toPublicDataset(ds);
    return ok({
      ...pub,
      previewRows: ds.rows.slice(0, PREVIEW_ROWS),
      analysis: ds.analysis,
      quality: ds.quality,
      config: ds.config,
      analyses: ds.analyses ?? (ds.analysis ? [ds.analysis] : []),
    });
  } catch (err) {
    return fail(err, requestId);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const requestId = newRequestId();
  try {
    if (!isValidDatasetId(params.id)) {
      throw new BadRequestError("数据集 ID 不是合法 UUID");
    }
    const okDeleted = await deleteDataset(params.id);
    if (!okDeleted) throw new NotFoundError("数据集不存在");
    return ok({ deleted: true });
  } catch (err) {
    return fail(err, requestId);
  }
}
