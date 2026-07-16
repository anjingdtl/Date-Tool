# 变更记录

## v0.3.0 — 2026-07-16

> 从“固定规则计算 + LLM 解读”升级为“LLM 理解/计划/终审 + 本地确定性工具执行 + 用户自然语言修订”的数据分析 Agent。按 [v0.3.0 改造规格](./docs/Date-Tool%20v0.3.0-LLM%20指挥中枢数据分析%20Agent%20改造规格.md) Phase 0→10 实施。

### 新增

- **DataContext 与隐私层**：稳定头中尾/等距/固定种子采样、列统计、token budget、敏感字段识别与一致掩码；单元格提示注入隔离。
- **隐私控制**：设置页可关闭发送行样本；字段样例、代表值、Top 值与采样行统一脱敏，完整 rows SHA-256 防止缓存误命中。
- **数据理解协议**：识别数据集类型、表格结构、行粒度、字段语义、指标行为、字段关系、派生指标和歧义；支持预检页修正与确认。
- **受控 AnalysisPlan**：Zod Schema、字段/聚合/语义/公式/依赖/图表/任务上限校验，LLM JSON 最多修复两次。
- **安全公式 AST**：字段、常量、四则运算、`safe_divide`、`abs`、`round`；禁止动态代码执行。
- **确定性工具注册表**：`profile / aggregate / timeseries / compare / distribution / ranking / ratio / growth / correlation / anomaly / pivot`，每个任务生成 Evidence、输入哈希和结果哈希。
- **数值分布与严格排名**：distribution 支持分类分布和数值等宽分箱；ranking 强制明确聚合、排序指标与 Top/Bottom 方向。
- **任务执行器**：DAG 拓扑执行、并发上限 3、单任务失败隔离、依赖跳过、进程内 LRU 缓存与增量结果复用。
- **LLM 终审**：`approved / revise / needs_user_input`，Evidence 引用校验、图表决策、追加任务与最多两轮自动修订；终审失败保留确定性结果。
- **Session / Revision**：独立持久化当前计划、语义快照、执行结果、终审和最终看板；先写 Revision 再原子激活 Session。
- **自然语言微调**：用户反馈转换为 `AnalysisPlanPatch`；展示修改不重算，任务修改只重算受影响任务及下游依赖；stale/非法 Patch 不激活。
- **Revision 历史、撤销和恢复**：恢复历史内容时创建新 Revision，不删除后续历史。
- **编排 UI**：计划/任务/终审时间线、问题面板、自然语言输入、当前模式与 Revision 历史。
- **显式模式与歧义闭环**：阻塞性歧义可在预检页选择/修正后提交；有 LLM 但理解未确认时阻断默认编排，并提供显式本地分析入口。
- **图表扩展**：area、stacked bar、scatter、heatmap、KPI；table 使用任务结果行而不是原始预览行。
- **新增 API**：Understanding、Session、Feedback、Revision 详情与 Restore；SSE 扩展 plan/task/review/question/revision 事件。
- **清理旧默认链路**：移除仅服务于 v0.2“LLM 只做解读”的 `lib/llm-prompt.ts`，默认入口统一到 v0.3 编排门面。

### 安全与可靠性

- 同路径 JSON 写入进程内串行，临时文件执行 fsync/关闭后 rename。
- Session/Revision ID 进行安全字符校验，阻断路径穿越；默认上限分别为每数据集 5 个 Session、每 Session 20 个 Revision。
- LLM、计划或终审不可用时安全降级；本地新结果标记 `version=v0.3.0`、`analysisMode=rule_fallback`。
- LLM 请求增加输出 token 上限；供应商错误正文不进入日志/客户端；四类 System Prompt 统一隔离字段名、Sheet 名和单元格提示注入。
- 计划校验覆盖 20 类规则，并调用各注册工具参数校验；终审 Evidence 输入包含裁剪后的确定性结果，无 Evidence 的数值 finding 会被拒绝。
- 所有最终 `ComputedInsight` 只保留有效 Evidence 引用；终审循环超限会标记 `approved_with_warnings`。
- Feedback 最长 4000 字符；API Key、完整原始行和敏感原值不进入日志或持久化编排对象。

### 兼容性

- `provider` 继续使用 `local | local+llm`；新增 `analysisMode=rule_fallback | llm_orchestrated`。
- v0.2.1 数据集、analysis 缓存、bar/line/pie/table、四套主题、PNG、SSE 和 Windows 启动方式继续可用。
- 旧数据集读取时不会自动调用 LLM；首次 v0.3 编排时创建新 Session。

### 测试

- 新增 DataContext、敏感掩码、提示注入、Understanding、Plan、公式、工具注册表、各执行器、Review、Orchestrator、Route/SSE、Feedback、影响分析、Revision 存储/恢复和 v0.2.1 兼容测试。
- 发布质量门：`npm run check`（strict typecheck + 全量 Vitest + production build）。

## v0.2.1 — 2026-07-15

> 行为闭环与数据一致性收尾：让用户在预检页的每一个关键选择都真实影响最终图表、洞察、Evidence 与 LLM 解读。严格按 [v0.2.1 收尾规格](./docs/Date-Tool-v0.2.1-closure-spec.md) 第 25 节阶段 1→8 实施。

### 新增

- **运行时 LLM 配置**（`lib/llm-config.ts`）：设置页保存 API Key / 模型 / Base URL 后无需重启即生效；`enabled` 以最终 `apiKey` 计算，不再沿用持久化旧值。
- **字段确认后重规范化**：confirm 按最终类型/格式重新规范化 rows、重算字段统计与质量报告（`normalizeRowsByColumns` / `recomputeColumnStats` / `generateDataQuality`，parse 与 confirm 共用）。
- **聚合方式全链路**（`lib/analysis/aggregation.ts`）：`resolveAggregation` 统一解析用户聚合（sum/avg/count/min/max），贯穿趋势/分组/图表/证据；拦截 percentage+sum、identifier+avg/sum 等非法组合。
- **SSE final 事件**：LLM/local 完成后一次性下发最终 summary / 图表标题 / 行动建议，前端整体刷新，避免只更新 provider。
- **均匀采样与类型分布**：采样覆盖头/中/尾，`confidence` 分母改为 `sampleNonNullCount`，新增 `typeDistribution` 让 MIXED_TYPE 真实判断。
- **INVALID_DATE / INVALID_NUMBER 警告**；真实日历校验（拒绝 `2026-02-31`）；日期支持 `M/D/YYYY`、`MM/DD/YYYY`。
- **数据集状态机**：`/api/analyze` 校验状态，draft/analyzing 返回 409，分析前置 analyzing、成功 completed、失败 error。
- **迁移可恢复**：旧数据迁移改用临时目录 `datasets/{id}.migrating/` + 半成品/`.bak` 恢复，失败可重试。
- **设置 API 接 Zod + Base URL 协议校验 + `KEEP_API_KEY_TOKEN` + 清除 API Key 按钮**。

### 变更

- `provider` 统一为 `local | local+llm`，旧 `mock/llm` 读取时迁移。
- `pickTrendAgg / pickComparisonAgg / pickAgg` 降级为 `resolveAggregation` 的兼容薄包装。
- dataset 详情用 `toPublicDataset` 避免重复读盘。
- 删除仓库根 `clound`（Agent 临时产物），`.gitignore` 补充忽略。
- vitest `fileParallelism=false`，消除共享 DATA_DIR 的并行文件系统竞态。
- README 去除「Mock 模式 / 流式逐字」等过时表述。

### 测试

- 新增 `llm-config / reconfigure-normalization / aggregation-flow / sse-final / type-sampling / dataset-state / migration-recovery` 7 个测试文件，测试总数 218 → 288。

### 兼容性

- 旧数据集正常迁移；旧 `mock/llm` provider 自动迁移为 `local/local+llm`。
- 四套主题、PNG 复制下载、Windows 一键启动、SSE 流式全部保留。
- 不依赖 LLM 仍可完成完整分析流程。

---

## v0.2.0 — 2026-07-15

> 本次改造围绕「数据识别更准确、图表生成更符合用户意图、分析结论有明确计算依据、本地使用更稳定」四项能力展开。严格按 [v0.2 改造规格](./docs/Date-Tool-v0.2-optimization-spec.md) 第 25 节阶段 A→H 顺序实施。

### 新增

- **数据导入预检页**（`/import/[draftId]`）：上传后进入预检，显示文件摘要、数据质量概览、字段配置表、前 20 行预览，用户可校正字段类型 / 角色 / 格式 / 聚合方式后再生成看板。
- **字段配置校正**：`PUT /api/datasets/{id}/config`，含 SPEC 9.7 六条服务端校验（至少一个分析字段、metric 必须可数值化、time 最多一个、percentage 不 sum、identifier 不 sum/avg、字段名唯一）。
- **数据集状态机**：`draft → ready → analyzing → completed/error`，`POST /confirm` 完成 draft→ready。
- **数据质量报告**：原始行数 / 存储行数 / 重复行 / 空行 / 9 类警告码，截断数据明确标注。
- **确定性分析引擎**（`lib/analysis/`）：8 个子模块完成基础统计、维度统计、时间趋势、分组对比、状态分析、IQR 异常值、evidence 构造、图表推荐与语义校验。所有关键数值由代码计算。
- **可追溯证据**：每条 `ComputedInsight` 引用 `evidenceId`，前端可展开查看方法 / 样本数 / 字段 / 计算结果。
- **LLM 改造**：`lib/llm-prompt.ts` 构造不含原始数据的结构化输入 + 7 条 System Prompt 约束 + Zod 输出校验；`analyzer.ts` 改为「本地先算 → LLM 仅解读 → 失败回退」。
- **ChartSpec 严格校验**：Zod schema（agg 必填）+ 8 条语义校验 + pie 降级 + TopN + 局部容错 + 显示顺序排序。
- **分析阶段状态**：SSE 新增 `stage` 事件，前端实时显示「正在计算…」「正在生成 LLM 解读…」。
- **数据警告展示**：截断、IQR 异常值、图表校验提示在看板以警告条形式展示。
- **数据集列表错误反馈**：加载失败与删除失败均给出明确提示（SPEC 27.1）。
- **数值 / 日期标准化**：千分位、百分比、金额（¥/￥/$）、Excel 日期序列、多种日期格式统一转 ISO。
- **原子文件写入**：`saveJsonAtomic` 写临时文件后 rename，meta / rows / analyses 三文件拆分存储。
- **LLM 超时**：`chatJSON` 30s、`streamChat` 60s，超时安全回退本地。
- **CI**：`.github/workflows/ci.yml` 执行 typecheck + test + build。
- **文档**：新增 ARCHITECTURE.md，更新 README.md。

### 变更

- `provider` 取值从 `mock | llm` 改为 `local | local+llm`（SPEC 12.6）。
- 旧 Mock 分支并入本地确定性引擎，不再单独走 mock。
- `ColumnMeta` 扩展 `role / format / nullable / nullRate / distinctCount / confidence / includeInAnalysis / defaultAggregation / userModified`。
- `AnalysisResult` 扩展 `evidence / computedInsights / warnings / version`。
- 图表 `agg` 由可选改为必填。

### 测试

- 新增 `tests/parse.test.ts`、`tests/normalize.test.ts`、`tests/field-config.test.ts`、`tests/chart-engine.test.ts`、`tests/analysis.test.ts`、`tests/analyzer.test.ts`。
- 测试总数从 73 增长至 198，覆盖解析、标准化、字段配置、存储、分析引擎、图表引擎、LLM 编排（禁用/启用/超时回退/renamedChartTitles）。

### 兼容性

- 旧数据集自动迁移（`migrateLegacy`），原有数据集可正常打开。
- 四套主题（Verdigris / Ocean / Sunset / Ink）、液态玻璃 UI、SSE 流式、PNG 复制下载、Windows 一键启动脚本全部保留。
- 不依赖 LLM 也能完成完整分析流程。

---

## v0.1.0

初始版本：导入 Excel/CSV → LLM 生成洞察与图表 → SSE 流式解读 → ECharts 看板。
