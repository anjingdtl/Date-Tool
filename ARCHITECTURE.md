# Date-Tool 架构说明

> 版本：v0.3.0
> 定位：LLM 指挥、本地确定性执行的个人数据分析 Agent

## 1. 架构原则

1. **LLM 有分析决策权，没有数值修改权**：LLM 理解语义、制订计划、终审和解释用户反馈；最终数值只能来自本地任务结果。
2. **用户事实优先**：用户当前指令 > 已确认 Understanding > 预检字段配置 > LLM 推断 > 启发式候选 > 默认规则。
3. **受控协议**：Understanding、Plan、Review、PlanPatch 和公式 AST 均有 Zod Schema 与额外业务校验。
4. **本地优先**：完整行保存在本机，确定性工具在全部已载入数据上执行；无 LLM 时本地规则模式仍可用。
5. **可追溯**：任务具有稳定 ID、输入哈希、结果哈希和 Evidence，最终洞察只能引用有效 Evidence。
6. **失败保留最后有效版本**：非法 Patch、失败 Revision 或 LLM 故障不会覆盖当前 active Revision。
7. **自动循环有限**：计划 JSON 最多修复两次，终审最多自动追加两轮，任务/Session/Revision/公式均有硬上限。

## 2. 主数据流

```text
上传 Excel / CSV
  ↓
parse + normalize + quality
  ↓
draft 数据集 → 预检字段校正
  ↓
buildDataContext
  ├─ 物理类型、空值、分布、数值/日期统计
  ├─ 稳定头中尾/等距/固定种子采样
  └─ 敏感值稳定掩码、token budget 裁剪
  ↓
LLM Understanding → 用户修正/确认
  ↓
ready → POST /api/analyze
  ↓
createAnalysisPlan → Zod + 20 类业务校验 → 依赖 DAG
  ↓
executePlan → Tool Registry → TaskExecutionResult + Evidence
  ↓
reviewExecution
  ├─ approved
  ├─ revise → 受控 PlanPatch → 新 Revision → 最多 2 轮
  └─ needs_user_input → 保留结果并等待用户
  ↓
compileDashboard → FinalAnalysisResult → active Revision
  ↓
用户反馈 → PlanPatch → impact analysis → 增量重算 → 再终审
```

## 3. 状态与事实来源

### DatasetStatus

```text
draft → ready → analyzing → completed
                         └→ error（可重试）
```

DatasetStatus 只表达数据集外层状态，不承载全部编排阶段。

### UnderstandingStatus

`not_started / building_context / understanding / needs_user_input / ready_for_confirmation / confirmed / failed / fallback`

### AnalysisSessionStatus

`planning / validating_plan / executing / reviewing / needs_user_input / revising / completed / error / cancelled`

### RevisionStatus

`draft / executing / reviewing / approved / needs_user_input / failed`

权威来源：

| 事实 | 单一来源 |
|---|---|
| 物理类型 | `ColumnMeta.type` |
| 业务语义 | active Revision 的 `understandingSnapshot` / 当前 confirmed Understanding |
| 当前计划 | active Revision 的 `plan` |
| 数值 | `TaskExecutionResult` |
| 证据 | `AnalysisEvidence` |
| 看板顺序 | `AnalysisPlan.dashboard` |
| 用户修改 | `AnalysisPlanPatch` |
| 当前版本 | `AnalysisSession.activeRevisionId` |
| 最终展示 | active Revision 的 `finalResult` |

## 4. 模块职责

### 4.1 解析与语义

| 模块 | 职责 |
|---|---|
| `lib/parse.ts` | CSV/Excel 解析、物理类型候选、原始/存储行数 |
| `lib/normalize.ts` | 数值、日期、布尔标准化；确认后按最终物理配置重规范化 |
| `lib/quality.ts` | 质量报告、截断、混合类型、非法日期/数值等警告 |
| `lib/semantic/build-data-context.ts` | 客观上下文、可复现采样、统计和 token budget |
| `lib/semantic/detect-sensitive.ts` | 敏感字段识别与同上下文稳定掩码 |
| `lib/semantic/understand-dataset.ts` | LLM 数据理解、Schema 修复循环与失败状态 |
| `lib/semantic/apply-understanding.ts` | 用户字段修正、歧义处理和确认；用户修正标记 `source=user` |

物理类型与业务语义严格分离。例如数字型订单号可以同时是 `ColumnMeta.type=number` 与 `FieldUnderstanding.role=identifier`。

### 4.2 计划层

| 模块 | 职责 |
|---|---|
| `lib/planner/planning-prompt.ts` | 只允许注册操作符、已有字段和结构化任务 |
| `lib/planner/create-analysis-plan.ts` | LLM Plan + 最多两次修复 |
| `lib/planner/validate-analysis-plan.ts` | ID、字段、依赖、聚合、语义、公式、图表和上限校验 |
| `lib/planner/plan-dependencies.ts` | 环检测和拓扑排序 |

非法计划不会进入执行器。计划默认最多 16 个任务，硬上限 24 个。

### 4.3 确定性执行层

所有任务必须通过 `lib/executor/registry.ts` 分派。操作符位于 `lib/executor/operators/`：

`profile / aggregate / timeseries / compare / distribution / ranking / ratio / growth / correlation / anomaly / pivot`

关键模块：

| 模块 | 职责 |
|---|---|
| `formula-engine.ts` | 深度/节点受限的 Formula AST；显式除零策略 |
| `execute-plan.ts` | DAG 分层并发、依赖失败跳过、增量复用和任务隔离 |
| `task-cache.ts` | 进程内 LRU，键包含 rows/understanding/task/executor 哈希 |
| `result-hash.ts` | canonical task、输入与结果 SHA-256 |
| `compile-chart.ts` | 从 DashboardItemPlan + TaskExecutionResult 编译图表/表格/KPI |

执行器复用 `lib/analysis/*` 的聚合、统计、趋势和异常逻辑，不维护第二套同义计算。

### 4.4 终审与对话

| 模块 | 职责 |
|---|---|
| `lib/reviewer/review-execution.ts` | 终审 LLM 调用、Schema 与引用校验 |
| `lib/reviewer/validate-review.ts` | 拒绝编造 Evidence；校验任务和图表引用 |
| `lib/reviewer/apply-review-patch.ts` | 不可变地应用终审 Patch |
| `lib/conversation/interpret-user-feedback.ts` | 自然语言 → AnalysisPlanPatch，最多两次修复 |
| `lib/conversation/apply-plan-patch.ts` | 校验 Patch 目标并合并计划/语义 |
| `lib/conversation/impact-analysis.ts` | 区分展示复用、单任务重算和下游依赖链 |
| `lib/conversation/revision-history.ts` | Revision 摘要、撤销/恢复（恢复创建新版本） |

### 4.5 编排门面

- `lib/analyzer.ts` 是兼容门面：LLM 未启用、理解未确认或编排失败时进入 `rule_fallback`；否则调用 Session 编排。
- `lib/orchestrator/run-analysis-session.ts` 负责首次 Plan → Execute → Review → Finalize。
- `lib/orchestrator/apply-user-feedback.ts` 负责反馈 Patch → 增量 Execute → Review → 激活新 Revision。

`provider` 保持 `local | local+llm` 以兼容旧 UI；`analysisMode` 区分 `rule_fallback | llm_orchestrated`。

## 5. 存储、一致性与迁移

```text
.data/datasets/{uuid}/
  meta.json
  rows.json
  analyses.json
  context.json
  understanding.json
  sessions/{sessionId}/
    session.json
    revisions/{revisionId}.json
```

- `saveJsonAtomic` 对同一路径串行写入，临时文件写完后 fsync、关闭并 rename。
- Dataset ID 必须为 UUID；Session/Revision ID 还要通过安全字符校验，禁止路径穿越。
- 激活顺序是“先写 Revision，最后写 Session.activeRevisionId”，避免悬空引用。
- 每个数据集最多 5 个 Session，每个 Session 最多 20 个 Revision。
- v0.2 单文件数据会通过 `.migrating` 临时目录迁移；旧 analysis 保留，不会在读取时自动调用 LLM。

## 6. API 与 SSE

非流式 API 使用 `ok` / `fail` 与统一错误信封。SSE 路由自行写帧，但错误后不会继续发送伪成功 `final/done`。

| API | 用途 |
|---|---|
| `POST /api/datasets/{id}/understand` | 构建上下文并运行理解（SSE） |
| `GET|PUT /api/datasets/{id}/understanding` | 读取、修正、确认理解 |
| `POST /api/analyze` | 首次分析（SSE） |
| `GET /api/analysis/{sessionId}` | Session、active Revision、历史摘要 |
| `POST /api/analysis/{sessionId}/feedback` | 自然语言微调（SSE） |
| `GET /api/analysis/{sessionId}/revisions/{revisionId}` | Revision 详情 |
| `POST /api/analysis/{sessionId}/revisions/{revisionId}/restore` | 创建恢复 Revision |

编排事件：`stage / understanding / ambiguity / plan / task_started / task_completed / task_failed / review / question / revision / token / final / done / error`。旧 `result` 事件继续兼容本地规则模式。

## 7. 安全边界

- 禁止 `eval`、`new Function`、任意脚本、任意 SQL、文件/网络工具调用。
- 单元格、字段名和 Sheet 名均视为不可信数据；Understanding Prompt 明确执行提示注入隔离。
- 默认向 LLM 发送统计和最多 40 条脱敏样本，不发送完整原始表。
- 终审输入是任务摘要、裁剪后的聚合结果、Evidence、图表草案和 warning。
- API Key 不进入日志、响应、Evidence、Session 或 Revision。
- 用户反馈最长 4000 字符；失败 Patch 不写理解、不保存 Revision、不切 activeRevisionId。
- 相关性不得描述为因果，统计异常不得直接断言为业务错误，数据截断必须贯穿全链路。

## 8. 测试与质量门

- Vitest 在临时 `DATA_DIR` 中串行运行，避免文件竞态和仓库污染。
- 测试覆盖解析、质量、DataContext、脱敏、提示注入、Understanding、Plan、公式、11 类工具、Review、Session/Revision、反馈影响、恢复和 Route/SSE 顺序。
- CI 与本地最终质量门均为：

```bash
npm run check
```

它依次执行 strict TypeScript、完整 Vitest 和 Next.js production build。项目没有 ESLint 配置，`typecheck` 是静态质量门。

## 9. 本地生命周期

当 `AUTO_SHUTDOWN_ENABLED=true` 时，`AutoShutdown` 每 30 秒发送 heartbeat；所有浏览器 Session 关闭并超过 45 秒宽限期后进程退出。开发调试应保持为 `false`，避免切页时误停服务。
