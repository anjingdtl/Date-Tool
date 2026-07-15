# 企微集约化托管运营 · 可视化数据仪表

把一份 Excel / CSV 拖进来，系统先做数据预检与字段校正，再用**本地确定性引擎**算出所有图表与洞察，最后可选地由 LLM 生成自然语言解读。
不配大模型密钥也能跑通完整分析流程；LLM 只负责解读，不参与数值计算。

> 世恒哥专属：导入 → 预检校正 → 本地算图 → LLM 解读，一条龙。

## ✨ 功能

- **数据导入预检**：拖拽上传 `.xlsx / .xls / .csv`，自动解析、推断列类型与业务角色，进入预检页可校正字段类型 / 角色 / 格式 / 聚合方式。
- **数据质量报告**：显示原始行数与实际存储行数、空值、重复行、混合类型、日期解析异常、高基数字段等警告。
- **本地确定性分析**：所有关键数值（总数、均值、环比、分组汇总、状态占比、Top/Bottom、异常值、趋势）由本地代码计算，每条洞察都带可追溯的 `evidenceId` 计算依据。
- **LLM 仅做解读**：基于 OpenAI 兼容接口（混元 / 通义 / DeepSeek / OpenAI 均可），LLM 只产出总结、叙述、行动建议与图表标题优化，不得修改字段映射或计算结果。
- **流式输出**：本地结果先于 LLM 文本出现；LLM 叙述以 SSE 流式逐字呈现，分析阶段状态实时反馈。
- **可视化看板**：ECharts 渲染的图表墙，支持时间趋势、分组对比、占比构成、原始数据预览，图表复制 PNG / 下载 PNG。
- **四套主题**：Verdigris、Ocean、Sunset、Ink，液态玻璃 UI。
- **零原生依赖**：数据集以 JSON 文件原子写入 `.data/`，无需安装数据库；Windows 一键启动脚本。

## 🧱 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Next.js 14（App Router，前后端同仓） |
| 前端 | React 18 + ECharts 5 |
| 解析 | SheetJS(`xlsx`) 读 Excel，PapaParse 读 CSV |
| 分析 | 本地确定性引擎（`lib/analysis/*`）+ OpenAI 兼容 Chat Completions（仅解读） |
| 存储 | 文件型 JSON 原子写入（零原生依赖，可平滑替换为 Postgres/SQLite） |
| 校验 | Zod 严格校验（Dataset ID / FieldConfig / ChartSpec / LLM 输出） |

## 🚀 快速开始

### 一键启动（推荐 · Windows）

双击项目根目录下的 **`start-dev.vbs`**：
- ✅ 不弹 cmd 黑窗口
- ✅ 自动清理 3000 端口旧进程
- ✅ 自动用默认浏览器打开 http://127.0.0.1:3000
- ✅ 启动结束弹一个简洁提示框
- ✅ 关闭浏览器后服务会自动停止（也可手动 `stop-dev.bat`）

需要停止服务时，双击 **`stop-dev.bat`**。

> 日志写在 `logs/dev-server.log`（由 `start-dev.bat` 单独写入；请勿再对 bat 做外层日志重定向，否则 Windows 会锁文件导致启动失败）。

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

- **只要 `OPENAI_API_KEY` 非空**，系统在本地分析完成后额外调用 LLM 做解读；留空则只走本地确定性引擎，看板照常有图有洞察。
- LLM 只返回 `summary / narrative / actions / renamedChartTitles`，任何 LLM 调用失败都安全回退本地结果，保证看板始终可用。

## 🧭 使用流程

1. 首页拖入一份运营数据表（如各托管账号的留言量、响应时长、满意度等）。
2. 上传后进入**数据预检页**：查看数据质量报告、校正字段类型/角色/格式/聚合，点「生成看板」确认。
3. 看板页点「运行分析」：本地引擎先算出图表与洞察（立即可见），再可选地由 LLM 流式生成解读。
4. 点「查看计算依据」可展开每条洞察背后的 evidence（方法、样本数、字段、计算结果）。
5. 分析结果随数据集缓存，下次打开直接展示；支持分析历史保留最近 3 次。

## 🗂️ 目录结构

```
app/
  api/
    datasets/route.ts                 # POST 上传 / GET 列表
    datasets/[id]/route.ts            # GET 详情(含分析缓存) / DELETE
    datasets/[id]/config/route.ts     # PUT 字段配置校正(SPEC 9.7 校验)
    datasets/[id]/confirm/route.ts    # POST draft→ready 确认
    analyze/route.ts                  # POST 触发分析（SSE 流式 + stage）
    settings/route.ts, heartbeat, shutdown
  dashboard/[id]/page.tsx             # 看板页
  import/[draftId]/page.tsx           # 数据预检页(SPEC 9)
  page.tsx                            # 首页（上传 + 列表）
  layout.tsx, globals.css
components/
  Uploader / DatasetList / ChartCard / DataTable / InsightPanel
  FieldConfigTable / QualityOverview  # 预检页组件
lib/
  config.ts        # 环境变量，fail-fast
  errors.ts        # 类型化错误层级 + 统一响应体 + ConflictError
  logger.ts        # 结构化 JSON 日志
  store.ts         # 文件型数据集存储 + 原子写入 + 三文件拆分
  parse.ts         # CSV/Excel 解析 + 列类型推断 + 质量报告
  normalize.ts     # 数值/日期标准化(千分位/百分比/金额/Excel序列)
  llm.ts           # OpenAI 兼容客户端（JSON 30s / 流式 60s 超时）
  llm-prompt.ts    # LLM 输入构造 + System Prompt + 输出 Zod 校验
  analyzer.ts      # 分析编排：本地先算 → LLM 仅解读 → 失败回退
  chart.ts         # 纯函数：ChartSpec + 数据 → ECharts 配置（TopN 截断）
  api-client.ts    # 前端 typed fetch + SSE 解析（含 stage 事件）
  types.ts         # 共享类型
  schemas/         # Zod schemas：dataset / chart / settings
  analysis/        # 确定性分析引擎(SPEC 10)
    statistics.ts profile.ts trends.ts comparisons.ts
    outliers.ts evidence.ts recommend-charts.ts index.ts
tests/             # Vitest 单元测试
docs/              # 规格文档
```

## 🔧 可扩展方向

- **持久化**：将 `lib/store.ts` 换成 Postgres / SQLite（保留现有接口即可，上层无感）。
- **企微直连**：新增 `app/api/wecom/route.ts` 定时拉取托管运营数据写入 store。
- **追问对话**：基于已解析数据做多轮 Q&A（复用 `lib/llm.ts` 的 `streamChat`）。
- **鉴权**：按 fullstack 规范加 JWT 中间件与 RBAC。
- **更多图表**：在 `lib/chart.ts` 增加 `scatter / funnel` 等类型，并在 `analyzer` 的图表推荐里补充。

## ⚠️ 已知限制

- 单数据集默认最多存 5 万行（超出的部分截断，分析结论会注明「基于已载入数据」）。
- 不依赖 LLM 也能完成完整分析；接入 LLM 后额外获得自然语言解读与图表标题优化。
- 本工具面向个人本地使用，不做多用户 / 登录 / RBAC / 云端数据库。
- 图表配置在服务端预计算后随分析结果缓存，因此看板页无需搬运原始数据，轻量渲染。

## 📚 更多文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) —— 架构与数据流说明
- [CHANGELOG.md](./CHANGELOG.md) —— 版本变更记录
- [docs/Date-Tool-v0.2-optimization-spec.md](./docs/Date-Tool-v0.2-optimization-spec.md) —— v0.2 改造规格说明书
