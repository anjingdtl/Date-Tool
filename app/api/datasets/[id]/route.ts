import { NextRequest } from "next/server";
import {
  deleteDataset,
  getDataset,
  getPublicDataset,
} from "@/lib/store";
import { NotFoundError } from "@/lib/errors";
import { fail, newRequestId, ok } from "@/lib/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_ROWS = 10;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const requestId = newRequestId();
  try {
    const ds = await getDataset(params.id);
    if (!ds) throw new NotFoundError("数据集不存在");
    const pub = await getPublicDataset(params.id);
    return ok({
      ...pub,
      previewRows: ds.rows.slice(0, PREVIEW_ROWS),
      analysis: ds.analysis,
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
    const okDeleted = await deleteDataset(params.id);
    if (!okDeleted) throw new NotFoundError("数据集不存在");
    return ok({ deleted: true });
  } catch (err) {
    return fail(err, requestId);
  }
}
