# Date-Tool v0.3.0 Phase 0–10 规格审计与回归报告

> 审计日期：2026-07-16
>
> 审计分支：`feat/v0.3-llm-orchestrator`
>
> 对照规格：`Date-Tool v0.3.0-LLM 指挥中枢数据分析 Agent 改造规格.md`

## 1. 结论

规格第 25 节 Phase 0–10 的 P0 验收项已落实。复核期间发现并补齐了 DataContext 全链路脱敏、行样本隐私开关、阻塞歧义处理、20 类计划规则覆盖、Review Evidence 结果输入、终审确定性回退、结构化编排日志、完整 rows hash、LLM 输出上限/错误正文隔离、显式本地模式、Understanding 级反馈重建计划、看板 Session/目标/错误详情，以及数值分布和排名参数约束。

最终发布门以 `npm run check` 为准：strict TypeScript、全量 Vitest、Next.js production build 必须同时通过。

## 2. Phase 0–10 验收矩阵

| Phase | 状态 | 主要实现证据 | 回归证据 |
|---|---|---|---|
| 0 基线 | 通过 | v0.2.1 基线提交与 `package.json` 版本链；本轮先提交完整接手状态 `b90762a` | Git 状态复核、最终 `npm run check` |
| 1 类型/Schema | 通过 | `lib/types.ts`、`lib/schemas/understanding.ts`、`analysis-plan.ts`、`analysis-review.ts`、`plan-patch.ts`、`formula.ts` | 5 个 Schema 文件正反例测试；Phase 1–4 分组 164/164 |
| 2 DataContext/隐私 | 通过 | `build-data-context.ts`、`detect-sensitive.ts`；全行 SHA-256、稳定分类覆盖采样、统一敏感掩码、12k token budget、行样本开关 | `data-context` 17 项、`sensitive-mask` 14 项、`type-sampling` 19 项 |
| 3 LLM 理解 | 通过 | Understanding Prompt/服务/API/持久化/状态机；最多两次 JSON 修复；失败不伪造 Understanding | `understanding-service` 12 项、注入隔离 4 项、Schema 13 项 |
| 4 理解确认 UI | 通过 | 预检页语义编辑、歧义选项/手动处理、确认、显式本地规则模式；API 阻断未确认的默认 LLM 分析 | Route/UI 类型检查、production build、Understanding 与 Route 测试 |
| 5 公式/工具 | 通过 | 受控 Formula AST、11 个注册操作符、任务缓存、Evidence/哈希；distribution 数值分箱；ranking 显式聚合/排序 | Phase 5–7 分组 141/141；每类执行器独立测试 |
| 6 计划/执行器 | 通过 | Planning Prompt、20 类规则校验、工具参数预检、最多两次修复、DAG、并发与隔离、图表编译 | `plan-validation` 20 项、图表引擎 34 项、编译 4 项及各算子测试 |
| 7 终审 | 通过 | Review Prompt 包含裁剪后的 Evidence 结果；引用/数值结论校验；approve/revise/question；两轮上限；本地确定性叙述回退 | `review-loop` 8 项、`review-validation` 5 项、`review-prompt` 2 项、orchestrator 循环测试 |
| 8 Session/Revision | 通过 | Session/Revision 原子持久化、active 激活顺序、SSE 主链路、v0.2.1 兼容、本地降级、结构化生命周期日志 | Phase 8–9 分组 109/109；SSE 顺序、失败不伪成功、迁移恢复与兼容测试 |
| 9 对话微调 | 通过 | Feedback Prompt/PlanPatch/impact analysis；展示复用、依赖增量重算、Understanding 变更重建 Plan、stale 拒绝、恢复新建 Revision | `feedback-*`、`impact-analysis`、`revision-store`、Route 测试 |
| 10 文档/发布 | 通过 | README、ARCHITECTURE、CHANGELOG、版本 0.3.0、安全/隐私/降级说明；旧“LLM 只解读”仅保留在历史变更记录 | 文档复核、动态执行扫描、最终 `npm run check` |

## 3. 分组回归结果

### Phase 1–4：协议、上下文、理解与确认

- 12 个测试文件通过。
- 164 个测试通过。
- 覆盖 Schema、DataContext、敏感掩码、采样、字段重规范化、Understanding、修复循环与提示注入。

### Phase 5–7：确定性执行、计划与终审

- 16 个测试文件通过。
- 141 个测试通过。
- 覆盖 Formula AST、注册表、11 类操作符、计划 20 类校验、DAG/图表编译、Evidence 与 Review 循环。

### Phase 8–9：主链路、持久化、兼容与反馈

- 15 个测试文件通过。
- 109 个测试通过。
- 覆盖 Session/Revision、SSE 顺序、状态机、旧数据迁移、v0.2.1 兼容、反馈 Patch、影响分析、增量重算和恢复。

### Phase 10：最终发布门

- `npm run typecheck`：通过。
- `npm run test`：50 个测试文件、525 个测试全部通过。
- `npm run build`：Next.js 14.2.15 production build 通过，全部页面与 API Route 成功编译。
- `npm run check`：整体通过。

## 4. 安全与确定性专项复核

- LLM 不接收完整原始表，且可关闭所有行样本发送。
- 敏感值在列样例、代表值、Top 值和采样行中统一稳定掩码。
- 字段名、Sheet 名、单元格和样本值在四类 System Prompt 中均被声明为不可信数据。
- Formula 仅允许结构化 AST；代码路径不存在 `eval` / `new Function` 调用。
- LLM JSON 和流式输出均有 token 上限、超时与响应校验；供应商错误正文不进入日志或客户端。
- 所有计算结果来自确定性工具；Review 无 Evidence 的数值 finding 被拒绝。
- 缓存输入包含全部已载入 rows 的 SHA-256，非采样行变化也会失效。
- 失败 Revision 不会替换 active Revision；`error` SSE 后不会再发送 `final/done`。

## 5. 实现形态说明

- 规格中的目录是建议结构；部分职责采用同目录内合并模块实现，接口和行为等价，不影响验收。
- 当前每次初始分析都会创建新 Session，因此 `forceNewSession` 字段保留兼容但没有额外复用语义。
- 当前导入器按单工作表数据集运行。反馈若要求切到本次未载入的 Sheet，会明确拒绝并要求重新导入/选择，不会构造跨 Sheet 结果。
- UI 验收由 TypeScript、Route 测试与 production build 覆盖；本报告不把人工浏览器视觉巡检冒充为自动化 E2E。
