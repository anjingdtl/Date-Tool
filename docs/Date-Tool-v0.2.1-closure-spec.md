# Date-Tool v0.2.1 收尾改造规格说明书

> 文档类型：收尾工程 Spec  
> 目标读者：负责继续实施改造的 AI 编程 Agent / 开发者  
> 项目仓库：`anjingdtl/Date-Tool`  
> 基线版本：`v0.2.0`  
> 目标版本：`v0.2.1`  
> 产品定位：个人、本地优先的数据分析与辅助图表工具  
> 版本目标：修复行为闭环与数据一致性问题，不扩大产品范围  
> 最后更新：2026-07-15

---

## 1. 本次改造背景

Date-Tool v0.2.0 已完成以下核心建设：

- 数据导入预检；
- 字段类型、角色、格式和聚合方式编辑；
- 本地确定性分析引擎；
- Evidence 计算依据；
- 图表本地推荐与校验；
- LLM 仅做解读；
- 文件存储拆分与原子写入；
- Dataset ID 校验；
- LLM 超时；
- Windows 本地启动与自动关闭；
- Vitest、CI、README、ARCHITECTURE 和 CHANGELOG。

当前主要问题不再是缺少大功能，而是部分功能“界面已经存在，但运行时行为尚未完全闭环”。

本版本的目标是完成一次小范围、可验证的收尾修复，使以下承诺真正成立：

1. 设置页面配置的 LLM 能实际启用；
2. 用户修改字段类型后，数据会按照新类型重新规范化；
3. 用户选择的聚合方式会真实影响分析和图表；
4. LLM 最终总结、行动建议和图表标题会立即出现在当前页面；
5. 字段推断和质量报告更加准确；
6. 数据集状态机与分析流程一致；
7. 关键链路有真实测试覆盖。

---

## 2. 产品目标

本版本完成后，Date-Tool 应满足：

> 用户导入数据、修正字段、选择聚合方式并生成看板后，页面中展示的数值、趋势、分组结果、洞察和 LLM 解读，全部严格基于用户确认后的最终字段配置。

### 2.1 本版本成功标准

- 设置页保存 API Key 后，无需重启即可进入 `local+llm`；
- 用户将 `"1,234"` 类型从文本改为数字后，分析值为 `1234`；
- 用户将“响应时长”聚合设为 `avg` 后，趋势、对比、图表和 evidence 均使用 `avg`；
- LLM 完成后，当前页面立即更新最终 summary、actions 和图表标题；
- 类型推断采样不会只依赖前 500 行；
- `MIXED_TYPE` 和 `INVALID_DATE` 警告可以真实产生；
- draft 数据集不能绕过预检直接分析；
- CI 可以覆盖上述核心行为。

---

## 3. 非目标

本版本不新增：

- 登录和用户体系；
- 多用户；
- 数据库；
- 云部署；
- 企业微信 API 接入；
- 拖拽式图表编辑器；
- 自定义公式语言；
- 多轮对话；
- PDF 报告；
- Excel 导出；
- 新图表类型；
- 新主题；
- 多工作表选择；
- 回收站；
- 数据集重命名；
- 移动端适配；
- 复杂性能优化。

除非为修复本 Spec 中的问题所必需，不得扩大改造范围。

---

## 4. 改造原则

### 4.1 只做闭环修复

不得再次大规模重写架构。优先复用：

- `lib/normalize.ts`
- `lib/settings.ts`
- `lib/analysis/*`
- `lib/analyzer.ts`
- `lib/store.ts`
- 现有 SSE 协议
- 现有预检页和看板页

### 4.2 单一事实来源

以下信息必须只有一个权威来源：

- 当前 LLM 是否启用；
- 当前有效 LLM 配置；
- 字段最终类型；
- 字段最终聚合；
- 数据集状态；
- 最终分析结果。

不得同时由 `config.ts`、`settings.ts`、前端状态各自推断同一事实。

### 4.3 用户配置优先

用户在预检页做出的修改必须覆盖自动推断：

- 类型；
- 角色；
- 格式；
- 聚合方式；
- 是否参与分析。

### 4.4 本地结果优先

LLM 失败、超时或输出无效时：

- 本地图表保留；
- 本地洞察保留；
- Evidence 保留；
- 页面不回退到空状态；
- provider 为 `local`。

---

## 5. 优先级

### P0：必须完成

1. 统一运行时 LLM 配置；
2. 字段配置修改后重新规范化 rows；
3. 用户聚合方式全链路生效；
4. 增加最终 SSE 结果事件；
5. 修复字段采样逻辑；
6. 实现 MIXED_TYPE 和 INVALID_DATE；
7. 补全数据集状态机；
8. 增加真实关键链路测试；
9. 修复旧数据迁移半成品目录问题；
10. 删除仓库根目录 `clound` 文件。

### P1：建议完成

1. 设置 API 接入 Zod；
2. 去除数据集详情重复读取；
3. Evidence 与单条洞察直接关联展示；
4. 统一旧 provider 类型；
5. 清理 README 中过时的 Mock 表述；
6. 为分析接口增加 requestId 前端显示。

### P2：不在本版本强制范围

1. 真实浏览器 E2E；
2. Playwright；
3. 软删除；
4. 完整性能基准；
5. 分析模板。

---

# 6. 改造任务 A：统一运行时 LLM 配置

## 6.1 当前问题

当前存在两套配置来源：

- `lib/config.ts` 读取环境变量；
- `lib/settings.ts` 读取 `.data/settings.json` 并回退环境变量。

LLM 客户端会读取 `settings`，但分析器判断是否启用 LLM 时仍依赖 `config.llm.enabled`。

这会导致：

- 设置页 API Key 已保存；
- 测试连接成功；
- 分析器仍判断 LLM 未启用；
- 实际只执行 `local`。

## 6.2 目标设计

新增统一入口：

```ts
export interface ActiveLLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export async function getActiveLLMConfig(): Promise<ActiveLLMConfig>
```

建议放置：

```text
lib/llm-config.ts
```

或直接由 `lib/settings.ts` 导出。

## 6.3 规则

配置优先级：

```text
settings.json 中非空值
  ↓
环境变量
  ↓
默认值
```

`enabled` 必须根据最终生效的 `apiKey` 计算：

```ts
enabled = apiKey.trim().length > 0
```

不得使用持久化文件中的旧 `enabled` 作为事实来源。

## 6.4 修改范围

必须修改：

- `lib/analyzer.ts`
- `lib/llm.ts`
- `app/api/settings/route.ts`
- `lib/settings.ts`
- 相关测试

`analyzer.ts` 不得再使用：

```ts
config.llm.enabled
```

应改为：

```ts
const llmConfig = await getActiveLLMConfig();

if (!llmConfig.enabled) {
  // local
}
```

`chatJSON()` 和测试连接也应使用同一个配置解析入口。

## 6.5 设置保存热更新

保存设置后：

- 下一次分析立即使用新配置；
- 不要求重启；
- 不允许模块级静态缓存导致旧配置继续生效；
- mtime 缓存可以保留，但写入后必须失效。

## 6.6 测试

必须新增：

### Case A

```text
env 无 API Key
settings.json 有 API Key
期望：分析进入 LLM 分支
```

### Case B

```text
env 有 API Key
settings.json API Key 为空
期望：使用 env Key
```

### Case C

```text
settings 保存新模型名
下一次分析使用新模型名
```

### Case D

```text
设置页清空 API Key
下一次分析 provider=local
```

---

# 7. 改造任务 B：字段修改后重新规范化 rows

## 7.1 当前问题

预检页允许用户修改字段类型和格式，但存储层只更新 `columns`，不重新转换 `rows`。

这会导致用户修正无实际效果。

示例：

```text
原始值："1,234"
自动推断：string
用户修改：number + currency
当前 rows：仍为 "1,234"
分析结果：Number("1,234") 为 NaN
```

## 7.2 目标设计

将行规范化逻辑从 `parse.ts` 提取为可复用函数。

建议新增：

```ts
export interface NormalizeRowsResult {
  rows: DatasetRow[];
  invalidNumberCounts: Record<string, number>;
  invalidDateCounts: Record<string, number>;
  changedValueCounts: Record<string, number>;
}

export function normalizeRowsByColumns(
  rows: DatasetRow[],
  columns: ColumnMeta[],
): NormalizeRowsResult
```

放置：

```text
lib/normalize.ts
```

## 7.3 规范化规则

### number

使用 `parseNumberValue()`：

- 数字原样保留；
- 千分位转数字；
- 百分比转 0～1；
- 金额去符号；
- 无法转换设为 `null`；
- 记录 invalidNumberCounts。

### date

使用 `parseDateValue()`：

- 合法日期转 ISO；
- 无法转换设为 `null`；
- 记录 invalidDateCounts。

### boolean

支持：

```text
true / false
TRUE / FALSE
是 / 否
1 / 0
```

无法转换时保留原值或设为 null，需统一规则并写测试。

### string

原始值转字符串时：

- null 继续为 null；
- 数字可转字符串；
- 不得丢失前导零标识字段。

### ignored

不需要转换，但保留原值。

## 7.4 执行时机

推荐在 `confirm` 时执行：

```text
保存最终字段配置
  ↓
按最终 columns 重新规范化 rows
  ↓
重新计算字段统计
  ↓
重新生成 DataQualityReport
  ↓
原子保存 rows + meta
  ↓
status = ready
```

不推荐每次分析时临时规范化，因为：

- 预检页后的数据应成为稳定快照；
- 避免每次分析重复转换；
- Evidence 应基于最终持久化数据。

## 7.5 元数据重新计算

重新规范化后，必须更新：

- `nullCount`
- `nullRate`
- `distinctCount`
- `sampleValues`
- `nullable`
- `confidence` 可保留用户确认前值
- `userModified`

不得让 `columns` 中的质量统计仍对应旧 rows。

## 7.6 质量报告重算

重新生成：

- HIGH_NULL_RATE
- EMPTY_COLUMN
- INVALID_DATE
- MIXED_TYPE
- DUPLICATE_ROWS
- HIGH_CARDINALITY
- POSSIBLE_IDENTIFIER
- TRUNCATED

## 7.7 测试

必须新增：

### Case A

```text
"1,234" string → 用户改 number
期望 rows 值为 1234
```

### Case B

```text
"65%" → percentage
期望 rows 值为 0.65
```

### Case C

```text
"2026/7/1" → date
期望 rows 值为 2026-07-01
```

### Case D

```text
非法日期 2026-02-31
期望 null + INVALID_DATE
```

### Case E

```text
标识字段 "00123" 保持 string
期望前导零不丢失
```

---

# 8. 改造任务 C：用户聚合方式全链路生效

## 8.1 当前问题

UI 支持：

- sum
- avg
- count
- max
- min

但趋势、分组和图表推荐主要只根据格式选择：

```text
percentage → avg
其他 → sum
```

用户设置没有成为最终聚合来源。

## 8.2 统一聚合解析函数

新增：

```ts
export function resolveAggregation(
  column: ColumnMeta,
  context: "summary" | "trend" | "group" | "chart",
): Aggregation
```

建议放置：

```text
lib/analysis/aggregation.ts
```

## 8.3 优先级

```text
用户明确设置 defaultAggregation
  ↓
字段格式默认规则
  ↓
类型默认规则
```

默认规则：

| 字段 | 默认聚合 |
|---|---|
| percentage | avg |
| currency | sum |
| integer | sum |
| decimal | sum |
| duration | avg |
| identifier | count |
| status | count |
| dimension | count |

## 8.4 全模块统一使用

必须修改：

- `lib/analysis/statistics.ts`
- `lib/analysis/trends.ts`
- `lib/analysis/comparisons.ts`
- `lib/analysis/recommend-charts.ts`
- `lib/chart.ts`
- `lib/analysis/evidence.ts`

不得各模块单独复制聚合选择规则。

## 8.5 聚合实现

### sum

```text
所有有效数值求和
```

### avg

```text
所有有效数值平均
```

### count

定义必须明确：

- 默认统计非空值数量；
- 对 `__count__` 统计行数；
- 不应要求 yField 为数值；
- Evidence 中明确是“有效值计数”还是“记录数”。

### max / min

返回有效数值最大/最小。

## 8.6 趋势

趋势模块应允许：

```ts
agg: Aggregation
```

但对不适合的组合进行限制：

- percentage + sum 阻断；
- identifier + avg/sum 阻断；
- string + max/min 不允许；
- count 可用于任意字段的非空计数。

## 8.7 图表

`ChartSpec.agg` 必须来自最终解析后的聚合。

图表标题和说明应反映聚合：

```text
各区域平均响应时长
各客户累计金额
每日有效记录数
```

## 8.8 Evidence

Evidence 必须包含：

```json
{
  "agg": "avg"
}
```

不得出现图表使用 avg，但 evidence 写 sum 的不一致。

## 8.9 测试

必须新增：

- 响应时长 avg；
- 金额 sum；
- 客户 count；
- 满意度 max；
- duration 默认 avg；
- percentage sum 被拒绝；
- 图表值与 Evidence 值一致。

---

# 9. 改造任务 D：增加最终 SSE 结果事件

## 9.1 当前问题

当前 SSE 顺序：

```text
result：本地结果
token：LLM narrative
done：provider + createdAt
```

LLM 最终返回的：

- summary
- actions
- renamedChartTitles
- final options

不会立即更新当前页面。

## 9.2 新 SSE 协议

调整为：

```text
event: stage
data: {"stage":"正在计算本地分析"}

event: result
data: {
  "phase":"local",
  "analysis": {...}
}

event: stage
data: {"stage":"正在生成 LLM 解读"}

event: token
data: {"text":"..."}

event: final
data: {
  "summary":"...",
  "insights":[],
  "charts":[],
  "options":[],
  "provider":"local+llm",
  "createdAt":"..."
}

event: done
data: {
  "provider":"local+llm",
  "createdAt":"..."
}
```

## 9.3 行为

### local 模式

可以：

- 发送 `result`
- 发送本地 narrative token
- 发送 `final`
- 发送 `done`

或者 local 模式的 `result` 即最终结果，但推荐协议统一。

### local+llm 模式

必须在 LLM 结果完成后发送 `final`。

## 9.4 前端更新

`api-client.ts` 新增：

```ts
onFinal?: (analysis: FinalAnalysisPayload) => void
```

`dashboard` 收到 final 后更新：

- summary
- insights
- charts
- options
- provider
- createdAt

不得只更新 provider。

## 9.5 narrative

LLM narrative 可以继续用 token 累加。

`final` 中可包含完整 narrative，也可不包含。若包含，前端应以 final 为准，避免丢 token。

## 9.6 测试

必须新增：

- local result 先出现；
- final 后 summary 被替换；
- actions 出现在 insights；
- renamedChartTitles 立即生效；
- final options 与 charts 对应；
- LLM 失败时 final 仍为 local；
- token 丢失时 final narrative 可恢复。

---

# 10. 改造任务 E：修复字段采样与类型推断

## 10.1 当前问题

当前逻辑仍主要检查头部前 500 行，并且类型命中率分母可能使用全表非空数量，导致置信度失真。

## 10.2 均匀采样

新增：

```ts
export function sampleRowIndices(
  rowCount: number,
  maxSamples = 500,
): number[]
```

规则：

### rowCount <= 500

全量。

### rowCount > 500

均匀覆盖：

- 头部；
- 中部；
- 尾部；
- 整体等距采样。

建议：

```ts
index = Math.floor(i * (rowCount - 1) / (maxSamples - 1))
```

去重后使用。

## 10.3 类型统计

对采样到的非空值计算：

```ts
typeCounts = {
  number: 0,
  date: 0,
  boolean: 0,
  string: 0
}
```

分母必须是：

```ts
sampleNonNullCount
```

不得使用全表 nonNull。

## 10.4 类型判定

建议规则：

- boolean >= 0.9 → boolean
- date >= 0.8 → date
- number >= 0.8 → number
- 其余 → string

同时记录：

```ts
typeDistribution
```

## 10.5 confidence

定义为最终类型在样本中的占比：

```ts
confidence = selectedTypeCount / sampleNonNullCount
```

空列 confidence = 0。

## 10.6 测试

- 前 500 行为空，后面为数字；
- 头部文本，尾部数字；
- 80% 数字 + 20% 文本；
- 50% 日期 + 50% 文本；
- 10 万行采样索引覆盖尾部；
- 空列；
- 单行数据。

---

# 11. 改造任务 F：实现真实 MIXED_TYPE 与 INVALID_DATE

## 11.1 MIXED_TYPE

新增判断：

```text
第二大类型占非空样本比例 >= 10%
```

或：

```text
主类型置信度 < 90% 且非空样本 >= 5
```

生成：

```ts
{
  code: "MIXED_TYPE",
  level: "warning",
  field,
  message: "字段「X」包含数字与文本混合值..."
}
```

MIXED_TYPE 不应依赖最终推断类型是否为 string。

## 11.2 INVALID_DATE

当字段最终类型为 date 或 format 为 date/datetime 时：

- 非空原始值无法解析；
- invalidDateCount > 0；

生成：

```ts
{
  code: "INVALID_DATE",
  level: "warning",
  field,
  message: "字段「日期」有 8 个值无法解析，已转为空值。"
}
```

## 11.3 INVALID_NUMBER

当前 Schema 没有该 code。

本版本可二选一：

### 方案 A

新增：

```text
INVALID_NUMBER
```

### 方案 B

用 MIXED_TYPE 表达。

推荐新增 `INVALID_NUMBER`，因为用户修正为数字后，无法转换的具体数量很重要。

若新增，需同步：

- types；
- Zod；
- UI；
- README；
- 测试。

## 11.4 日期合法性

不得只判断：

```text
month 1～12
day 1～31
```

必须使用真实日历校验：

```ts
const d = new Date(Date.UTC(y, m - 1, day));

valid =
  d.getUTCFullYear() === y &&
  d.getUTCMonth() === m - 1 &&
  d.getUTCDate() === day
```

`2026-02-31` 必须无效。

## 11.5 日期支持

补充：

- `M/D/YYYY`
- `MM/DD/YYYY`
- datetime 保留时间（当 format=datetime）
- Excel 数字日期序列

Excel 日期序列优先由 SheetJS `cellDates: true` 转 Date；同时提供数字序列兜底。

---

# 12. 改造任务 G：补全数据集状态机

## 12.1 目标状态

```text
draft
  ↓ confirm
ready
  ↓ analyze
analyzing
  ↓ success
completed

analyzing
  ↓ fail
error

completed / error
  ↓ re-analyze
analyzing
```

## 12.2 分析接口校验

`POST /api/analyze`：

允许：

- ready
- completed
- error

拒绝：

- draft
- analyzing

### draft

返回 409：

```text
数据集尚未完成预检确认
```

### analyzing

返回 409：

```text
数据集正在分析，请勿重复提交
```

## 12.3 状态更新

开始分析前：

```ts
await setDatasetStatus(id, "analyzing")
```

成功：

```ts
updateAnalysis() 内设 completed
```

失败：

```ts
await setDatasetStatus(id, "error")
```

## 12.4 并发保护

个人工具不需要复杂锁，但至少应避免双击造成两个分析同时执行。

前端按钮禁用之外，服务端必须检查 `analyzing`。

## 12.5 测试

- draft 分析被拒绝；
- ready 可分析；
- analyzing 重复请求被拒绝；
- 成功变 completed；
- LLM 失败但本地成功仍为 completed；
- 本地分析失败变 error；
- error 可重新分析。

---

# 13. 改造任务 H：修复旧数据迁移半成品问题

## 13.1 当前问题

旧文件迁移过程中：

1. 创建目标目录；
2. 写 meta；
3. 写 rows；
4. 写 analyses；
5. rename 旧文件。

若中途失败，目标目录可能残留。

下一次发现目录已存在，不再执行迁移，数据可能无法读取。

## 13.2 目标方案

使用临时目录：

```text
datasets/{id}.migrating/
```

流程：

1. 读取旧文件；
2. 写临时目录；
3. 验证三个 JSON 可读取；
4. rename 临时目录为最终目录；
5. rename 旧文件为 `.bak`。

失败：

- 删除临时目录；
- 保留旧文件；
- 下次允许重试。

## 13.3 已存在半成品目录

`getDataset()` 检测：

```text
目录存在，但 meta / rows 不完整
```

处理：

- 若 legacy 文件还存在，清理半成品并重试迁移；
- 若只剩 `.bak`，尝试从 bak 恢复；
- 无可恢复源时返回明确错误日志。

## 13.4 测试

模拟：

- 写 meta 后失败；
- 写 rows 后失败；
- 目标目录已存在但无 meta；
- legacy + 半成品同时存在；
- `.bak` 恢复；
- 迁移成功后列表只显示一次。

---

# 14. 改造任务 I：设置 API 接入 Zod

## 14.1 当前问题

已存在 `lib/schemas/settings.ts`，但 API 没有实际使用。

## 14.2 Schema 调整

建议新增更新 Schema：

```ts
export const SettingsUpdateSchema = z.object({
  theme: ThemeSchema.optional(),
  llm: z.object({
    provider: z.string().trim().max(100).optional(),
    baseUrl: z.string().trim().max(500).optional(),
    apiKey: z.string().max(500).optional(),
    model: z.string().trim().max(200).optional(),
  }).optional(),
});
```

## 14.3 Base URL

使用：

```ts
new URL(baseUrl)
```

只允许：

- `http:`
- `https:`

空字符串允许，表示未配置。

## 14.4 API Key

保留：

```text
__KEEP__
```

但应作为 API 协议常量，不得与真实 Key 混淆。

建议：

```ts
export const KEEP_API_KEY_TOKEN = "__KEEP__";
```

## 14.5 清除按钮

设置页增加明确：

```text
清除 API Key
```

不要依赖用户清空输入框猜测操作。

---

# 15. 改造任务 J：移除冗余与仓库清理

## 15.1 删除 `clound`

删除仓库根目录：

```text
clound
```

该文件包含 Agent 内部工作记录，不属于产品代码。

## 15.2 `.gitignore`

增加忽略：

```text
clound
*.agent-memory
.agent/
.trae/
```

只添加确实可能产生的临时文件，避免过度忽略。

## 15.3 provider 类型

逐步删除旧值：

```text
mock
llm
```

目标统一：

```ts
type AnalysisProvider = "local" | "local+llm";
```

修改：

- types；
- api-client；
- dashboard；
- InsightPanel；
- 旧数据迁移兼容。

旧缓存若 provider 为 `mock`：

```text
mock → local
llm → local+llm
```

## 15.4 README

修正所有：

- “Mock 模式”
- “本地 Mock”
- “流式逐字”

若实际 LLM narrative 是单次 JSON 后前端分块，应写：

```text
分段显示
```

不要声称为模型原生流式。

---

# 16. 数据集详情读取优化

## 16.1 当前问题

详情接口：

1. `getDataset()`
2. `getPublicDataset()`
3. `getPublicDataset()` 再次读取数据

## 16.2 修改

从已读取的 `ds` 直接构造公共字段。

新增：

```ts
export function toPublicDataset(
  ds: StoredDataset,
): PublicDataset
```

或导出当前内部 `toPublic()`。

不得为同一请求重复解析 rows。

## 16.3 测试

可以通过 mock `fs.readFile` 次数验证：

- dataset 详情只读取一次 rows；
- list 不读取 rows；
- preview 读取 rows；
- normal detail 读取 rows 仅用于 previewRows 和 analysis。

---

# 17. Evidence 前端收尾

## 17.1 当前实现

当前为统一“查看计算依据”面板。

## 17.2 P1 改进

每条洞察旁增加：

```text
查看依据
```

点击直接展开对应 evidence，而不是让用户在所有 evidence 中寻找。

## 17.3 数据映射

使用：

```ts
computedInsight.evidenceId
```

找到对应 evidence。

## 17.4 保留总面板

可继续保留“查看全部依据”。

---

# 18. 测试建设

## 18.1 原则

本版本不追求继续堆测试数量，而是覆盖真实缺口。

## 18.2 必须新增的测试文件

建议新增：

```text
tests/llm-config.test.ts
tests/reconfigure-normalization.test.ts
tests/aggregation-flow.test.ts
tests/sse-final.test.ts
tests/type-sampling.test.ts
tests/dataset-state.test.ts
tests/migration-recovery.test.ts
```

## 18.3 关键测试矩阵

### LLM

- settings Key 启用；
- env Key 回退；
- 清除 Key；
- 模型热更新；
- LLM 失败回 local。

### 字段修正

- string → number；
- string → date；
- percentage；
- currency；
- identifier 前导零；
- 非法值警告。

### 聚合

- sum；
- avg；
- count；
- min；
- max；
- duration 默认 avg；
- evidence 一致；
- chart option 一致。

### SSE

- local result；
- token；
- final；
- done；
- final 标题更新；
- actions 更新；
- LLM fail final local。

### 采样

- 头部空值；
- 尾部数字；
- 均匀采样；
- mixed type；
- 空列；
- 大数据。

### 状态机

- draft；
- ready；
- analyzing；
- completed；
- error；
- retry。

### 迁移

- 中途失败；
- 半成品目录；
- bak 恢复。

---

# 19. HTTP 集成测试

## 19.1 最低要求

当前 smoke test 主要直接调用模块。

本版本至少增加路由函数级集成测试：

1. 上传；
2. 预检；
3. 更新配置；
4. confirm；
5. analyze；
6. 解析 SSE；
7. 读取缓存。

不强制启动真实 Next.js 服务，但应直接调用 Route Handler，并验证 Response。

## 19.2 完整链路

测试数据：

```csv
日期,客户,金额,响应时长,转化率,状态
2026/7/1,甲,"1,200","12.5","65%",正常
2026/7/2,乙,"2,300","15.0","70%",预警
```

测试操作：

1. 上传；
2. 将响应时长设置 `avg`；
3. 将金额设置 currency + sum；
4. 将转化率设置 percentage + avg；
5. confirm；
6. analyze；
7. SSE 首先收到 local result；
8. 最终收到 final；
9. 重新读取数据集；
10. 缓存结果一致。

---

# 20. CI

现有 CI 保留：

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

建议增加：

```bash
npm run check
```

但不要重复执行两套相同命令。

可调整为：

```yaml
- run: npm ci
- run: npm run check
```

## 20.1 CI 验收

目标 commit 必须有 GitHub Actions 成功记录。

Agent 最终交付必须附：

- workflow URL；
- commit SHA；
- 测试数量；
- build 成功截图或日志摘要。

---

# 21. 性能约束

本次修复不得明显降低性能。

要求：

- 字段确认时只重新规范化一次；
- 分析时不重复规范化；
- 统一聚合函数不得增加重复全表扫描；
- 类型采样最多 500 行；
- 质量报告可全量扫描一次；
- dataset detail 不重复读取 rows；
- migration 不重复解析大文件。

建议将以下步骤合并扫描：

- 空值；
- distinct；
- invalid；
- sample；
- type distribution。

---

# 22. 日志要求

新增或保留以下日志事件：

```text
llm_config_resolved
dataset_reconfigured
dataset_normalized
dataset_confirmed
analysis_started
analysis_completed
analysis_failed
legacy_migration_started
legacy_migration_completed
legacy_migration_failed
```

不得记录：

- API Key；
- 完整原始数据；
- LLM Authorization Header；
- 用户完整文件内容。

可记录：

- datasetId；
- 行列数；
- provider；
- invalid count；
- requestId；
- elapsedMs。

---

# 23. API 变更

## 23.1 analyze

`POST /api/analyze`

新增状态检查。

新增事件：

```text
final
```

## 23.2 confirm

`POST /api/datasets/{id}/confirm`

除状态切换外，还负责：

- 最终字段配置；
- rows 重新规范化；
- 元数据重算；
- quality 重算。

## 23.3 config

`PUT /api/datasets/{id}/config`

仅保存草稿字段配置。

推荐不要在每次 config 保存时立即重写 rows，以免用户多次调整时反复处理大数据。

## 23.4 settings

`PUT /api/settings`

接入 Zod 和 URL 校验。

---

# 24. 推荐新增模块

```text
lib/
  llm-config.ts
  analysis/
    aggregation.ts
  normalize.ts
  quality.ts
```

如果不希望新增文件，也可扩展现有模块，但必须保证：

- LLM 配置只有一个解析入口；
- 聚合规则只有一个解析入口；
- 行规范化可复用；
- quality 可在 parse 和 confirm 阶段重复生成。

---

# 25. 实施顺序

Agent 必须按以下顺序执行。

## 阶段 1：建立基线

1. 拉取最新 main；
2. 新建分支：
   `fix/v0.2.1-closure`
3. 执行：
   ```bash
   npm ci
   npm run typecheck
   npm run test
   npm run build
   ```
4. 记录现有结果；
5. 删除 `clound`。

## 阶段 2：LLM 配置闭环

1. 新增统一配置入口；
2. analyzer 改用运行时配置；
3. llm client 改用统一配置；
4. settings API 接入；
5. 新增测试；
6. 执行三件套。

## 阶段 3：字段重规范化

1. 提取 `normalizeRowsByColumns()`；
2. confirm 时重规范化；
3. 元数据重算；
4. quality 重算；
5. 新增测试；
6. 执行三件套。

## 阶段 4：聚合全链路

1. 新增 aggregation resolver；
2. 修改 trends；
3. 修改 comparisons；
4. 修改 chart recommendation；
5. 修改 chart engine；
6. 修改 evidence；
7. 新增测试；
8. 执行三件套。

## 阶段 5：SSE final

1. 新增 final event；
2. 修改 api-client；
3. 修改 dashboard；
4. 更新缓存一致性；
5. 新增测试；
6. 执行三件套。

## 阶段 6：采样和质量

1. 均匀采样；
2. typeDistribution；
3. MIXED_TYPE；
4. INVALID_DATE；
5. 真实日期校验；
6. 新增测试；
7. 执行三件套。

## 阶段 7：状态机和迁移

1. analyze 状态检查；
2. analyzing / completed / error；
3. 迁移临时目录；
4. 半成品恢复；
5. 新增测试；
6. 执行三件套。

## 阶段 8：清理与文档

1. provider 类型统一；
2. 设置 Schema；
3. dataset detail 优化；
4. README 更新；
5. ARCHITECTURE 更新；
6. CHANGELOG v0.2.1；
7. 完整 check；
8. 提交并推送。

每个阶段完成后必须执行：

```bash
npm run typecheck
npm run test
npm run build
```

不得全部改完后再统一测试。

---

# 26. 禁止事项

Agent 不得：

- 重写整个项目；
- 修改产品定位；
- 引入数据库；
- 引入登录；
- 引入 UI 组件库；
- 删除四套主题；
- 删除 PNG 功能；
- 删除 Windows 启动；
- 发送原始数据给 LLM；
- 让 LLM 决定聚合；
- 忽略用户字段配置；
- 用 `any` 绕过核心类型；
- 只补测试而不修行为；
- 只补文档而不修代码；
- 在分析阶段每次重新解析源文件；
- 让 draft 数据直接分析；
- 将 API Key 写入日志；
- 创建无必要的抽象层；
- 修改无关样式；
- 新增未经要求的业务功能。

---

# 27. 验收清单

## 27.1 LLM

- [ ] 设置页保存 Key 后下一次分析进入 `local+llm`；
- [ ] 不需要重启；
- [ ] env 配置仍可使用；
- [ ] 清除 Key 后回到 `local`；
- [ ] 模型名和 Base URL 热更新；
- [ ] LLM 失败保留本地结果。

## 27.2 字段修正

- [ ] `"1,234"` 修正为 number 后为 `1234`；
- [ ] `"65%"` 修正为 percentage 后为 `0.65`；
- [ ] 日期修正后转 ISO；
- [ ] 非法日期产生 warning；
- [ ] 标识符前导零不丢失；
- [ ] rows 与 columns 配置一致；
- [ ] quality 使用最终 rows 重算。

## 27.3 聚合

- [ ] sum 生效；
- [ ] avg 生效；
- [ ] count 生效；
- [ ] min 生效；
- [ ] max 生效；
- [ ] 图表值正确；
- [ ] evidence 聚合正确；
- [ ] 图表标题反映聚合；
- [ ] percentage sum 仍被阻断。

## 27.4 SSE

- [ ] 本地结果先出现；
- [ ] LLM narrative 可显示；
- [ ] final summary 立即更新；
- [ ] actions 立即更新；
- [ ] 图表标题立即更新；
- [ ] final options 对应 final charts；
- [ ] reload 后缓存一致。

## 27.5 数据质量

- [ ] 均匀采样覆盖尾部；
- [ ] 前 500 行空值不导致错误类型；
- [ ] MIXED_TYPE 可产生；
- [ ] INVALID_DATE 可产生；
- [ ] `2026-02-31` 被拒绝；
- [ ] 截断 warning 保留；
- [ ] 质量报告中文清晰。

## 27.6 状态机

- [ ] draft 不能分析；
- [ ] ready 可以分析；
- [ ] analyzing 防重复；
- [ ] 成功 completed；
- [ ] 失败 error；
- [ ] error 可以重新分析。

## 27.7 存储

- [ ] 旧数据正常迁移；
- [ ] 迁移失败可重试；
- [ ] 半成品目录可恢复；
- [ ] `.bak` 保留；
- [ ] 不重复显示数据集；
- [ ] 所有写入仍为原子写入。

## 27.8 工程

- [ ] `npm run typecheck` 通过；
- [ ] `npm run test` 通过；
- [ ] `npm run build` 通过；
- [ ] GitHub Actions 通过；
- [ ] `clound` 已删除；
- [ ] README 与行为一致；
- [ ] CHANGELOG 包含 v0.2.1；
- [ ] 无 API Key 日志泄漏。

---

# 28. 最终交付内容

Agent 完成后必须提供：

1. 改动摘要；
2. 修改文件列表；
3. 每个 P0 问题的修复说明；
4. 新增测试列表；
5. 测试执行结果；
6. build 执行结果；
7. GitHub Actions 链接；
8. commit SHA；
9. 兼容性说明；
10. 未完成项；
11. 验收清单逐项结果。

不得只回复“已完成”。

---

# 29. 建议提交拆分

推荐提交：

```text
fix: unify runtime llm configuration
fix: renormalize rows after field confirmation
fix: apply user aggregation across analysis pipeline
fix: deliver final llm result through sse
fix: improve sampling and data quality warnings
fix: enforce dataset analysis state transitions
fix: make legacy migration recoverable
chore: clean agent artifacts and update docs
```

避免将所有改动压成一个超大提交。

---

# 30. 版本完成定义

只有满足以下条件，才可发布 `v0.2.1`：

- 设置页 LLM 配置实际生效；
- 字段修正实际改变数据；
- 聚合选择实际改变计算；
- LLM 最终结果即时显示；
- 采样和质量报告准确；
- 状态机真实执行；
- 旧数据迁移可恢复；
- 关键测试覆盖；
- CI 通过；
- 文档与行为一致。

本版本最终判断标准是：

> 用户在预检页做出的每一个关键选择，都必须真实影响最终图表、洞察、Evidence 和 LLM 解读，且当前页面和缓存结果保持一致。
