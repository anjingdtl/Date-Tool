import { describe, it, expect } from "vitest";
import {
  FieldConfigUpdateSchema,
  hasBlockingIssues,
  validateFieldConfig,
  type FieldConfigUpdate,
} from "@/lib/schemas/dataset";

/** 构造合法的初始配置 */
function baseConfig(): FieldConfigUpdate {
  return {
    columns: [
      {
        name: "日期",
        type: "date",
        role: "time",
        format: "date",
        defaultAggregation: "count",
        includeInAnalysis: true,
      },
      {
        name: "客户",
        type: "string",
        role: "dimension",
        format: "plain",
        defaultAggregation: "count",
        includeInAnalysis: true,
      },
      {
        name: "金额",
        type: "number",
        role: "metric",
        format: "currency",
        defaultAggregation: "sum",
        includeInAnalysis: true,
      },
      {
        name: "转化率",
        type: "number",
        role: "metric",
        format: "percentage",
        defaultAggregation: "avg",
        includeInAnalysis: true,
      },
    ],
  };
}

describe("FieldConfigUpdateSchema", () => {
  it("合法配置通过", () => {
    const parsed = FieldConfigUpdateSchema.safeParse(baseConfig());
    expect(parsed.success).toBe(true);
  });

  it("columns 为空数组拒绝", () => {
    const parsed = FieldConfigUpdateSchema.safeParse({ columns: [] });
    expect(parsed.success).toBe(false);
  });

  it("type 非法值拒绝", () => {
    const cfg = baseConfig();
    (cfg.columns[0] as { type: string }).type = "datetime";
    const parsed = FieldConfigUpdateSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
  });

  it("role 非法值拒绝", () => {
    const cfg = baseConfig();
    (cfg.columns[0] as { role: string }).role = "primary";
    const parsed = FieldConfigUpdateSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
  });

  it("format 非法值拒绝", () => {
    const cfg = baseConfig();
    (cfg.columns[0] as { format: string }).format = "float";
    const parsed = FieldConfigUpdateSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
  });

  it("defaultAggregation 非法值拒绝", () => {
    const cfg = baseConfig();
    (cfg.columns[0] as { defaultAggregation: string }).defaultAggregation =
      "median";
    const parsed = FieldConfigUpdateSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
  });

  it("includeInAnalysis 非布尔值拒绝", () => {
    const cfg = baseConfig();
    (cfg.columns[0] as { includeInAnalysis: unknown }).includeInAnalysis = "yes";
    const parsed = FieldConfigUpdateSchema.safeParse(cfg);
    expect(parsed.success).toBe(false);
  });
});

describe("validateFieldConfig · SPEC 9.7 规则", () => {
  /* —— 规则 1：至少一个参与分析的字段 —— */

  it("规则1：全部 ignored → 阻断", () => {
    const cfg = baseConfig();
    cfg.columns.forEach((c) => {
      c.role = "ignored";
      c.includeInAnalysis = true;
    });
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.some((i) => i.message.includes("至少"))).toBe(true);
  });

  it("规则1：全部 includeInAnalysis=false → 阻断", () => {
    const cfg = baseConfig();
    cfg.columns.forEach((c) => {
      c.includeInAnalysis = false;
    });
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("规则1：至少一个纳入且非 ignored → 通过", () => {
    const cfg = baseConfig();
    cfg.columns[0].includeInAnalysis = true;
    cfg.columns[1].includeInAnalysis = false;
    cfg.columns[2].includeInAnalysis = false;
    cfg.columns[3].includeInAnalysis = false;
    const issues = validateFieldConfig(cfg);
    // 这里"日期"是 time 角色且纳入分析,无其它阻断错误
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  /* —— 规则 2：metric 必须为 number —— */

  it("规则2：metric 角色但 type=string → 阻断", () => {
    const cfg = baseConfig();
    cfg.columns[2].type = "string"; // 金额被设为 metric 但不是 number
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
    const err = issues.find(
      (i) => i.field === "金额" && i.level === "error",
    );
    expect(err).toBeTruthy();
    expect(err?.message).toContain("metric");
  });

  it("规则2：metric 角色且 type=number → 通过", () => {
    const cfg = baseConfig();
    const issues = validateFieldConfig(cfg);
    expect(
      issues.filter(
        (i) => i.field === "金额" && i.level === "error",
      ),
    ).toHaveLength(0);
  });

  /* —— 规则 3：time 角色最多一个 —— */

  it("规则3：两个 time 角色 → 阻断", () => {
    const cfg = baseConfig();
    cfg.columns[1].role = "time"; // 客户也设为 time
    cfg.columns[1].type = "date";
    cfg.columns[1].format = "date";
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
    const err = issues.find((i) => i.message.includes("time"));
    expect(err).toBeTruthy();
    expect(err?.message).toContain("2");
  });

  it("规则3：一个 time 角色 → 通过", () => {
    const cfg = baseConfig();
    const issues = validateFieldConfig(cfg);
    expect(
      issues.filter((i) => i.message.includes("time")),
    ).toHaveLength(0);
  });

  it("规则3：time 角色但 includeInAnalysis=false 不计入", () => {
    const cfg = baseConfig();
    cfg.columns[1].role = "time";
    cfg.columns[1].type = "date";
    cfg.columns[1].format = "date";
    cfg.columns[1].includeInAnalysis = false; // 排除
    const issues = validateFieldConfig(cfg);
    expect(
      issues.filter((i) => i.message.includes("time")),
    ).toHaveLength(0);
  });

  /* —— 规则 4：percentage 不得用 sum —— */

  it("规则4：percentage + sum → 阻断", () => {
    const cfg = baseConfig();
    cfg.columns[3].defaultAggregation = "sum"; // 转化率
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
    const err = issues.find((i) => i.field === "转化率");
    expect(err).toBeTruthy();
    expect(err?.message).toContain("百分比");
  });

  it("规则4：percentage + avg → 通过", () => {
    const cfg = baseConfig();
    const issues = validateFieldConfig(cfg);
    expect(
      issues.filter((i) => i.field === "转化率" && i.level === "error"),
    ).toHaveLength(0);
  });

  it("规则4：percentage + count → 通过", () => {
    const cfg = baseConfig();
    cfg.columns[3].defaultAggregation = "count";
    const issues = validateFieldConfig(cfg);
    expect(
      issues.filter((i) => i.field === "转化率" && i.level === "error"),
    ).toHaveLength(0);
  });

  /* —— 规则 5：identifier 不得用 sum/avg —— */

  it("规则5：identifier + sum → 阻断", () => {
    const cfg = baseConfig();
    cfg.columns[1].role = "identifier";
    cfg.columns[1].defaultAggregation = "sum";
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
    const err = issues.find((i) => i.field === "客户");
    expect(err).toBeTruthy();
    expect(err?.message).toContain("identifier");
  });

  it("规则5：identifier + avg → 阻断", () => {
    const cfg = baseConfig();
    cfg.columns[1].role = "identifier";
    cfg.columns[1].defaultAggregation = "avg";
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("规则5：identifier + count → 通过", () => {
    const cfg = baseConfig();
    cfg.columns[1].role = "identifier";
    cfg.columns[1].defaultAggregation = "count";
    const issues = validateFieldConfig(cfg);
    expect(
      issues.filter((i) => i.field === "客户" && i.level === "error"),
    ).toHaveLength(0);
  });

  /* —— 规则 6：字段名唯一 —— */

  it("规则6：字段名重复 → 阻断", () => {
    const cfg = baseConfig();
    cfg.columns[1].name = "日期"; // 与第一个重名
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
    const err = issues.find(
      (i) => i.field === "日期" && i.message.includes("重复"),
    );
    expect(err).toBeTruthy();
    expect(err?.message).toContain("2");
  });

  /* —— 组合场景 —— */

  it("合法的完整配置：无阻断错误", () => {
    const issues = validateFieldConfig(baseConfig());
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("多个错误同时存在：全部返回", () => {
    const cfg = baseConfig();
    cfg.columns[0].name = "金额"; // 与第 3 个重名 → 规则 6
    cfg.columns[2].type = "string"; // 金额 metric 但非 number → 规则 2
    cfg.columns[3].defaultAggregation = "sum"; // 转化率 percentage+sum → 规则 4
    const issues = validateFieldConfig(cfg);
    expect(hasBlockingIssues(issues)).toBe(true);
    // 至少 3 条 error
    const errs = issues.filter((i) => i.level === "error");
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("hasBlockingIssues", () => {
  it("空数组 → false", () => {
    expect(hasBlockingIssues([])).toBe(false);
  });

  it("只有 warning → false", () => {
    expect(
      hasBlockingIssues([{ level: "warning", message: "x" }]),
    ).toBe(false);
  });

  it("包含 error → true", () => {
    expect(
      hasBlockingIssues([
        { level: "warning", message: "x" },
        { level: "error", message: "y" },
      ]),
    ).toBe(true);
  });
});
