import { NextRequest } from "next/server";
import { parseBuffer } from "@/lib/parse";
import { saveDataset } from "@/lib/store";
import { listDatasets } from "@/lib/store";
import { BadRequestError, UnprocessableEntityError } from "@/lib/errors";
import { fail, newRequestId, ok } from "@/lib/respond";
import type { StoredDataset } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB

export async function GET() {
  const requestId = newRequestId();
  try {
    const datasets = await listDatasets();
    return ok({ datasets });
  } catch (err) {
    return fail(err, requestId);
  }
}

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  try {
    const form = await req.formData();
    const file = form.get("file");
    const nameInput = (form.get("name") as string | null)?.trim() || "";

    if (!(file instanceof File)) {
      throw new BadRequestError("请通过 form-data 上传 file 字段");
    }
    if (file.size === 0) throw new BadRequestError("文件为空");
    if (file.size > MAX_BYTES)
      throw new BadRequestError("文件超过 15MB 上限");

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseBuffer(buffer, file.name);
    if (parsed.rows.length === 0)
      throw new UnprocessableEntityError("未解析到任何数据行，请检查文件格式");

    const id = crypto.randomUUID();
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const ds: StoredDataset = {
      id,
      name: nameInput || baseName,
      fileName: file.name,
      source: parsed.source,
      rowCount: parsed.rows.length,
      originalRowCount: parsed.originalRowCount,
      storedRowCount: parsed.storedRowCount,
      sheetName: parsed.sheetName,
      availableSheets: parsed.availableSheets,
      columns: parsed.columns,
      rows: parsed.rows,
      quality: parsed.quality,
      // v0.2 阶段 D：上传后先进入 draft 状态，必须经过预检 confirm 才能进入 ready
      status: "draft",
      analysis: null,
      createdAt: new Date().toISOString(),
    };
    await saveDataset(ds);

    return ok(
      {
        id,
        name: ds.name,
        fileName: ds.fileName,
        source: ds.source,
        rowCount: ds.rowCount,
        originalRowCount: ds.originalRowCount,
        storedRowCount: ds.storedRowCount,
        sheetName: ds.sheetName,
        availableSheets: ds.availableSheets,
        columns: ds.columns,
        quality: ds.quality,
        status: ds.status,
        truncated: parsed.truncated,
        hasAnalysis: false,
      },
      201,
    );
  } catch (err) {
    return fail(err, requestId);
  }
}
