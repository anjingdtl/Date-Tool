# Date-Tool v0.3.0

Date-Tool 是一个本地优先的个人数据分析 Agent：拖入 Excel / CSV 后，LLM 负责理解数据语义、制订分析计划、调度受控工具和终审结果；本地 TypeScript 引擎负责完整数据上的确定性计算、校验、Evidence 与图表编译。

核心边界很简单：LLM 决定“算什么、怎么看”，代码保证“怎么算、画得对”，用户拥有最终修订权。没有配置 LLM 时，系统自动切换到本地规则模式，基础看板仍可完整使用。

## 主要能力

- 导入 `.xlsx / .xls / .csv`，预检数据质量并校正物理字段类型、格式和聚合。
- 基于稳定采样、字段统计与脱敏样本构建 `DataContext`。
- LLM 在正式分析前识别数据集类型、表格结构、行粒度、字段语义、字段关系和派生指标候选。
- 用户可在预检页修正并确认 AI 数据理解；阻塞性歧义未处理时不会进入默认编排。
- LLM 通过受 Zod 约束的 `AnalysisPlan` 选择操作符、字段、聚合、筛选、公式和看板布局。
- 本地工具注册表执行 `profile / aggregate / timeseries / compare / distribution / ranking / ratio / growth / correlation / anomaly / pivot`。
- 所有公式使用受控 AST，不使用 `eval`、`new Function`、任意脚本或 SQL。
- 每个任务生成输入哈希、结果哈希和 Evidence；最终数值只能来自确定性任务结果。
- LLM 终审可批准、提出问题或追加受控任务，自动修订最多两轮。
- 看板支持 bar、line、pie、table、area、stacked bar、scatter、heatmap 和 KPI。
- 用户可用自然语言修改筛选、维度、指标、时间粒度、排序或展示；系统只重算受影响任务及下游依赖。
- 每次修改形成新 Revision，支持历史查看、撤销和恢复。
- 四套主题、液态玻璃 UI、ECharts、PNG 复制/下载、SSE 与 Windows 一键启动继续保留。

## 运行方式

### Windows 一键启动

双击根目录的 `start-dev.vbs`。它会清理 3000 端口、启动开发服务并打开浏览器；关闭所有 Date-Tool 页面后服务可自动退出。手动停止可运行 `stop-dev.bat`。

开发日志写入 `logs/dev-server.log`。不要再对启动 bat 套外层重定向，否则 Windows 可能锁住日志文件。

### 命令行

```bash
npm install
cp .env.example .env
npm run dev
```

打开 <http://127.0.0.1:3000>。

质量门：

```bash
npm run typecheck
npm run test
npm run build
npm run check     # 依次执行前三项
```

## LLM 配置

Date-Tool 使用 OpenAI 兼容 Chat Completions 接口：

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxx
OPENAI_MODEL=gpt-4o-mini
```

也可在“设置”页保存 API Key、Base URL 和模型名，下一次理解或分析立即生效，无需重启。`OPENAI_*` 与旧 `LLM_*` 环境变量名均兼容。

- 有有效 API Key：`analysisMode = llm_orchestrated`，执行理解 → 计划 → 本地计算 → 终审。
- 无 API Key，或编排/计划失败：`analysisMode = rule_fallback`，`provider = local`。
- LLM 规划成功时：`provider = local+llm`。这个值不表示 LLM 计算了数值。

## 使用流程

1. 首页上传 Excel / CSV。
2. 在预检页检查质量、物理字段配置和 AI 数据理解。
3. 处理阻塞性歧义，修正字段语义后确认。
4. 在看板运行分析；界面会显示计划、任务执行和终审时间线。
5. 展开 Evidence 查看任务、字段、样本量、参数和计算结果。
6. 在“自然语言微调”中提出修改，例如“只看南宁市，按区县展示收入完成率”。
7. 在 Revision 历史中撤销或恢复旧版本；恢复会创建新 Revision，不删除历史。

## 架构概览

```text
Parse / Preview
  → Build DataContext（稳定采样 + 敏感值掩码）
  → LLM Understand → User Confirm
  → LLM Plan → Zod + 业务规则校验
  → Deterministic Tool Registry（完整已载入数据）
  → Evidence + Result Hash
  → LLM Review（approve / revise / needs_user_input）
  → Compile Dashboard
  → User Feedback → PlanPatch → Impact Analysis → Incremental Re-execute
```

关键目录：

```text
app/api/analysis/       # Session、反馈、Revision 与恢复 API
app/api/datasets/       # 上传、字段配置、理解与确认 API
app/api/analyze/        # 初始分析 SSE
lib/semantic/           # DataContext、脱敏、数据理解
lib/planner/            # AnalysisPlan 生成、修复、DAG 与校验
lib/executor/           # 工具注册表、操作符、公式、缓存、图表编译
lib/reviewer/           # 终审、Evidence 引用校验、Review Patch
lib/conversation/       # 用户反馈解释、PlanPatch、影响分析、Revision 历史
lib/orchestrator/       # 初始 Session 与反馈 Revision 编排
lib/store.ts            # JSON 原子存储、迁移、Session/Revision
components/             # 预检、看板、时间线、对话与历史 UI
tests/                  # Vitest 单元与 Route/SSE 测试
```

详细模块边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)。完整工程规格见 [v0.3.0 改造规格](./docs/Date-Tool%20v0.3.0-LLM%20指挥中枢数据分析%20Agent%20改造规格.md)。

## API 与 SSE

- `POST /api/datasets/{id}/understand`：运行数据理解（SSE）。
- `GET|PUT /api/datasets/{id}/understanding`：读取、修正和确认理解。
- `POST /api/analyze`：启动初始分析（SSE）。
- `GET /api/analysis/{sessionId}`：读取 Session、当前 Revision 和历史摘要。
- `POST /api/analysis/{sessionId}/feedback`：自然语言微调（SSE）。
- `GET /api/analysis/{sessionId}/revisions/{revisionId}`：读取 Revision。
- `POST /api/analysis/{sessionId}/revisions/{revisionId}/restore`：恢复历史版本。

编排 SSE 事件包括 `stage / plan / task_started / task_completed / task_failed / review / question / revision / token / final / done / error`，并继续兼容 v0.2 的 `result` 事件。

## 安全与隐私

- 原始完整行只保存在本机 `.data/`；默认只向 LLM 发送统计、结构和最多 40 条稳定采样行。
- 姓名、手机号、邮箱、身份证、账号、地址、设备 ID、客户编号和订单号等候选敏感值会稳定掩码。
- 单元格、字段名和 Sheet 名均视为不可信数据，不会被当作系统指令。
- LLM 输出必须通过 Zod；字段引用、聚合、公式、依赖和图表关联还会经过服务端业务校验。
- 对话输入最多 4000 字符；计划、公式、自动修订、Session 和 Revision 均有硬上限。
- 日志不记录 API Key、完整 Prompt、完整原始行或敏感原值。

## 存储与兼容

```text
.data/datasets/{datasetId}/
  meta.json
  rows.json
  analyses.json
  context.json
  understanding.json
  sessions/{sessionId}/
    session.json
    revisions/{revisionId}.json
```

写入采用同路径串行的“临时文件 → fsync/关闭 → rename”。旧 v0.2.1 数据集和 analysis 继续可读；读取旧数据不会自动调用 LLM。单数据集默认最多保存 5 个 Session，每个 Session 最多 20 个 Revision。

## 已知限制

- 单数据集默认最多存储 5 万行，超出部分会截断，理解、终审和最终警告会明确说明分析基于已载入数据。
- 工具面向个人本地使用，不包含登录、多用户、云数据库、任意 SQL/Python、PDF/Excel 导出或实时流计算。
- 任务缓存目前是进程内 LRU；重启后会重新计算，但结果仍可从 Revision 历史读取。

版本记录见 [CHANGELOG.md](./CHANGELOG.md)。
