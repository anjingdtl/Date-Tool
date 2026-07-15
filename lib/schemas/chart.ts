import { z } from "zod";

/**
 * ChartSpec 严格校验（spec 11.4）
 * agg 设为可选以兼容现有数据；阶段 F 语义校验时会补默认值。
 */
export const ChartSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  type: z.enum(["bar", "line", "pie", "table"]),
  xField: z.string().min(1),
  yField: z.string().min(1),
  groupBy: z.string().optional(),
  agg: z.enum(["sum", "avg", "count", "max", "min"]).optional(),
  description: z.string().max(300).optional(),
  evidenceId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export type ChartSpecInput = z.input<typeof ChartSpecSchema>;
export type ChartSpecParsed = z.output<typeof ChartSpecSchema>;

/** 校验单个 ChartSpec，返回 [ok, spec] */
export function validateChartSpec(
  raw: unknown,
): { ok: true; spec: ChartSpecParsed } | { ok: false; error: string } {
  const r = ChartSpecSchema.safeParse(raw);
  if (r.success) return { ok: true, spec: r.data };
  return { ok: false, error: r.error.issues.map((i) => i.message).join("; ") };
}

/** 批量校验并过滤：不合法的只跳过该图，不抛错（spec 11.4 局部容错） */
export function filterValidCharts(
  raws: unknown[],
): ChartSpecParsed[] {
  const out: ChartSpecParsed[] = [];
  for (const raw of raws) {
    const r = validateChartSpec(raw);
    if (r.ok) out.push(r.spec);
  }
  return out;
}
