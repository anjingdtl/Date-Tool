# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 这是什么

Date-Tool（包名 `wecom-ops-dashboard`，v0.3.0）：个人本地数据分析 Agent。拖入 Excel/CSV → 预检与 AI 数据理解确认 → LLM 制订受控计划 → 本地确定性工具执行 → LLM 终审 → 用户自然语言微调与 Revision。无 LLM 密钥时走本地规则模式。技术栈 Next.js 14 (App Router) + React 18 + ECharts 5 + Zod，数据以 JSON 文件落盘，零原生依赖。

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

### 2. LLM 指挥 · 本地确定性执行（最核心的设计哲学）

所有数值必须由 `lib/executor/*` 注册工具（复用 `lib/analysis/*`）计算，每个任务生成 Evidence。LLM **永远不参与数值计算**。

- `lib/analyzer.ts` 是兼容门面：LLM 未启用、理解未确认或编排失败时走 `rule_fallback`；否则进入 `run-analysis-session`。
- 主链路：Understanding → Plan → Validate → Execute → Review → optional revise → Finalize。
- 用户反馈必须先转成 `AnalysisPlanPatch`，经影响分析后增量执行并形成新 Revision。
- `provider` 保留 `local | local+llm`；用 `analysisMode` 区分 `rule_fallback | llm_orchestrated`。

### 3. 文件型存储（`lib/store.ts`）

- 每个数据集一个目录 `.data/datasets/<uuid>/`，保留 `meta/rows/analyses`，新增 `context/understanding/sessions/*/revisions`。
- 所有写入经 `saveJsonAtomic`（同路径串行、临时文件 fsync/关闭 → rename）。Revision 先写，Session 最后激活。
- **Dataset ID 必须是 UUID**，所有入口用 `isValidDatasetId`（从 `lib/schemas/dataset.ts` 统一校验，`store.ts` re-export）。
- 单数据集默认 5 万行截断，`quality.storedRowCount < originalRowCount` 时分析结论须注明。
- 持久化可平滑替换为 Postgres/SQLite——只要保留 `store.ts` 的接口，上层无感。

### 4. SSE 流式分析（`app/api/analyze/route.ts`）

`POST /api/analyze` 与 `POST /api/analysis/{sessionId}/feedback` 返回 SSE。编排事件包括 `stage/plan/task_started/task_completed/task_failed/review/question/revision/token/final/done/error`，并兼容旧 `result`。错误后不得再发送 `final/done`。

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
