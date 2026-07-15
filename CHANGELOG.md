# 变更记录

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
