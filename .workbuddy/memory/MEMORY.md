# Date-Tool 项目长期记忆

## 项目定位
企微集约化托管运营可视化数据仪表：上传 Excel/CSV → LLM 分析 → ECharts 看板。Next.js 全栈 (App Router)，MiniMax M3 真 LLM（OpenAI 兼容），未配 Key 时 Mock 兜底。

## ⚠️ Git 仓库约定（重要）
- **Git 仓库根在 `D:/ClaudeCodeWorkSpace`**（一个更大的 workspace 仓库），`Date-Tool` 只是 `projects/Date-Tool/` 子目录。
- 仓库里还混着 easysearch 等其他项目，工作区常见大量 `../../backend/`、`../../.github/` 等**他人项目的删除状态**。
- **提交时绝不能用 `git add -A` 或 `git commit -a`**，否则会把别人项目的删除一起卷进 commit。
- 正确做法：在 `projects/Date-Tool/` 目录内 `git add .`（已验证安全），或直接 `git add projects/Date-Tool`。`.gitignore` 已忽略 `.env.local`(含 LLM Key)、`.data/`(用户上传数据)、`node_modules/`、`.next/`。
- 提交前用 `git add -n .` dry-run 确认无 `.env.local` / `.data/` / `backend/` / `easysearch` 等路径。
- 分支 main 与 origin/main 严重 diverged（本地 57 / 远端 125），只本地 commit，**不要 push**（除非用户明确要求）。
- 至今（2026-07-10）所有改动仍在本地，未推远程。

## 技术栈与关键文件
- 解析 `lib/parse.ts`（SheetJS `import * as XLSX`，过滤空列 `__EMPTY*`）、存储 `lib/store.ts`、LLM `lib/llm.ts`、分析 `lib/analyzer.ts`（逐字段语义理解 + 全字段出图）、图表 `lib/chart.ts`。
- 入口：`app/api/datasets`(上传/列表)、`app/api/datasets/[id]`(详情/删除)、`app/api/analyze`(SSE 流式分析)。
- 前端：`app/page.tsx`(上传首页)、`app/dashboard/[id]/page.tsx`(仪表盘)。

## 已踩过的坑（详见 2026-07-10.md）
1. SheetJS ESM 必须 `import * as XLSX`。
2. 后台 `npm run build` 轮询状态不可信，以落盘日志/`.next/BUILD_ID` 为准。
3. 重启服务必须 `taskkill /PID <pid> /F`（git-bash 单斜杠），否则旧进程占端口、新逻辑不生效。
4. `.env.local` 用 `LLM_API_KEY` 但代码读 `OPENAI_API_KEY` → 静默走 Mock；已让 config 兼容两套变量名。
5. MiniMax M3 是推理模型，返回裹 `` 标签 → 需 `stripJson` 剥壳 + `streamChat` 里 `filterThink` 过滤思考过程。
6. 真实业务 Excel 有空列 → 解析出 `__EMPTY_*` 垃圾字段名，已过滤。
