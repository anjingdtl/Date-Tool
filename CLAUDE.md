# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

Date-Tool（包名 `wecom-ops-dashboard`，v0.2）：个人本地数据分析与可视化工具。拖入 Excel/CSV → 预检校正字段 → **本地确定性引擎**算出所有图表与洞察 → 可选 LLM 生成自然语言解读。不配 LLM 密钥也能跑完整流程。技术栈 Next.js 14 (App Router) + React 18 + ECharts 5 + Zod，数据以 JSON 文件落盘，零原生依赖。

深入背景见 `README.md`（功能/流程/目录）与 `ARCHITECTURE.md`（数据流/模块职责/约束）。规格见 `docs/`。

## 命令

```bash
npm run dev          # 开发服务器，绑定 127.0.0.1:3000
npm run build        # 生产构建
npm run start        # 生产启动（同样绑 127.0.0.1）
npm run typecheck    # tsc --noEmit（主要质量门）
npm run test         # vitest run（一次性）
npm run test:watch   # vitest 监听
npm run check        # 三件套：typecheck + test + build（每个改动后应跑通）
```

跑单个测试文件 / 单个用例：

```bash
npx vitest run tests/parse.test.ts
npx vitest run -t "解析 CSV"     # 按用例名匹配
```

**注意**：项目**没有 ESLint 配置**，`next.config.mjs` 显式 `eslint.ignoreDuringBuilds = true`。质量门是 `typecheck`（strict 模式），不是 lint。

**Windows 一键启动**（设置 `AUTO_SHUTDOWN_ENABLED=true`，npm run dev 默认 false）：双击 `start-dev.vbs`（无黑窗 + 自动开浏览器 + 关浏览器自动停服务），停服务用 `stop-dev.bat`。dev 日志写 `logs/dev-server.log`（**不要再对 bat 套外层重定向，Windows 会锁文件**）。

## 架构大局观（跨多文件理解）

### 1. 数据集状态机（核心流程约束，分散在 route + store）

```
上传 → draft ──confirm──▶ ready ──analyze──▶ analyzing ──▶ completed
                                                          └─▶ error(可重试)
```

- `draft`：刚上传、字段配置未确认，**禁止直接分析**。
- `/import/[draftId]` 预检页：质量报告 + 字段配置校正（`PUT /api/datasets/[id]/config`）→ 确认 `POST /api/datasets/[id]/confirm`（draft→ready）。
- `/dashboard/[id]` 看板页：`POST /api/analyze` 才允许（只接受 ready/completed）。状态守卫与状态转换散落在 `app/api/datasets/**` 与 `lib/store.ts`，改流程时务必同步两边。

### 2. 本地确定性优先 · LLM 仅解读（最核心的设计哲学）

所有数值（统计/趋势/对比/异常/占比/Top）必须由 `lib/analysis/*` 计算，每条洞察带可追溯 `evidenceId`。LLM **永远不参与数值计算**。

- `lib/analyzer.ts::analyzeDataset` 编排顺序：① `runLocalAnalysis` 算本地结果 → ② 立即 `onStructured` 推送（前端马上能看图）→ ③ 仅当 `config.llm.enabled` 才 `chatJSON` 拿解读 → ④ 应用 `renamedChartTitles` → ⑤ 流式推 narrative → ⑥ 任一 LLM 步骤失败则回退本地。
- `provider` 取值：`"local"`（纯本地）或 `"local+llm"`（本地+解读成功）。
- LLM **安全边界**（`lib/llm-prompt.ts`）：`buildLLMInput` 只发结构化摘要/字段定义/evidence/图表列表，**绝不发原始行**；`LLMInterpretationSchema` 只允许返回 `summary/narrative/actions/renamedChartTitles`，禁止改 `xField/yField/agg/数值`。

### 3. 文件型存储（`lib/store.ts`）

- 每个数据集一个目录 `.data/datasets/<uuid>/`，**三文件拆分**：`meta.json`（不含大数据）、`rows.json`、`analyses.json`。轻量读元信息不被迫加载全表。
- 所有写入经 `saveJsonAtomic`（写临时文件 → rename），避免半写损坏。
- **Dataset ID 必须是 UUID**，所有入口用 `isValidDatasetId`（从 `lib/schemas/dataset.ts` 统一校验，`store.ts` re-export）。
- 单数据集默认 5 万行截断，`quality.storedRowCount < originalRowCount` 时分析结论须注明。
- 持久化可平滑替换为 Postgres/SQLite——只要保留 `store.ts` 的接口，上层无感。

### 4. SSE 流式分析（`app/api/analyze/route.ts`）

`POST /api/analyze` 返回 `text/event-stream`，事件类型：`stage`（阶段提示）→ `result`（本地 structured，含 charts/insights/evidence）→ `token`×N（narrative 逐段）→ `done`（provider/createdAt）/ `error`。前端 `lib/api-client.ts` 负责解析。注意 `analyze/route.ts` 自己手写 SSE，没用 `lib/respond.ts` 的统一 `ok/fail`（流式响应不走 JSON 信封）。

### 5. WebUI 关闭即停服务（独特机制，`lib/heartbeat.ts` + `components/AutoShutdown.tsx`）

仅当 `AUTO_SHUTDOWN_ENABLED=true` 时启用：每个标签页生成 sessionId，每 30s `POST /api/heartbeat`；关闭页面时 `sendBeacon('/api/shutdown?sid=...')`；所有 session 清空并过 45s grace 后 `process.exit(0)`。watcher 用 `globalThis.__*` 单例，HMR 安全。**开发调试时保持 `false`，否则切窗会导致 dev 进程退出。**

### 6. 统一响应与类型化错误（`lib/respond.ts` + `lib/errors.ts`）

非流式 API 走 `ok(data)` / `fail(err, requestId)`，错误信封统一为 `{ title, status, detail, request_id, details? }`。抛错用 `AppError` 子类：`BadRequestError`(400) / `NotFoundError`(404) / `UnprocessableEntityError`(422) / `ConflictError`(409) / `InternalError`(500)。`isOperational=true` 记 warn，否则记 error（带 stack）。新接口请复用这套，不要自己拼 JSON 错误体。

## 关键约定与陷阱

- **路径别名 `@/*` → 项目根**：`tsconfig.json` 与 `vitest.config.ts` 都配了，导入一律用 `@/lib/...`。
- **环境变量双名兼容**：`OPENAI_*` 与 `LLM_*` 两套都认（`OPENAI_BASE_URL/LLM_BASE_URL` 等）。`OPENAI_API_KEY` 非空才启用真实 LLM，否则走本地兜底。`.env.example` 用前者。
- **`lib/config.ts` resolveDataDir 会把相对 `DATA_DIR` 转成绝对路径**（基于 `cwd`），避免 cwd 漂移导致读写分叉。
- **测试隔离**：`vitest.config.ts` 在加载任何 `@/lib/config` 之前把 `DATA_DIR` 指向系统临时目录、`AUTO_SHUTDOWN_ENABLED=false`，保证 `.data` 不污染仓库、watcher 不干扰。DOM 测试文件须命名为 `*.dom.test.tsx`（命中 jsdom），其余为 node 环境。
- **CI**（`.github/workflows/ci.yml`，Node 20）= typecheck + test + build 三步，全绿才能合并。本地用 `npm run check` 提前复现。
- **截图/导出**：图表用 ECharts，PNG 复制/下载依赖 `html2canvas`（`components/ChartCard.tsx`）。
- **四套主题**（Verdigris/Ocean/Sunset/Ink）+ 液态玻璃 UI，主题色由 `lib/chart.ts::buildChartOption` 读取。
