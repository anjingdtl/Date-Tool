# 企微集约化托管运营 · 可视化数据仪表

把一份 Excel / CSV 拖进来，系统自动解析、调用 LLM 生成洞察与图表建议，并渲染成可交互的可视化看板。
没配大模型密钥时，内置「本地占卜师」启发式分析器，开箱即跑通完整流程。

> 世恒哥专属：导入 → LLM 解读 → 发光图表墙，一条龙。

## ✨ 功能

- **数据导入**：拖拽上传 `.xlsx / .xls / .csv`，自动解析、推断列类型（数值 / 文本 / 日期 / 布尔），落盘存储。
- **LLM 自动分析**：基于 OpenAI 兼容接口（混元 / 通义 / DeepSeek / OpenAI 均可），产出
  - 一句话总体结论
  - 3~6 条可行动洞察
  - 自动推荐的图表（趋势线 / 对比柱 / 构成饼 / 数据表）
  - 一段「占卜师」式实时口播解读（**SSE 流式输出**）
- **可视化看板**：ECharts 渲染的图表墙，支持时间趋势、分组对比、占比构成、原始数据预览。
- **零原生依赖**：数据集以 JSON 文件存于 `.data/`，无需安装数据库即可运行。

## 🧱 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Next.js 14（App Router，前后端同仓） |
| 前端 | React 18 + ECharts 5 |
| 解析 | SheetJS(`xlsx`) 读 Excel，PapaParse 读 CSV |
| 分析 | OpenAI 兼容 Chat Completions（含流式） |
| 存储 | 文件型 JSON 存储（零原生依赖，可平滑替换为 Postgres/SQLite） |
| 校验 | Zod 思路的类型化错误体系（自研 `AppError` 层级） |

## 🚀 快速开始

### 一键启动（推荐 · Windows）

双击项目根目录下的 **`start-dev.vbs`**：
- ✅ 不弹 cmd 黑窗口
- ✅ 自动清理 3000 端口旧进程
- ✅ 自动用默认浏览器打开 http://localhost:3000
- ✅ 启动结束弹一个简洁提示框

需要停止服务时，双击 **`stop-dev.bat`**。

> 日志写在 `logs/dev-server.log`（VBS 启动器也会同时落盘一份）。

### 命令行启动（跨平台 / 调试）

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量（可先不填密钥，走 Mock 模式）
cp .env.example .env

# 3. 启动开发服务器
npm run dev
# 打开 http://localhost:3000
```

调试时也可以直接跑 `start-dev.bat`（会弹 cmd 窗口，日志同时输出到屏幕和 `logs/dev-server.log`）。

生产构建：

```bash
npm run build && npm run start
```

## 🔌 接入真实大模型

编辑 `.env`：

```env
OPENAI_BASE_URL=https://api.openai.com/v1   # 或混元/通义/DeepSeek 的兼容地址
OPENAI_API_KEY=sk-xxxx                       # 填上即启用真实 LLM
OPENAI_MODEL=gpt-4o-mini                     # 自选模型
```

- **只要 `OPENAI_API_KEY` 非空**，系统就走真实 LLM；留空则自动回退到本地 Mock 分析器。
- 结构化结论与流式解读会分别调用一次 Chat Completions。若模型不支持 `response_format: json_object`，结构化解析失败时也会安全回退 Mock，保证看板始终有图。

## 🧭 使用流程

1. 首页拖入一份运营数据表（如各托管账号的留言量、响应时长、满意度等）。
2. 自动跳转看板页，点「运行分析 ✨」。
3. 图表先弹出、解读文字逐字浮现（LLM 模式为实时流式）。
4. 分析结果随数据集缓存，下次打开直接展示。

## 🗂️ 目录结构

```
app/
  api/
    datasets/route.ts            # POST 上传 / GET 列表
    datasets/[id]/route.ts       # GET 详情(含分析缓存) / DELETE
    analyze/route.ts             # POST 触发分析（SSE 流式）
  dashboard/[id]/page.tsx        # 看板页
  page.tsx                       # 首页（上传 + 列表）
  layout.tsx, globals.css
components/
  Uploader / DatasetList / ChartCard / DataTable / InsightPanel
lib/
  config.ts      # 环境变量，fail-fast
  errors.ts      # 类型化错误层级 + 统一响应体
  logger.ts      # 结构化 JSON 日志
  store.ts       # 文件型数据集存储
  parse.ts       # CSV/Excel 解析 + 列类型推断
  llm.ts         # OpenAI 兼容客户端（JSON / 流式）
  analyzer.ts    # 分析编排：Mock + LLM
  chart.ts       # 纯函数：ChartSpec + 数据 → ECharts 配置
  api-client.ts  # 前端 typed fetch + SSE 解析
  types.ts       # 共享类型
```

## 🔧 可扩展方向

- **持久化**：将 `lib/store.ts` 换成 Postgres / SQLite（保留现有接口即可，上层无感）。
- **企微直连**：新增 `app/api/wecom/route.ts` 定时拉取托管运营数据写入 store。
- **追问对话**：基于已解析数据做多轮 Q&A（复用 `lib/llm.ts` 的 `streamChat`）。
- **鉴权**：按 fullstack 规范加 JWT 中间件与 RBAC。
- **更多图表**：在 `lib/chart.ts` 增加 `scatter / funnel` 等类型，并在 `analyzer` 的图表推荐里补充。

## ⚠️ 已知限制

- 单数据集默认最多存 5 万行（超出的部分截断，仅用于分析抽样）。
- Mock 模式仅做基础统计与图表推荐，洞察为模板化生成；接入真实 LLM 后效果最佳。
- 图表配置在服务端预计算后随分析结果缓存，因此看板页无需搬运原始数据，轻量渲染。
