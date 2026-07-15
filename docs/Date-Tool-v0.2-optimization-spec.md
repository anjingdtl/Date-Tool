# Date-Tool v0.2 优化改造规格说明书

> 文档类型：工程改造 Spec  
> 目标读者：负责实施改造的 AI 编程 Agent / 开发者  
> 项目仓库：`anjingdtl/Date-Tool`  
> 目标版本：`v0.2.0`  
> 产品定位：个人、本地优先、可信环境下使用的数据分析与辅助图表工具  
> 最后更新：2026-07-15

---

## 1. 项目背景

Date-Tool 当前已具备完整的个人数据分析闭环：

1. 导入 Excel / CSV；
2. 自动解析数据与推断字段类型；
3. 使用本地启发式分析器或兼容 OpenAI Chat Completions 的 LLM 生成洞察；
4. 生成 ECharts 图表；
5. 通过 SSE 流式显示文字解读；
6. 缓存分析结果；
7. 支持图表复制和 PNG 下载；
8. 支持多套视觉主题和 Windows 一键启动。

本次改造不把项目扩展为多人 SaaS、企业数据平台或通用 BI 系统，而是围绕个人使用目标，提高以下四项能力：

- **数据识别更准确**
- **图表生成更符合用户意图**
- **分析结论有明确计算依据**
- **本地使用更稳定、更省操作**

---

## 2. 产品目标

### 2.1 核心目标

将 Date-Tool 改造为：

> 用户导入一份日常工作数据表后，系统能够先检查数据质量、允许用户修正字段含义，再通过确定性计算生成可靠的图表和洞察，最后由 LLM 对计算结果进行自然语言解读。

### 2.2 目标用户

仅面向项目作者本人，典型使用场景包括：

- 企业微信托管运营数据分析；
- 工作周报、月报数据生成图表；
- 客户、渠道、区域、业务量等维度对比；
- 转化率、活跃率、留存率、响应时长等指标分析；
- 将图表复制到微信、飞书、Word 或 PowerPoint；
- 临时导入任意结构较规整的 Excel / CSV，快速获得可用图表。

### 2.3 成功标准

改造完成后，应满足：

1. 导入文件后能够看到清晰的数据质量报告；
2. 用户可以修正系统推断错误的字段类型和业务角色；
3. 日期排序、百分比、金额、千分位数字等常见格式能够正确处理；
4. 图表中的计算结果可追溯到明确的字段和聚合方式；
5. LLM 不负责直接计算关键指标，只负责解释已经计算出的结果；
6. 任意 LLM 调用失败时，完整本地分析流程仍然可用；
7. 主要流程在本地 Windows 环境稳定运行；
8. 不显著增加部署和使用复杂度。

---

## 3. 非目标

以下内容明确不在本次改造范围内：

- 用户注册和登录；
- 多用户并发使用；
- RBAC 权限体系；
- 团队工作空间；
- 云端数据库；
- PostgreSQL、Redis、消息队列；
- 多实例部署；
- Serverless 部署适配；
- 企业级审计；
- 复杂报表设计器；
- 拖拽式 BI 编辑器；
- 企业微信 API 自动同步；
- 实时大屏；
- 移动端原生应用；
- 对外开放的公共 API；
- 大规模数据仓库分析；
- 自动训练模型或微调模型。

如某项改造仅为了多人或公网部署服务，不应纳入本版本。

---

## 4. 设计原则

### 4.1 本地优先

- 默认只考虑本机访问；
- 默认数据保存在 `.data/`；
- 不要求安装数据库；
- 不依赖 LLM 也能完成分析；
- 不上传完整原始数据给 LLM。

### 4.2 确定性计算优先

所有关键数值必须由本地代码计算，不允许让 LLM自行估算：

- 总数、均值、最大值、最小值；
- 环比、变化率；
- 分组汇总；
- 状态占比；
- Top / Bottom 排名；
- 缺失率；
- 重复率；
- 异常值；
- 趋势变化。

LLM 的职责仅为：

- 解释计算结果；
- 总结业务含义；
- 提供行动建议；
- 优化图表标题和描述。

### 4.3 用户可校正

自动推断不能被视为最终事实。用户应能修改：

- 字段数据类型；
- 字段业务角色；
- 百分比和金额格式；
- 是否参与分析；
- 默认聚合方式；
- 时间字段；
- 主维度和核心指标。

### 4.4 保持轻量

优先使用现有 Next.js、TypeScript、Zod、ECharts 和文件存储，不应为抽象而抽象，也不应引入重型框架。

### 4.5 保留现有视觉资产

必须保留并兼容：

- Verdigris、Ocean、Sunset、Ink 四套主题；
- 液态玻璃 UI；
- 单列图表布局；
- 图表复制 PNG；
- 图表下载 PNG；
- SSE 流式解读；
- Windows 一键启动；
- 本地 Mock 分析器；
- 当前已有数据集兼容读取。

---

## 5. 改造范围与优先级

### P0：本版本必须完成

1. 数据导入预检页面；
2. 字段类型和角色修正；
3. 日期、百分比、金额和千分位解析；
4. 数据质量报告；
5. 确定性分析引擎；
6. 图表规格严格校验；
7. LLM 改为解释本地计算结果；
8. 数据集 ID 校验；
9. 原子文件写入；
10. LLM 请求超时；
11. 基础单元测试；
12. CI 执行 typecheck、test、build。

### P1：建议完成

1. 图表字段选择和重新生成；
2. 图表显示设置；
3. 分析依据面板；
4. 导出完整分析摘要为 Markdown；
5. 数据集重命名；
6. 软删除或回收站；
7. 分析历史保留最近 3 次；
8. 图表数量和类别控制。

### P2：后续版本考虑

1. 多轮追问；
2. 用户自定义指标公式；
3. 保存分析模板；
4. 多工作表选择；
5. PDF 报告导出；
6. Excel 清洗结果导出；
7. 企业微信数据直连。

---

## 6. 目标用户流程

### 6.1 新流程

```text
首页
  ↓
拖入 Excel / CSV
  ↓
解析与数据预检
  ↓
字段确认与修正
  ↓
保存数据集
  ↓
执行本地确定性分析
  ↓
立即显示图表和数据依据
  ↓
可选：调用 LLM 生成自然语言解读
  ↓
复制、下载或调整图表
```

### 6.2 交互原则

- 上传后不应立即跳转到最终看板；
- 先进入“数据预检”阶段；
- 系统自动推断后，用户可以直接接受，也可以修改；
- “生成看板”按钮必须明确；
- 本地分析结果应先于 LLM 文本出现；
- LLM 不可用时页面不得长期停留在加载状态；
- 图表错误不得导致整个看板崩溃。

---

## 7. 数据模型改造

### 7.1 字段角色

新增：

```ts
export type FieldRole =
  | "time"
  | "metric"
  | "dimension"
  | "status"
  | "identifier"
  | "ignored";
```

### 7.2 字段格式

新增：

```ts
export type FieldFormat =
  | "plain"
  | "integer"
  | "decimal"
  | "percentage"
  | "currency"
  | "duration"
  | "date"
  | "datetime";
```

### 7.3 字段元数据

将 `ColumnMeta` 扩展为：

```ts
export interface ColumnMeta {
  name: string;
  originalName: string;
  type: ColumnType;
  role: FieldRole;
  format: FieldFormat;
  sampleValues: unknown[];
  nullable: boolean;
  nullCount: number;
  nullRate: number;
  distinctCount: number;
  confidence: number;
  includeInAnalysis: boolean;
  defaultAggregation?: Aggregation;
  userModified: boolean;
}
```

要求：

- `confidence` 取值 0～1；
- 用户修改字段后，`userModified = true`；
- `ignored` 字段不参与图表推荐和 LLM 提示；
- 标识符默认不参与数值聚合；
- 比率字段默认聚合为 `avg`；
- 数量和金额字段默认聚合为 `sum`。

### 7.4 数据质量报告

新增：

```ts
export interface DataQualityReport {
  originalRowCount: number;
  storedRowCount: number;
  columnCount: number;
  duplicateRowCount: number;
  emptyRowCount: number;
  warnings: DataQualityWarning[];
  generatedAt: string;
}

export interface DataQualityWarning {
  code:
    | "TRUNCATED"
    | "HIGH_NULL_RATE"
    | "MIXED_TYPE"
    | "DUPLICATE_ROWS"
    | "INVALID_DATE"
    | "POSSIBLE_IDENTIFIER"
    | "HIGH_CARDINALITY"
    | "EMPTY_COLUMN"
    | "DUPLICATE_COLUMN_NAME";
  level: "info" | "warning" | "error";
  field?: string;
  message: string;
}
```

### 7.5 数据集状态

新增：

```ts
export type DatasetStatus =
  | "draft"
  | "ready"
  | "analyzing"
  | "completed"
  | "error";
```

`StoredDataset` 至少包括：

```ts
export interface StoredDataset extends Dataset {
  status: DatasetStatus;
  rows: DatasetRow[];
  quality: DataQualityReport;
  config: DatasetAnalysisConfig;
  analyses: AnalysisResult[];
}
```

### 7.6 分析配置

新增：

```ts
export interface DatasetAnalysisConfig {
  timeField?: string;
  primaryDimension?: string;
  statusFields: string[];
  metricFields: string[];
  ignoredFields: string[];
  maxCharts: number;
}
```

### 7.7 分析证据

新增：

```ts
export interface AnalysisEvidence {
  id: string;
  title: string;
  description: string;
  fields: string[];
  method:
    | "summary"
    | "group_compare"
    | "trend"
    | "top_bottom"
    | "status_distribution"
    | "missingness"
    | "outlier"
    | "change_rate";
  result: Record<string, unknown>;
  sampleSize: number;
}
```

`AnalysisResult` 增加：

```ts
evidence: AnalysisEvidence[];
warnings: string[];
version: string;
```

---

## 8. 数据导入与解析规格

### 8.1 文件支持

继续支持：

- `.xlsx`
- `.xls`
- `.csv`
- `.txt`

文件大小上限继续保持 15MB，可在设置中预留配置项，但本版本不要求 UI 修改上限。

### 8.2 Excel 工作表

P0 处理方式：

- 默认读取第一个非空工作表；
- 若存在多个非空工作表，在预检页显示已选择的工作表名称；
- P2 再增加工作表手动选择。

### 8.3 行数信息

必须同时保存：

- `originalRowCount`：原文件解析出的总行数；
- `storedRowCount`：实际存储行数；
- `analysisSampleCount`：实际参与分析的行数。

不得再把截断后的行数显示成原始总行数。

### 8.4 类型推断

不得只依赖前 50 行。

建议规则：

- 数据少于 500 行：检查全部；
- 数据超过 500 行：均匀采样头部、中部、尾部，合计最多 500 行；
- 忽略空值后计算各类型命中率；
- 返回类型置信度；
- 类型混合明显时标记 `MIXED_TYPE`。

### 8.5 数值标准化

支持解析：

- `"1,234"` → `1234`
- `"1,234.56"` → `1234.56`
- `"23%"` → 内部数值 `0.23`
- `"￥1,200"` → `1200`
- `"¥1,200"` → `1200`
- `"$1,200"` → `1200`
- `"12.5 分钟"` → 数值 `12.5`，格式为 duration
- 全角百分号和空格应处理。

原始展示值与标准化值至少保留一种可追溯方式。可采用：

- 存储标准化值；
- 在字段元数据中记录格式；
- 导出或预览时按格式重新展示。

### 8.6 日期标准化

日期字段应统一转为 ISO 字符串：

- 日期：`YYYY-MM-DD`
- 日期时间：ISO 8601

至少支持：

- `2026-07-15`
- `2026/7/15`
- `2026年7月15日`
- `7/15/2026`
- Excel Date 单元格
- Excel 日期序列值（由 SheetJS 转换）

无法解析的值保留原值并计入 `INVALID_DATE`。

图表排序必须使用时间戳，不得使用简单字符串排序。

### 8.7 列名清理

继续过滤 SheetJS 的：

- `__EMPTY`
- `__EMPTY_1`
- 其他 `__EMPTY_*`

同时处理：

- 首尾空格；
- 换行；
- 重复列名；
- 空列名。

重复列名应自动改为：

```text
客户
客户_2
客户_3
```

并生成质量提示。

### 8.8 数据截断

超过 `MAX_STORED_ROWS` 时：

- 不阻止导入；
- 明确显示原始行数和实际存储行数；
- 生成 `TRUNCATED` warning；
- 所有洞察必须注明基于截断数据；
- 不允许 LLM 将抽样结果描述为全量结论。

---

## 9. 数据预检页面

### 9.1 路由

新增：

```text
/import/[draftId]
```

上传接口先生成 `draft` 数据集，上传成功后跳转到预检页。

### 9.2 页面结构

预检页从上到下包括：

1. 文件摘要；
2. 数据质量概览；
3. 字段配置表；
4. 前 20 行数据预览；
5. 生成看板按钮。

### 9.3 文件摘要

显示：

- 数据集名称；
- 文件名；
- 工作表名；
- 原始行数；
- 实际存储行数；
- 列数；
- 是否截断。

### 9.4 数据质量概览

显示卡片：

- 空值总量；
- 重复行数；
- 混合类型字段数；
- 日期解析异常数；
- 高基数字段数。

警告必须使用易懂中文，不显示内部异常堆栈。

### 9.5 字段配置表

每行显示：

- 字段名称；
- 样例；
- 推断类型；
- 业务角色；
- 格式；
- 默认聚合；
- 置信度；
- 是否参与分析。

允许修改：

- 类型；
- 角色；
- 格式；
- 默认聚合；
- 是否参与分析。

### 9.6 快捷操作

提供：

- “接受全部推断”
- “重置推断”
- “忽略空字段”
- “生成看板”

### 9.7 校验

生成看板前检查：

- 至少一个参与分析的字段；
- metric 角色必须为可数值化字段；
- time 角色最多一个主时间字段；
- `percentage` 不得默认使用 `sum`；
- identifier 不得默认使用 `sum` 或 `avg`；
- 字段名必须唯一。

存在阻断错误时禁止继续，并定位到字段。

---

## 10. 确定性分析引擎

### 10.1 新模块结构

建议新增：

```text
lib/analysis/
  profile.ts
  quality.ts
  statistics.ts
  trends.ts
  comparisons.ts
  outliers.ts
  recommend-charts.ts
  evidence.ts
  index.ts
```

不得继续把所有逻辑集中在单个 `analyzer.ts`。

### 10.2 基础统计

每个 metric 字段计算：

- 有效样本数；
- 空值数和空值率；
- sum；
- avg；
- min；
- max；
- median；
- P25；
- P75；
- 标准差；
- 零值数量；
- 负值数量。

### 10.3 维度统计

每个 dimension / status 字段计算：

- distinctCount；
- Top 10；
- Bottom 10；
- 各取值计数；
- 各取值占比；
- 空值数量；
- 长尾比例。

### 10.4 时间趋势

存在 time 字段时：

- 按自然粒度决定日、周或月；
- 默认按时间升序；
- 对每个核心 metric 生成趋势；
- 计算首期值、末期值、绝对变化、变化率；
- 样本不足 2 个周期时不生成变化率；
- 分母为 0 时不得生成无穷值；
- 对 percentage 指标使用均值；
- 对 count / currency 指标默认使用 sum。

### 10.5 分组对比

存在主维度时：

- 对每个核心 metric 按主维度聚合；
- 生成 Top 10；
- 高基数字段不直接生成全量图；
- 根据 metric 格式选择 sum 或 avg；
- 记录聚合方法和样本数。

### 10.6 状态分析

对 status 字段：

- 生成状态分布；
- 使用关键词识别预警类状态；
- 同时允许用户在后续版本中配置预警值；
- 计算预警数量和占比；
- 若存在核心指标，比较预警组与正常组的均值差异。

### 10.7 异常值

P0 使用 IQR 方法：

```text
下界 = Q1 - 1.5 × IQR
上界 = Q3 + 1.5 × IQR
```

要求：

- 样本少于 8 条时不做异常值判断；
- 标识符和比率型离散编码不做异常值；
- 返回异常数量和最多 5 个异常样本；
- 不得将统计异常自动描述为业务错误。

### 10.8 洞察生成

本地引擎先生成结构化洞察：

```ts
export interface ComputedInsight {
  id: string;
  level: "info" | "positive" | "warning";
  title: string;
  statement: string;
  evidenceId: string;
  fields: string[];
}
```

示例：

```text
标题：预警状态占比需要关注
结论：运营状态为“预警”的记录有 18 条，占有效记录的 12.4%。
依据：运营状态字段计数，共 145 条有效记录。
```

所有洞察必须引用 `evidenceId`。

---

## 11. 图表推荐引擎

### 11.1 原则

图表推荐由本地规则完成，LLM 不直接决定最终字段。

### 11.2 默认图表上限

默认最多 8 张：

1. 1 张数据质量或总览卡；
2. 最多 3 张核心指标趋势图；
3. 最多 2 张主维度对比图；
4. 最多 1 张状态分布图；
5. 1 张原始数据表。

设置页允许选择：

- 6 张；
- 8 张；
- 10 张；
- 12 张。

默认 8 张。

### 11.3 图表选择规则

#### line

适用：

- 存在合法时间字段；
- 至少两个时间点；
- yField 为 metric。

#### bar

适用：

- 维度类别 2～30；
- 需要精确比较；
- 类别超过 10 时默认只显示 Top 10。

#### pie

仅适用：

- 状态或构成；
- 类别 2～6；
- 有明确整体；
- 类别超过 6 时改为 bar。

#### table

用于：

- 原始数据预览；
- 异常样本；
- 明细排名。

### 11.4 ChartSpec 校验

使用 Zod：

```ts
const ChartSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  type: z.enum(["bar", "line", "pie", "table"]),
  xField: z.string().min(1),
  yField: z.string().min(1),
  groupBy: z.string().optional(),
  agg: z.enum(["sum", "avg", "count", "max", "min"]),
  description: z.string().max(300).optional(),
  evidenceId: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
```

语义校验：

- `xField` 必须存在；
- `yField` 必须存在，或为系统保留值；
- `groupBy` 必须存在；
- line 的 yField 必须可数值化；
- percentage 默认不能 sum；
- identifier 不能作为 metric；
- pie 类别超过 6 时自动降级为 bar；
- 不合法 ChartSpec 只跳过该图，不得导致分析失败。

### 11.5 图表排序

图表显示顺序：

1. 核心趋势；
2. 核心维度对比；
3. 状态和构成；
4. 异常与排名；
5. 原始数据表。

---

## 12. LLM 改造规格

### 12.1 LLM 输入

不得发送完整原始数据。

发送内容包括：

- 数据集名称；
- 字段定义；
- 数据质量摘要；
- 本地计算出的结构化洞察；
- 结构化 evidence；
- 已确定的图表标题与描述；
- 截断和异常警告。

### 12.2 LLM 输出

LLM 只输出：

```ts
export interface LLMInterpretation {
  summary: string;
  narrative: string;
  actions: string[];
  renamedChartTitles?: Record<string, string>;
}
```

LLM 不再输出 ChartSpec 的字段映射和聚合方法。

允许 LLM 优化：

- 图表标题；
- 图表说明；
- 总结；
- 行动建议。

不允许 LLM 修改：

- xField；
- yField；
- agg；
- 计算结果；
- 样本数；
- evidence。

### 12.3 Prompt 约束

System Prompt 必须包含：

- 所有数值均来自本地计算，不得修改；
- 不得编造未提供的事实；
- 数据被截断时必须使用“基于已载入数据”；
- 异常值只能描述为“统计异常”；
- 行动建议必须与已有证据对应；
- 不得输出 `<think>`；
- 输出中文。

### 12.4 调用策略

分析流程：

```text
本地计算
  ↓
立即向前端发送 structured 结果
  ↓
若启用 LLM，则生成 interpretation
  ↓
流式发送 narrative
  ↓
保存完整结果
```

### 12.5 超时

所有 LLM fetch 必须使用 `AbortController`：

- 结构化解释：30 秒；
- 流式解读：60 秒；
- 测试连接：12 秒。

超时后：

- 保留本地结果；
- 向前端显示“LLM 解读超时，已保留本地分析”；
- provider 标记为 `mock` 或 `local`；
- 不得清空已显示的图表。

### 12.6 Provider 状态

将：

```ts
provider: "mock" | "llm"
```

改为：

```ts
provider: "local" | "local+llm"
```

避免用户误以为 Mock 结果不是正式计算结果。

---

## 13. 看板页面改造

### 13.1 顶部信息区

显示：

- 数据集名称；
- 原始行数；
- 实际分析行数；
- 字段数；
- 分析时间；
- `本地分析` 或 `本地分析 + LLM 解读`；
- 数据截断 warning。

### 13.2 分析阶段状态

分析按钮点击后显示：

1. 正在计算数据质量；
2. 正在生成统计结果；
3. 正在生成图表；
4. 正在生成 LLM 解读。

本地结果出现后，不再显示阻塞式全局 loading。

### 13.3 洞察面板

每条洞察增加“查看依据”。

点击后显示：

- 涉及字段；
- 计算方法；
- 样本数；
- 聚合方式；
- 关键计算结果。

### 13.4 图表卡片

保留现有复制 PNG 和下载 PNG。

新增：

- 查看数据依据；
- 显示聚合方式；
- Top N 标识；
- 空数据状态；
- 图表计算失败时的局部错误提示。

P1 增加：

- 切换 bar / line；
- 修改 Top N；
- 隐藏图表；
- 修改标题。

### 13.5 导出 Markdown

P1 新增“导出分析摘要”按钮，生成 `.md`，包含：

- 数据集摘要；
- 数据质量；
- 核心洞察；
- 行动建议；
- 图表列表；
- 每张图的字段、聚合和依据。

不要求在 Markdown 中嵌入 PNG。

---

## 14. 数据集管理

### 14.1 首页列表

每个数据集显示：

- 名称；
- 文件名；
- 原始行数；
- 已载入行数；
- 字段数；
- 状态；
- 上次分析时间；
- 是否使用 LLM。

### 14.2 删除

P0：

- 保留二次确认；
- 删除失败必须显示错误；
- 不再静默忽略列表加载错误。

P1：

- 改为软删除；
- 放入 `.data/trash/`；
- 提供恢复和彻底删除；
- 自动清理 30 天前回收站内容。

### 14.3 重命名

P1 支持重命名数据集，只修改 metadata，不修改原始文件名。

### 14.4 分析历史

P1 最多保留最近 3 次分析：

```ts
analyses: AnalysisResult[]
```

重新分析时追加，超过 3 次删除最旧记录。

---

## 15. 本地设置与运行边界

### 15.1 不增加登录

本项目明确为个人工具，本版本不增加鉴权系统。

### 15.2 仅监听本机

Windows 启动脚本必须明确让 Next.js 只监听：

```text
127.0.0.1
```

启动命令示例：

```bash
next dev -H 127.0.0.1
next start -H 127.0.0.1
```

页面和 README 中明确：

> Date-Tool 按本地个人工具设计，不应将端口映射或暴露到公网。

### 15.3 Shutdown 接口

保留关闭 WebUI 自动关闭服务的个人体验，但必须修正：

- 缺少 sessionId 时不得立即退出；
- 只接受已注册的 sessionId；
- 未知 sessionId 返回 400；
- 生产模式允许通过环境变量关闭自动退出：
  `AUTO_SHUTDOWN_ENABLED=true|false`；
- 默认 Windows 一键启动为 true；
- 普通 `npm run dev` 默认 false，避免开发调试中意外退出。

### 15.4 LLM Base URL

个人本地工具不要求复杂 SSRF 防护，但需：

- 使用 `new URL()` 校验；
- 只接受 `http:` 或 `https:`；
- 默认推荐 HTTPS；
- 显示“仅填写你信任的模型服务地址”；
- 测试连接前先保存或明确使用表单当前值；
- 测试结果不得回显完整服务端响应。

### 15.5 API Key

本版本允许继续保存在 `.data/settings.json`，但必须：

- README 明确为本地明文保存；
- `.data/` 必须处于 `.gitignore`；
- 前端永远不返回明文；
- 日志不得记录 API Key；
- 提供“清除 API Key”明确按钮；
- 优先支持环境变量覆盖；
- 不增加加密存储依赖。

---

## 16. 文件存储改造

### 16.1 目录结构

建议改为：

```text
.data/
  settings.json
  datasets/
    {id}/
      meta.json
      rows.json
      analyses.json
  trash/
```

若本次迁移成本过高，可以保留单文件格式，但必须实现原子写入和索引优化。

### 16.2 推荐最低实现

P0 最低要求：

- 新增 `saveJsonAtomic()`；
- 所有 JSON 写入先写临时文件，再 rename；
- ID 必须经过 UUID 校验；
- `listDatasets()` 不读取完整 rows；
- metadata 与 rows 至少逻辑分离。

### 16.3 原子写入

新增：

```ts
async function saveJsonAtomic(file: string, data: unknown): Promise<void>
```

流程：

1. 确保目录存在；
2. 写入同目录临时文件；
3. 完整写入 UTF-8 JSON；
4. rename 到目标文件；
5. 失败时清理临时文件。

### 16.4 ID 校验

统一：

```ts
export const DatasetIdSchema = z.string().uuid();
```

所有以下入口必须验证：

- GET dataset；
- DELETE dataset；
- analyze；
- update config；
- rename；
- restore。

存储层也必须拒绝非 UUID。

### 16.5 旧数据迁移

首次读取旧格式 `{id}.json` 时：

- 自动识别；
- 转换到新目录结构；
- 保留旧文件为 `.bak`；
- 迁移失败时继续只读旧文件并记录 warning；
- 不得直接丢失旧数据。

---

## 17. API 规格

### 17.1 上传草稿

```text
POST /api/datasets
```

返回：

```json
{
  "id": "uuid",
  "status": "draft",
  "name": "数据集名称",
  "originalRowCount": 1000,
  "storedRowCount": 1000,
  "columns": [],
  "quality": {}
}
```

### 17.2 获取预检详情

```text
GET /api/datasets/{id}?mode=preview
```

返回：

- metadata；
- quality；
- columns；
- 前 20 行；
- config。

### 17.3 更新字段配置

```text
PUT /api/datasets/{id}/config
```

请求：

```json
{
  "columns": [],
  "analysisConfig": {}
}
```

服务端必须重新校验，不得直接信任前端类型断言。

### 17.4 确认数据集

```text
POST /api/datasets/{id}/confirm
```

将状态从 `draft` 变为 `ready`。

### 17.5 执行分析

```text
POST /api/analyze
```

SSE 事件：

```text
event: phase
data: {"phase":"profiling"}

event: result
data: {"analysis":{...}}

event: token
data: {"text":"..."}

event: done
data: {"provider":"local+llm","createdAt":"..."}

event: warning
data: {"message":"LLM 解读超时，已保留本地分析"}

event: error
data: {"message":"..."}
```

`result` 必须在 LLM 请求前发送。

### 17.6 导出 Markdown

P1：

```text
GET /api/datasets/{id}/export/markdown
```

返回 `text/markdown` 下载文件。

---

## 18. 前端组件建议

新增：

```text
components/
  DataQualitySummary.tsx
  FieldConfigTable.tsx
  FieldRoleSelect.tsx
  FieldFormatSelect.tsx
  EvidenceDrawer.tsx
  AnalysisPhase.tsx
  DatasetMetaBar.tsx
  DataWarningBanner.tsx
```

修改：

```text
components/Uploader.tsx
components/DatasetList.tsx
components/ChartCard.tsx
components/InsightPanel.tsx
app/dashboard/[id]/page.tsx
app/settings/page.tsx
```

要求：

- 不在单个页面文件中堆积全部逻辑；
- 字段配置表可横向滚动；
- 小屏时允许卡片式字段配置；
- 保持现有 CSS 变量和主题体系；
- 不引入新的 UI 组件库。

---

## 19. 错误处理

### 19.1 用户错误

使用明确中文：

- 文件为空；
- 未解析到数据；
- 字段配置不合法；
- 找不到时间字段；
- 数字字段包含大量非数值内容；
- 数据集不存在；
- 文件已损坏。

### 19.2 系统错误

前端只显示 requestId 和简洁说明：

```text
分析失败，请重试。请求编号：xxxx
```

详细堆栈仅写日志。

### 19.3 局部容错

- 一张图生成失败，不影响其他图；
- 一条洞察失败，不影响整个结果；
- LLM 失败，不影响本地分析；
- PNG 导出失败，不影响图表浏览；
- 损坏数据集文件不影响列表中其他数据集。

---

## 20. 测试规格

### 20.1 测试技术

推荐：

- Vitest；
- React Testing Library；
- 不强制增加 Playwright，P1 再考虑。

### 20.2 P0 单元测试

必须覆盖：

#### parse

- CSV 正常解析；
- Excel 正常解析；
- 空文件；
- `__EMPTY_*` 过滤；
- 重复列名；
- 千分位数字；
- 百分比；
- 金额；
- 中文日期；
- 混合类型；
- 超过最大行数。

#### statistics

- sum / avg / min / max；
- median / quartile；
- 空值；
- 字符串数字；
- 百分比；
- 分母为 0；
- IQR 异常值。

#### chart

- line 日期排序；
- percentage 默认 avg；
- 高基数 Top 10；
- pie 超过 6 类降级为 bar；
- 缺失字段被拒绝；
- 非法 agg 被拒绝。

#### storage

- UUID 校验；
- 原子写入；
- 损坏文件跳过；
- 旧格式迁移；
- 列表不加载 rows。

#### LLM

- 超时回退；
- `<think>` 过滤；
- JSON 围栏；
- LLM 失败仍返回本地结果；
- API Key 不出现在日志。

### 20.3 集成测试

至少验证：

1. 上传示例 CSV；
2. 返回 draft；
3. 获取预检信息；
4. 修改字段角色；
5. confirm；
6. analyze；
7. 首先收到 local result；
8. 最终收到 done；
9. 再次打开看板读取缓存；
10. 删除数据集。

### 20.4 测试数据

新增：

```text
fixtures/
  operations-basic.csv
  operations-percent.csv
  mixed-types.csv
  dates-unsorted.csv
  duplicate-columns.xlsx
  large-sample.csv
```

测试数据不得包含真实客户或个人信息。

---

## 21. CI 规格

新增：

```text
.github/workflows/ci.yml
```

触发：

- push 到 main；
- pull_request。

步骤：

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

若当前 `next lint` 在 Next.js 版本中不可用，可改用 ESLint 独立命令；不得保留一个无法执行的 lint script。

`package.json` 增加：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "npm run typecheck && npm run test && npm run build"
  }
}
```

---

## 22. 性能要求

在普通个人 Windows 电脑上，目标为：

- 1 万行、20 列 CSV 预检：5 秒以内；
- 5 万行、20 列本地分析：10 秒以内；
- 首页 50 个数据集列表：1 秒左右返回；
- 图表数量默认不超过 8；
- 不把完整 rows 返回给看板前端；
- 数据预览最多返回 20～100 行；
- 图表 Option 不包含不必要的明细数据；
- LLM 输入控制在合理长度，不发送原始全表。

若达不到目标，应优先优化数据遍历次数，避免每个指标重复扫描完整 rows。

建议一次扫描构建列统计缓存，而不是每个函数分别遍历。

---

## 23. 可访问性与易用性

最低要求：

- 所有按钮有明确文本或 aria-label；
- 字段选择器可用键盘操作；
- loading 状态使用 `aria-live`；
- 错误信息可被屏幕阅读器识别；
- 颜色不是唯一状态表达方式；
- 图表应有标题和简短文字说明；
- PNG 导出按钮继续显示状态；
- 表格列名固定或可横向滚动。

---

## 24. 文档更新

Agent 完成代码后必须同步更新：

### README.md

增加：

- 项目明确为个人本地工具；
- 新导入流程；
- 数据预检说明；
- 本地分析与 LLM 分工；
- API Key 明文存储说明；
- 仅监听 localhost；
- 数据目录说明；
- 测试和构建命令；
- 已知限制。

### ARCHITECTURE.md

新增：

- 数据流；
- 分析流程；
- 模块职责；
- 数据模型；
- 存储结构；
- LLM 边界；
- 回退机制。

### CHANGELOG.md

新增 v0.2.0 变更。

---

## 25. Agent 实施顺序

Agent 必须按以下顺序执行，避免同时大规模改动导致不可验证。

### 阶段 A：建立安全重构基础

1. 新建分支；
2. 执行现有 typecheck 和 build；
3. 记录基线；
4. 加入 Vitest；
5. 为现有 parse、chart、store 编写基础测试；
6. 修复 dataset ID 校验；
7. 加入 LLM timeout；
8. 修复 shutdown 无 sessionId 即退出的问题；
9. 将 Windows 启动绑定到 127.0.0.1。

### 阶段 B：数据模型和存储

1. 扩展 types；
2. 新增 schema；
3. 实现原子 JSON 写入；
4. 拆分 metadata 与 rows；
5. 实现旧数据迁移；
6. 保证旧数据集能打开；
7. 完成存储测试。

### 阶段 C：解析与质量报告

1. 重写采样策略；
2. 增加数字格式解析；
3. 增加日期标准化；
4. 增加列名清理；
5. 生成 DataQualityReport；
6. 完成 fixture 和测试。

### 阶段 D：预检 UI

1. 上传生成 draft；
2. 新增预检路由；
3. 新增字段配置表；
4. 服务端校验字段配置；
5. confirm 后进入 dashboard；
6. 保证上传体验流畅。

### 阶段 E：确定性分析引擎

1. 拆分 analysis 模块；
2. 实现基础统计；
3. 实现趋势；
4. 实现分组对比；
5. 实现状态分析；
6. 实现 IQR 异常值；
7. 生成 evidence；
8. 生成本地洞察。

### 阶段 F：图表引擎

1. 本地推荐 ChartSpec；
2. Zod 校验；
3. 语义校验；
4. Top N；
5. 日期排序；
6. percentage 聚合规则；
7. 图表局部容错。

### 阶段 G：LLM 改造

1. LLM 不再返回字段映射；
2. 输入本地 evidence；
3. 只返回总结、解读、建议；
4. 保留流式输出；
5. 验证失败回退；
6. 更新 provider 命名。

### 阶段 H：看板和收尾

1. 分析阶段状态；
2. evidence 展示；
3. 数据警告；
4. 数据集列表错误反馈；
5. README、ARCHITECTURE、CHANGELOG；
6. CI；
7. 完整冒烟测试。

每个阶段完成后必须执行：

```bash
npm run typecheck
npm run test
npm run build
```

不得等到全部完成后再统一验证。

---

## 26. 禁止事项

Agent 不得：

- 引入数据库；
- 引入登录系统；
- 删除 Mock / local 分析；
- 把完整原始数据发送给 LLM；
- 让 LLM 直接计算关键指标；
- 让 LLM 决定不存在的字段；
- 将所有逻辑继续堆进 `analyzer.ts`；
- 为了重构而重写全部 UI；
- 删除现有主题；
- 删除 PNG 复制和下载；
- 删除 Windows 启动脚本；
- 在日志中输出 API Key；
- 无迁移方案地修改数据格式；
- 静默吞掉关键错误；
- 使用 `any` 绕过核心数据类型；
- 仅修改 README 而不实现验收功能；
- 在没有测试的情况下修改日期和聚合逻辑。

---

## 27. 验收标准

### 27.1 功能验收

- [ ] Excel 和 CSV 均可导入；
- [ ] 上传后进入数据预检；
- [ ] 显示原始行数和实际存储行数；
- [ ] 显示数据质量报告；
- [ ] 用户可修改字段角色、格式和聚合；
- [ ] 日期按真实时间排序；
- [ ] 百分比不会错误求和；
- [ ] 标识符不会被当作普通指标；
- [ ] 本地分析无需 API Key；
- [ ] LLM 失败不影响图表；
- [ ] 每条洞察可查看计算依据；
- [ ] 图表复制和下载继续可用；
- [ ] 四套主题继续可用；
- [ ] 旧数据集可自动迁移或兼容打开；
- [ ] 数据集删除失败会提示；
- [ ] 关闭一个未知 session 不会关闭服务。

### 27.2 代码验收

- [ ] `npm run typecheck` 通过；
- [ ] `npm run test` 通过；
- [ ] `npm run build` 通过；
- [ ] CI 通过；
- [ ] 核心模块无明显重复扫描；
- [ ] 所有 Dataset ID 入口使用统一 Schema；
- [ ] 所有持久化写入为原子写入；
- [ ] 所有 LLM 请求有 timeout；
- [ ] ChartSpec 通过 Zod 和语义双重校验；
- [ ] 无 API Key 日志泄漏。

### 27.3 体验验收

- [ ] 普通用户无需理解统计术语即可完成流程；
- [ ] 字段推断错误时可以轻松修正；
- [ ] 本地结果先于 LLM 解读出现；
- [ ] 数据截断时有明显提醒；
- [ ] 分析错误不会清空已有结果；
- [ ] 页面无长期卡死的“分析中”状态；
- [ ] 主要按钮和错误信息清晰。

---

## 28. 推荐最终目录

```text
app/
  api/
    datasets/
      route.ts
      [id]/
        route.ts
        config/route.ts
        confirm/route.ts
        export/markdown/route.ts
    analyze/route.ts
    settings/route.ts
    heartbeat/route.ts
    shutdown/route.ts
  import/[id]/page.tsx
  dashboard/[id]/page.tsx
  settings/page.tsx
  page.tsx

components/
  Uploader.tsx
  DatasetList.tsx
  DataQualitySummary.tsx
  FieldConfigTable.tsx
  FieldRoleSelect.tsx
  FieldFormatSelect.tsx
  DatasetMetaBar.tsx
  DataWarningBanner.tsx
  AnalysisPhase.tsx
  InsightPanel.tsx
  EvidenceDrawer.tsx
  ChartCard.tsx
  DataTable.tsx

lib/
  analysis/
    profile.ts
    quality.ts
    statistics.ts
    trends.ts
    comparisons.ts
    outliers.ts
    recommend-charts.ts
    evidence.ts
    index.ts
  schemas/
    dataset.ts
    chart.ts
    settings.ts
  parse.ts
  normalize.ts
  chart.ts
  llm.ts
  store.ts
  settings.ts
  logger.ts
  errors.ts
  respond.ts
  api-client.ts
  types.ts

fixtures/
tests/
.github/workflows/ci.yml
ARCHITECTURE.md
CHANGELOG.md
README.md
```

---

## 29. 最终交付要求

Agent 完成改造后应提交：

1. 完整源代码；
2. 自动迁移逻辑；
3. 单元和集成测试；
4. CI 工作流；
5. 更新后的 README；
6. `ARCHITECTURE.md`；
7. `CHANGELOG.md`；
8. 一份冒烟测试记录，至少包含：
   - Mock / local 模式；
   - 真实 LLM 模式；
   - 百分比数据；
   - 日期乱序数据；
   - 混合类型数据；
   - 超限截断数据；
   - PNG 导出；
   - Windows 一键启动；
   - WebUI 自动关闭。

不得仅以“代码已生成”作为交付完成标志，必须提供命令执行结果和验收清单。

---

## 30. 版本完成定义

只有同时满足以下条件，才可将版本标记为 `v0.2.0`：

- 数据预检可用；
- 字段可校正；
- 本地分析结果可追溯；
- 图表规格经过严格校验；
- LLM 仅做解释；
- 旧数据兼容；
- 全部测试和构建通过；
- Windows 本地使用流程验证通过；
- README 与实际行为一致。

本版本的最终判断标准不是功能数量，而是：

> 导入的数据是否被正确理解，图表中的数值是否可信，用户是否能清楚知道每条结论从哪里得出。
