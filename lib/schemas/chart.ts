import { z } from "zod";

/**
 * ChartSpec 严格校验（SPEC 11.4）。
 *
 * v0.2 阶段 F：agg 设为必填,因为本地推荐引擎(recommend-charts.ts)
 * 总会根据 metric format 决定聚合方式,不再依赖默认值。
 */
export const ChartSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  type: z.enum([
    "bar",
    "line",
    "pie",
    "table",
    "area",
    "stacked_bar",
    "scatter",
    "heatmap",
    "kpi",
  ]),
  xField: z.string().min(1),
  yField: z.string().min(1),
  groupBy: z.string().optional(),
  agg: z.enum(["sum", "avg", "count", "max", "min"]),
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
