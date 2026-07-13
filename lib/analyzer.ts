import { config } from "./config";
import { buildChartOption } from "./chart";
import { chatJSON, streamChat } from "./llm";
import type {
  AnalysisResult,
  ChartSpec,
  DatasetRow,
  EChartsOption,
  StoredDataset,
} from "./types";

function attachOptions(
  charts: ChartSpec[],
  ds: StoredDataset,
): EChartsOption[] {
  return charts.map((c) => buildChartOption(c, ds.rows));
}

/* ----------------------------- 工具函数 ----------------------------- */

function distinctCount(rows: DatasetRow[], field: string): number {
  const set = new Set<unknown>();
  for (const r of rows) set.add(r[field]);
  return set.size;
}

function isLowCardinality(rows: DatasetRow[], field: string, max = 20): boolean {
  return distinctCount(rows, field) <= max;
}

function numericStats(rows: DatasetRow[], field: string) {
  const vals: number[] = [];
  for (const r of rows) {
    const v = typeof r[field] === "number" ? (r[field] as number) : Number(r[field]);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return {
    count: vals.length,
    sum,
    avg: sum / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

function topCategory(rows: DatasetRow[], field: string) {
  const map = new Map<unknown, number>();
  for (const r of rows) {
    const v = r[field];
    if (v === null || v === undefined || v === "") continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  let best: { value: unknown; count: number } | null = null;
  for (const [value, count] of map) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c_${Math.random().toString(36).slice(2)}`;
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/* --------------------- 字段语义理解（读懂每个字段） --------------------- */

type FieldRole = "time" | "metric" | "dimension" | "status" | "identifier";

interface FieldInfo {
  name: string;
  type: string;
  role: FieldRole;
  /** 是否为比率类指标（用均值而非求和更合理） */
  rate: boolean;
  /** 可读的业务含义 */
  meaning: string;
}

// 常见业务术语 → 业务含义（命中即采用，体现“读懂字段”）
const MEANING_DICT: Record<string, string> = {
  转化率: "转化率（托管运营把群活跃转化为有效业务结果的核心效果指标）",
  留存率: "留存率（客户/成员持续留存的比例，衡量托管健康度）",
  活跃率: "活跃率（活跃成员占整体成员的比例）",
  托管群数: "托管群数（被托管的客户群数量，反映托管规模）",
  群数: "群数（社群数量，反映托管规模）",
  活跃成员数: "活跃成员数（群内活跃人数，反映社群活力）",
  成员数: "成员数（群成员总量）",
  消息总数: "消息总数（群消息量，反映互动热度）",
  消息数: "消息数（群消息量，反映互动热度）",
  客户名称: "客户名称（被托管的客户主体，核心分组维度）",
  客户: "客户（被托管主体，核心分组维度）",
  运营状态: "运营状态（标记托管是否健康，通常含 正常 / 预警）",
  状态: "状态（记录对象的健康/处理状态）",
  风险等级: "风险等级（标注风险高低，用于分层跟进）",
  日期: "日期（记录时间，用于趋势分析）",
};

const TIME_KW = ["日期", "时间", "date", "time", "月份", "周", "日", "创建", "更新"];
const STATUS_KW = ["状态", "预警", "风险", "等级", "健康", "flag", "status", "是否正常", "是否达标", "告警"];
const DIM_KW = ["客户", "地区", "区域", "渠道", "群", "负责", "部门", "门店", "产品", "类目", "来源", "城市", "行业", "类型", "标签"];
const RATE_KW = ["率", "占比", "比例", "百分", "roi", "留存", "转化", "转化"];
const ID_KW = ["id", "编号", "序号", "姓名", "手机号", "手机", "账号", "邮箱"];

function classifyField(name: string, type: string): FieldInfo {
  const lower = name.toLowerCase();
  const has = (kw: string) => lower.includes(kw.toLowerCase());

  if (type === "date" || TIME_KW.some(has)) {
    return { name, type, role: "time", rate: false, meaning: MEANING_DICT[name] ?? `${name}（时间维度，用于看趋势）` };
  }
  if (STATUS_KW.some(has)) {
    return { name, type, role: "status", rate: false, meaning: MEANING_DICT[name] ?? `${name}（状态标记，用于识别异常/健康）` };
  }
  if (type === "number") {
    const isId = ID_KW.some(has);
    if (isId) return { name, type, role: "identifier", rate: false, meaning: `${name}（标识字段）` };
    const rate = RATE_KW.some(has);
    const meaning =
      MEANING_DICT[name] ??
      (rate ? `${name}（比率类指标，衡量效果/占比）` : `${name}（数值指标）`);
    return { name, type, role: "metric", rate, meaning };
  }
  // 文本列
  if (DIM_KW.some(has)) {
    return { name, type, role: "dimension", rate: false, meaning: MEANING_DICT[name] ?? `${name}（分类维度，用于分组对比）` };
  }
  if (ID_KW.some(has)) {
    return { name, type, role: "identifier", rate: false, meaning: `${name}（标识字段）` };
  }
  return { name, type, role: "dimension", rate: false, meaning: MEANING_DICT[name] ?? `${name}（文本维度）` };
}

const WARN_RE = /(预警|异常|风险|告警|不达标|失败|负|warn|fail|risk|alert|lost)/i;

/* --------------------------- 数据画像（喂给 LLM / 洞察） --------------------------- */

function buildProfile(ds: StoredDataset): string {
  const lines: string[] = [];
  lines.push(`数据集名称：${ds.name}`);
  lines.push(`行数：${ds.rowCount}　列数：${ds.columns.length}`);
  for (const c of ds.columns) {
    const info = classifyField(c.name, c.type);
    let extra = "";
    if (c.type === "number") {
      const s = numericStats(ds.rows, c.name);
      if (s) extra = `范围 ${round(s.min)}~${round(s.max)}，均值 ${round(s.avg)}`;
    } else if (info.role !== "identifier") {
      const dc = distinctCount(ds.rows, c.name);
      const t = topCategory(ds.rows, c.name);
      extra = `取值 ${dc} 类` + (t ? `，最多为「${String(t.value)}」(${t.count}次)` : "");
    }
    lines.push(`- ${c.name} | 类型:${c.type} | 角色:${info.role} | 含义:${info.meaning}${extra ? " | " + extra : ""}`);
  }
  return lines.join("\n");
}

/* ------------------------------ Mock 分析（读懂每个字段） ------------------------------ */

function mockCharts(ds: StoredDataset): ChartSpec[] {
  const fields = ds.columns.map((c) => classifyField(c.name, c.type));
  const metrics = fields.filter((f) => f.role === "metric");
  const statuses = fields.filter((f) => f.role === "status");
  const dims = fields.filter(
    (f) => f.role === "dimension" && isLowCardinality(ds.rows, f.name),
  );
  const timeF = fields.find((f) => f.role === "time");
  const primaryDim = dims[0];
  const charts: ChartSpec[] = [];

  // 1) 每个指标：随时间趋势（若有时间轴）
  if (timeF) {
    for (const m of metrics) {
      charts.push({
        id: uid(),
        title: `趋势 · ${m.name} 随${timeF.name}变化`,
        type: "line",
        xField: timeF.name,
        yField: m.name,
        agg: m.rate ? "avg" : "sum",
        description: `以「${timeF.name}」为横轴，观察「${m.meaning}」的走势。`,
      });
    }
  }

  // 2) 每个指标：按主维度对比
  if (primaryDim) {
    for (const m of metrics) {
      charts.push({
        id: uid(),
        title: `对比 · 各${primaryDim.name}的${m.name}`,
        type: "bar",
        xField: primaryDim.name,
        yField: m.name,
        agg: m.rate ? "avg" : "sum",
        description: `按「${primaryDim.meaning}」分组，对比各主体的「${m.meaning}」。`,
      });
    }
  }

  // 3) 每个状态字段：分布 + 关键指标拆分
  for (const s of statuses) {
    charts.push({
      id: uid(),
      title: `构成 · ${s.name}分布`,
      type: "pie",
      xField: s.name,
      yField: "__count__",
      agg: "count",
      description: `各「${s.meaning}」取值占比，快速识别异常比例。`,
    });
    const keyMetric = metrics.find((m) => m.rate) ?? metrics[0];
    if (keyMetric) {
      charts.push({
        id: uid(),
        title: `各${s.name}下的${keyMetric.name}（均值）`,
        type: "bar",
        xField: s.name,
        yField: keyMetric.name,
        agg: "avg",
        description: `对比不同「${s.meaning}」下的「${keyMetric.meaning}」，定位需介入的对象。`,
      });
    }
  }

  // 4) 其余维度：构成饼图
  for (const d of dims) {
    charts.push({
      id: uid(),
      title: `构成 · ${d.name}分布`,
      type: "pie",
      xField: d.name,
      yField: "__count__",
      agg: "count",
      description: `各「${d.meaning}」的占比构成。`,
    });
  }

  // 5) 原始数据预览
  charts.push({
    id: uid(),
    title: "原始数据预览（前 10 行）",
    type: "table",
    xField: ds.columns[0]?.name ?? "index",
    yField: "__rows__",
    description: "表格形式查看导入的原始数据。",
  });

  return charts.slice(0, 14);
}

function mockInsights(ds: StoredDataset): string[] {
  const fields = ds.columns.map((c) => classifyField(c.name, c.type));
  const metrics = fields.filter((f) => f.role === "metric");
  const statuses = fields.filter((f) => f.role === "status");
  const dims = fields.filter(
    (f) => f.role === "dimension" && isLowCardinality(ds.rows, f.name),
  );
  const insights: string[] = [];

  for (const m of metrics) {
    const s = numericStats(ds.rows, m.name);
    if (!s) continue;
    const peakIdx = ds.rows.findIndex((r) => Number(r[m.name]) === s.max);
    const peakLabel = peakIdx >= 0 ? `出现在「${String(ds.rows[peakIdx][dims[0]?.name ?? ds.columns[0].name] ?? "")}」` : "";
    insights.push(
      `「${m.meaning}」共 ${s.count} 条有效数据，均值 ${round(s.avg)}，峰值 ${round(
        s.max,
      )}${peakLabel ? `（${peakLabel}）` : ""}，谷值 ${round(s.min)}。`,
    );
  }

  for (const s of statuses) {
    const map = new Map<unknown, number>();
    for (const r of ds.rows) {
      const v = r[s.name];
      if (v === null || v === undefined || v === "") continue;
      map.set(v, (map.get(v) ?? 0) + 1);
    }
    let warn = 0;
    const parts: string[] = [];
    for (const [k, v] of map) {
      parts.push(`${String(k)} ${v} 次`);
      if (WARN_RE.test(String(k))) warn += v;
    }
    const pct = ds.rowCount ? ((warn / ds.rowCount) * 100).toFixed(0) : "0";
    insights.push(
      `「${s.meaning}」分布：${parts.join("、")}；其中需关注的预警/异常共 ${warn} 次（占 ${pct}%），建议优先介入。`,
    );
  }

  for (const d of dims) {
    const t = topCategory(ds.rows, d.name);
    if (t)
      insights.push(
        `在「${d.meaning}」维度中，「${String(t.value)}」出现 ${t.count} 次，是占比最高的主体，值得作为重点样本深挖。`,
      );
  }

  if (insights.length === 0)
    insights.push(`数据集共 ${ds.rowCount} 行，已对每个字段逐列分析并生成可视化图表。`);
  return insights.slice(0, 12);
}

function mockNarrative(ds: StoredDataset, charts: ChartSpec[]): string {
  const fields = ds.columns.map((c) => classifyField(c.name, c.type));
  const metrics = fields.filter((f) => f.role === "metric").length;
  const dims = fields.filter((f) => f.role === "dimension").length;
  const statuses = fields.filter((f) => f.role === "status").length;
  return (
    `你好，世恒哥～ 我把《${ds.name}》的每一个字段都读了一遍：共 ${ds.columns.length} 列，其中 ` +
    `数值指标 ${metrics} 个、分类维度 ${dims} 个、状态标记 ${statuses} 个。\n\n` +
    `基于每个字段的业务含义，我变出了 ${charts.length} 张图表：每个指标都有趋势线和分组对比，每个状态都有分布与预警拆分，每个维度都有构成占比。` +
    `重点关注占比最大的那块饼、最高的那条柱，以及状态分布里的预警比例——它们往往藏着托管运营最该被看见的信号。\n\n` +
    `想深挖哪个字段？告诉我字段名，我直接去数据里翻个底朝天。`
  );
}

function mockAnalyze(ds: StoredDataset): AnalysisResult {
  const charts = mockCharts(ds);
  const fields = ds.columns.map((c) => classifyField(c.name, c.type));
  const metrics = fields.filter((f) => f.role === "metric").length;
  const cat = fields.filter((f) => f.role === "dimension" || f.role === "status").length;
  return {
    provider: "mock",
    summary: `数据集《${ds.name}》共 ${ds.rowCount} 行、${ds.columns.length} 列，已逐字段解读并生成 ${charts.length} 张图表。`,
    insights: mockInsights(ds),
    charts,
    options: attachOptions(charts, ds),
    narrative: mockNarrative(ds, charts),
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------ LLM 分析 ------------------------------ */

const SYSTEM_STRUCTURED = `你是一名资深的企业微信集约化托管运营数据分析师。
下面给出数据集的「字段画像」，每一列都已标注：字段名、类型、业务角色（time 时间 / metric 指标 / dimension 维度 / status 状态）、业务含义、取值范围与分布。

请先逐字段理解其业务含义，再据此设计可视化：**必须覆盖数据集的每一个字段**，为相关的指标、维度、状态都生成图表，不要只分析其中几个。

输出严格 JSON：
{
  "summary": "一句话总体结论（中文，50字内）",
  "insights": ["5到8条关键洞察，每条结合字段业务含义，给出可行动信号，中文"],
  "charts": [
    {
      "title": "图表标题（中文，体现业务含义）",
      "type": "bar | line | pie",
      "xField": "真实列名（必须是画像中的字段）",
      "yField": "数值列名（计数可填 __count__）",
      "groupBy": "可选，分组列名",
      "agg": "sum | avg | count | max | min",
      "description": "一句话说明这张图看什么（中文）"
    }
  ]
}
要求：charts 数量 6~12，至少包含每个数值指标的走势或对比、每个状态字段的分布、每个维度的构成。只输出 JSON，不要任何解释或代码围栏。`;

function coerceCharts(raw: unknown, ds: StoredDataset): ChartSpec[] {
  const validTypes = new Set(["bar", "line", "pie", "table"]);
  const arr = Array.isArray(raw) ? raw : [];
  const out: ChartSpec[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const xField = String(o.xField ?? "");
    const yField = String(o.yField ?? "");
    if (!xField) continue;
    const type = String(o.type ?? "bar");
    out.push({
      id: uid(),
      title: String(o.title ?? `${xField} 分析`),
      type: (validTypes.has(type) ? type : "bar") as ChartSpec["type"],
      xField,
      yField: yField || "__count__",
      groupBy: o.groupBy ? String(o.groupBy) : undefined,
      agg: (o.agg as ChartSpec["agg"]) ?? "sum",
      description: o.description ? String(o.description) : undefined,
    });
  }
  // 若 LLM 没给图，退回 mock 图保证有看板
  if (out.length === 0) return mockCharts(ds);
  return out.slice(0, 14);
}

async function llmStructured(
  ds: StoredDataset,
  requestId: string,
): Promise<Pick<AnalysisResult, "summary" | "insights" | "charts">> {
  const user = `以下是数据集字段画像，请逐字段理解后分析：\n\n${buildProfile(ds)}`;
  const parsed = (await chatJSON(SYSTEM_STRUCTURED, user, requestId)) as Record<
    string,
    unknown
  >;
  const insights = Array.isArray(parsed.insights)
    ? (parsed.insights as unknown[]).map((x) => String(x)).filter(Boolean)
    : [];
  return {
    summary: String(parsed.summary ?? `已分析《${ds.name}》。`),
    insights: insights.length ? insights : mockInsights(ds),
    charts: coerceCharts(parsed.charts, ds),
  };
}

const SYSTEM_NARRATIVE = `你是企微托管运营团队的AI数据分析师，风格亲切、像在给同事做汇报。
基于给定的数据集字段画像与逐字段分析结论，用中文写一段 250~400 字的解读：先总览数据集与每个字段的业务含义，再点出 2~3 个最值得关注的数据信号（覆盖指标、维度、状态），最后给一句行动建议。
不要重复 JSON，只输出纯文本。`;

/* ------------------------------ 统一入口 ------------------------------ */

interface AnalyzeHooks {
  onStructured?: (p: {
    summary: string;
    insights: string[];
    charts: ChartSpec[];
    options: EChartsOption[];
  }) => void;
  onNarrativeToken: (token: string) => void;
}

export async function analyzeDataset(
  ds: StoredDataset,
  requestId: string,
  hooks: AnalyzeHooks,
): Promise<AnalysisResult> {
  const createdAt = new Date().toISOString();

  const emitMock = (): AnalysisResult => {
    const r = mockAnalyze(ds);
    hooks.onStructured?.({
      summary: r.summary,
      insights: r.insights,
      charts: r.charts,
      options: r.options,
    });
    hooks.onNarrativeToken(r.narrative);
    return r;
  };

  if (!config.llm.enabled) {
    return { ...emitMock(), createdAt };
  }

  // 1) 结构化结论（图表 + 洞察）
  let structured: Pick<AnalysisResult, "summary" | "insights" | "charts">;
  try {
    structured = await llmStructured(ds, requestId);
  } catch {
    // 结构化失败 → 整体退回 Mock，保证可用
    return { ...emitMock(), createdAt };
  }

  const options = attachOptions(structured.charts, ds);
  hooks.onStructured?.({
    summary: structured.summary,
    insights: structured.insights,
    charts: structured.charts,
    options,
  });

  // 2) 流式解读文本（占卜师实时口播）
  let narrative = "";
  try {
    const userProfile = `字段画像：\n${buildProfile(ds)}\n\n逐字段分析结论：\n${JSON.stringify(
      { summary: structured.summary, insights: structured.insights },
      null,
      2,
    )}`;
    narrative = await streamChat(
      SYSTEM_NARRATIVE,
      userProfile,
      hooks.onNarrativeToken,
      requestId,
    );
  } catch {
    narrative = mockNarrative(ds, structured.charts);
  }

  return {
    provider: "llm",
    summary: structured.summary,
    insights: structured.insights,
    charts: structured.charts,
    options,
    narrative,
    createdAt,
  };
}
