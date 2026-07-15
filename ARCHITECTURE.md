# Date-Tool 架构说明

> 版本：v0.2.1  
> 定位：个人本地数据分析与辅助图表工具

---

## 1. 设计原则

1. **本地优先**：默认本机访问，数据存 `.data/`，不要求数据库，不依赖 LLM 也能完成分析。
2. **确定性计算优先**：所有关键数值由本地代码计算，LLM 只负责解读与建议。
3. **用户可校正**：自动推断不等于最终事实，字段类型 / 角色 / 格式均可人工修正。
4. **保持轻量**：沿用 Next.js + TypeScript + Zod + ECharts + 文件存储，不引入重型框架。
5. **保留视觉资产**：四套主题、液态玻璃 UI、SSE 流式、PNG 复制下载、Windows 一键启动全部保留。

---

## 2. 数据流

```
拖入文件
  ↓
parse.ts 解析(RawSheet → profileColumn 均匀采样 → normalizeRowsByColumns → generateDataQuality)
  ↓
POST /api/datasets  →  存储 status=draft
  ↓
跳转 /import/[draftId]  预检页
  ├─ 文件摘要(原始行数 / 存储行数 / 截断)
  ├─ 数据质量概览(空值/重复/混合类型/日期异常/非法数字/高基数)
  ├─ 字段配置表(类型/角色/格式/聚合/是否参与分析 可编辑)
  ├─ 前 20 行预览
  └─ 生成看板 → PUT /config 校正 → POST /confirm (重规范化 rows + 重算质量, draft→ready)
  ↓
跳转 /dashboard/[id]  看板页
  ↓
POST /api/analyze  (SSE 流式, 状态校验: draft/analyzing → 409)
  ├─ stage: 正在计算数据质量与统计结果
  ├─ result: 本地 structured (charts + insights + evidence + warnings, provider=local)
  ├─ stage: 正在生成 LLM 解读  (仅当 LLM 启用)
  ├─ token × N: 分段 narrative
  ├─ final: 最终 summary/insights/charts/options/provider（一次性刷新前端）
  └─ done: { provider, createdAt }
  ↓
updateAnalysis 持久化(原子写入, analyzing→completed；失败→error 可重试)
```

---

## 3. 数据集状态机

```
上传 → draft → confirm → ready → analyze → completed
                                    ↓
                                  error (失败可重试)
```

- `draft`：刚上传，未确认字段配置，禁止直接分析。
- `ready`：用户确认字段配置后，允许分析。
- `analyzing` / `completed` / `error`：分析过程中的过渡态。

---

## 4. 模块职责

### 4.1 解析层

| 模块 | 职责 |
|------|------|
| `lib/parse.ts` | CSV/Excel 解析、列类型推断（均匀采样 500 行 + typeDistribution）、行数记录 |
| `lib/normalize.ts` | 数值/日期/布尔标准化、`normalizeRowsByColumns`（行规范化，parse 与 confirm 共用）、`recomputeColumnStats` |
| `lib/quality.ts` | `generateDataQuality`：质量报告（含 INVALID_DATE / INVALID_NUMBER / MIXED_TYPE），parse 与 confirm 共用 |

### 4.2 存储层

| 模块 | 职责 |
|------|------|
| `lib/store.ts` | 文件型存储，原子写入（`saveJsonAtomic`），三文件拆分（meta / rows / analyses），旧数据自动迁移 |
| `lib/schemas/dataset.ts` | Dataset ID（UUID）、ColumnMeta、FieldConfig、DataQualityReport 的 Zod 校验 |

### 4.3 确定性分析引擎（`lib/analysis/`）

所有数值计算在此完成，LLM 不得介入。

| 子模块 | 职责 |
|--------|------|
| `aggregation.ts` | `resolveAggregation`（用户设置→格式→类型默认）+ `isAllowedAgg` 拦截非法组合 + `aggregate` 计算（SPEC 8 单一入口） |
| `statistics.ts` | 基础统计：count/sum/avg/min/max/median/P25/P75/std/零值/负值 |
| `profile.ts` | 字段画像：角色识别、去重数、空值率、低基数判定 |
| `trends.ts` | 时间趋势：粒度选择（日/周/月）、首末期变化、变化率（分母为 0 保护） |
| `comparisons.ts` | 分组对比：按主维度聚合、Top10、agg 选择（percentage=avg, currency=sum） |
| `outliers.ts` | IQR 异常值：Q1-1.5×IQR / Q3+1.5×IQR，样本<8 跳过，最多 5 个样本 |
| `evidence.ts` | 证据构造：7 种 method 的 AnalysisEvidence 预构造器 |
| `recommend-charts.ts` | 图表推荐 + 8 条语义校验 + pie 降级 + TopN + 局部容错 + 排序 |
| `index.ts` | `runLocalAnalysis` 总入口，组装 evidence + ComputedInsight |

### 4.4 LLM 改造层

| 模块 | 职责 |
|------|------|
| `lib/llm-config.ts` | `getActiveLLMConfig`：settings→env→默认 单一入口，`enabled` 以最终 apiKey 计算（SPEC 6） |
| `lib/llm-prompt.ts` | `SYSTEM_PROMPT`（7 条约束）+ `buildLLMInput`（7 区块不含原始数据）+ `LLMInterpretationSchema` |
| `lib/llm.ts` | `chatJSON`（30s 超时）+ `streamChat`（60s 超时）+ think 标签过滤，统一走 `getActiveLLMConfig` |
| `lib/analyzer.ts` | 编排：本地先算 → `onStructured` → LLM 仅解读 → `renamedChartTitles` → 分段 narrative → `onFinal` → 失败回退 local |

**provider 语义**（v0.2.1 统一）：
- `local`：纯本地计算，无 LLM。
- `local+llm`：本地计算 + LLM 解读成功。
- 旧缓存的 `mock / llm` 在读取时自动迁移为上述两值。

### 4.5 图表层

| 模块 | 职责 |
|------|------|
| `lib/chart.ts` | `buildChartOption`：ChartSpec + rows → ECharts option，支持 TopN 截断（bar/pie）、主题色读取 |
| `lib/schemas/chart.ts` | `ChartSpecSchema`（agg 必填）+ `validateChartSpec` + `filterValidCharts` |

---

## 5. 关键约束

- **不发原始数据给 LLM**：`buildLLMInput` 只发结构化摘要、字段定义、evidence、图表列表，不含原始行。
- **LLM 不得修改计算**：只能改 `renamedChartTitles`，不能改 xField/yField/agg/数值。
- **evidence 强制引用**：每条 `ComputedInsight` 必须引用有效 `evidenceId`。
- **原子写入**：所有持久化经 `saveJsonAtomic`（写临时文件 → rename）。
- **Dataset ID 校验**：所有入口用 `isValidDatasetId`（UUID）统一校验。
- **超时回退**：LLM 任何步骤失败都保留本地结果，看板始终可用。

---

## 6. 测试与 CI

- 测试框架：Vitest 1.6，`@` 别名，DATA_DIR 隔离。
- 测试覆盖：parse / normalize / field-config / store / analysis / chart-engine / analyzer / chart / heartbeat，以及 v0.2.1 新增的 llm-config / reconfigure-normalization / aggregation-flow / sse-final / type-sampling / dataset-state / migration-recovery（共 17 文件 288 用例）。
- CI：`.github/workflows/ci.yml` 执行 `typecheck` + `test` + `build`（等价 `npm run check`）。
- 测试 `fileParallelism=false`：共享临时 DATA_DIR，串行避免文件系统竞态。
- 每阶段改造后必须三件套全绿。
