# DESIGN.md — Date-Tool · 液态玻璃设计系统

> 主题代号 **"Verdigris"**（铜绿）  
> 设计参考核心：**Liquid Glass Material × 博物馆级低饱和奢华调性**  
> 配色三原色：`#1F4A48`（深青墨绿）/ `#C9A87C`（古铜金）/ `#F5F1EB`（米白）

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

**设计哲学**：把"博物馆陈列柜里的青铜器"搬进浏览器。低饱和、高质感、有重量。**完全告别 AI 默认蓝紫渐变**。

- **视觉基调**：深邃、克制、有手感的"老钱 + 实验室"质感
- **核心关键词**：`#liquid-glass` `#verdigris-patina` `#museum-warmth` `#soft-clay` `#refracted-edge`
- **光影与质感倾向**：
  - **毛玻璃**为主，叠加 `saturate(180%)` 增强背景渗透
  - **双层边框**：内 1px 米白高光（`rgba(245,241,235,0.18)`） + 外 1px 深绿描边（`rgba(31,74,72,0.4)`）
  - **液体边缘**：用 `border-radius: 24px` + 不对称圆角（`28px 20px 24px 22px`）制造有机的、像融化玻璃的轮廓
  - **微反射**：每个玻璃面顶部一道 1px 渐变高光线（`linear-gradient(180deg, rgba(245,241,235,0.12) 0%, transparent 50%)`）
  - **古铜金辉光**：交互态用极淡的金色发光 `0 0 0 1px rgba(201,168,124,0.4), 0 8px 24px rgba(201,168,124,0.18)`

---

## 2. Color Palette & Roles（调色板与角色）

### 2.1 Primary Colors（主色）

| 变量 | HEX | 角色 |
|------|-----|------|
| `--color-verdigris-900` | `#0F2A29` | 最深处背景（页面之外的角落） |
| `--color-verdigris-800` | `#1F4A48` | **品牌主色 · 页面主背景** |
| `--color-verdigris-700` | `#2D5F5C` | 背景渐变中段 / hover 底色 |
| `--color-verdigris-600` | `#3F7570` | 浅墨绿点缀 |

### 2.2 Brand & Dark Variants（品牌 & 深色变体）

| 变量 | HEX | 角色 |
|------|-----|------|
| `--brand` | `#1F4A48` | 品牌主色 |
| `--brand-deep` | `#0F2A29` | 深背景层 |
| `--brand-bright` | `#2D5F5C` | 品牌色提亮 |

### 2.3 Accent / Interactive（强调 & 交互色 · 古铜金）

| 变量 | HEX | 角色 |
|------|-----|------|
| `--accent` | `#C9A87C` | **古铜金 · 主强调色** |
| `--accent-bright` | `#DCBE92` | 金色高光（hover / 焦点） |
| `--accent-deep` | `#A88560` | 金色暗调（active 态） |

### 2.4 Neutral / Gray Scale（中性灰阶 · 米白系）

| 变量 | HEX | 角色 |
|------|-----|------|
| `--text` | `#F5F1EB` | **主文字色 · 米白** |
| `--text-dim` | `rgba(245, 241, 235, 0.72)` | 次级文字 |
| `--text-faint` | `rgba(245, 241, 235, 0.45)` | 三级文字 / 占位 |
| `--text-ghost` | `rgba(245, 241, 235, 0.18)` | 极弱文字 / 分隔线 |

### 2.5 Surface & Borders（玻璃表面 & 边框）

| 变量 | rgba | 角色 |
|------|------|------|
| `--glass-1` | `rgba(245, 241, 235, 0.04)` | 最浅玻璃（hover 态微变） |
| `--glass-2` | `rgba(245, 241, 235, 0.07)` | **标准玻璃面 · 卡片/容器** |
| `--glass-3` | `rgba(245, 241, 235, 0.10)` | 高层级玻璃（modal/dropdown） |
| `--glass-overlay` | `rgba(15, 42, 41, 0.55)` | 深色遮罩层 |
| `--glass-rim` | `rgba(245, 241, 235, 0.16)` | 玻璃内高光边框 |
| `--glass-rim-outer` | `rgba(31, 74, 72, 0.55)` | 玻璃外深色描边 |
| `--glass-highlight` | `linear-gradient(180deg, rgba(245,241,235,0.14) 0%, rgba(245,241,235,0) 50%)` | 顶部反光线 |

### 2.6 Semantic Colors（语义色）

| 变量 | HEX | 角色 |
|------|-----|------|
| `--success` | `#7FB89A` | 成功（淡祖母绿，不刺眼） |
| `--warning` | `#D4A574` | 警告（淡焦糖金） |
| `--danger` | `#C97A6E` | 错误（淡陶土红，低饱和） |
| `--info` | `#8FB0AD` | 信息（淡灰青） |

### 2.7 Shadow Colors（阴影色 · 含 rgba）

| 变量 | rgba | 角色 |
|------|------|------|
| `--shadow-deep` | `rgba(8, 22, 21, 0.55)` | 主投影（卡片悬浮） |
| `--shadow-near` | `rgba(8, 22, 21, 0.35)` | 近距离阴影（按钮按下） |
| `--shadow-glow-gold` | `rgba(201, 168, 124, 0.28)` | 金色辉光（按钮 hover） |
| `--shadow-inner-light` | `rgba(245, 241, 235, 0.06)` | 玻璃内顶光 |

---

## 3. Typography Rules（排版规则）

### 3.1 Font Family（字体族）

```css
--font-display: "Cormorant Garamond", "Source Han Serif SC", "Songti SC",
                "Noto Serif SC", Georgia, "Times New Roman", serif;
--font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC",
             "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI",
             "Helvetica Neue", sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "Cascadia Code",
             Consolas, "Liberation Mono", monospace;
```

- **正文 / UI**：`--font-sans`（系统字体栈，免下载）
- **标题 / 品牌名**：`--font-display`（衬线字体，注入博物馆气质）
- **数字 / 表格**：`--font-mono`（等宽，对齐数字）

### 3.2 Type Scale（完整排版层级）

| 级别 | Size | Weight | Line Height | Letter Spacing | 字体 | 用途 |
|------|------|--------|-------------|----------------|------|------|
| `display-hero` | 48px / 3rem | 600 | 1.15 | -0.02em | serif | 落地页 H1 |
| `display-lg` | 36px / 2.25rem | 600 | 1.2 | -0.015em | serif | 区块大标题 |
| `h1` | 28px / 1.75rem | 600 | 1.25 | -0.01em | sans | 页面主标题 |
| `h2` | 22px / 1.375rem | 600 | 1.3 | -0.005em | sans | 卡片标题 |
| `h3` | 18px / 1.125rem | 600 | 1.4 | 0 | sans | 子区块标题 |
| `body-lg` | 16px / 1rem | 400 | 1.6 | 0 | sans | 正文大号 |
| `body` | 14.5px / 0.906rem | 400 | 1.65 | 0 | sans | 正文 |
| `body-sm` | 13px / 0.8125rem | 400 | 1.55 | 0.005em | sans | 辅助文字 |
| `caption` | 12px / 0.75rem | 500 | 1.4 | 0.04em | sans | 说明 / 标签 |
| `overline` | 11px / 0.6875rem | 600 | 1.3 | 0.18em | sans | 大写小标 |
| `mono-num` | 14px / 0.875rem | 500 | 1.5 | 0 | mono | 数字 / 表格 |
| `nano` | 10.5px / 0.656rem | 500 | 1.3 | 0.05em | sans | 极小标注 |

### 3.3 设计哲学

- **正文用 sans**：可读性优先，避免衬线在小字号下"闪烁"
- **标题用 serif**：克制地使用，注入温度与重量感（仅 H1 / Display 级别）
- **行高 1.6-1.7**：宽松呼吸，符合中文阅读节奏
- **字距**：正文 0，标题负值（收紧），小标 / overline 正值（拉开）
- **数字用 mono**：表格、统计数字对齐，制造"实验室"专业感

---

## 4. Component Stylings（组件样式）

### 4.1 Buttons（按钮）

#### Primary（金色玻璃按钮 · 主操作）

```css
.btn-primary {
  background: linear-gradient(180deg, rgba(201, 168, 124, 0.95) 0%, rgba(168, 133, 96, 0.95) 100%);
  color: #0F2A29;
  border: 1px solid rgba(245, 241, 235, 0.28);
  border-radius: 12px;
  padding: 11px 22px;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  box-shadow:
    inset 0 1px 0 rgba(245, 241, 235, 0.35),
    inset 0 -1px 0 rgba(8, 22, 21, 0.2),
    0 6px 20px rgba(8, 22, 21, 0.35),
    0 0 0 1px rgba(201, 168, 124, 0.2);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.btn-primary:hover {
  background: linear-gradient(180deg, rgba(220, 190, 146, 0.98) 0%, rgba(201, 168, 124, 0.98) 100%);
  box-shadow:
    inset 0 1px 0 rgba(245, 241, 235, 0.45),
    0 8px 28px rgba(8, 22, 21, 0.45),
    0 0 0 1px rgba(220, 190, 146, 0.5),
    0 0 24px rgba(201, 168, 124, 0.28);
  transform: translateY(-1px);
}
.btn-primary:active {
  transform: translateY(0);
  box-shadow:
    inset 0 1px 0 rgba(245, 241, 235, 0.2),
    inset 0 2px 4px rgba(8, 22, 21, 0.25),
    0 2px 8px rgba(8, 22, 21, 0.4);
}
```

#### Secondary（次级玻璃按钮）

```css
.btn {
  background: rgba(245, 241, 235, 0.06);
  color: var(--text);
  border: 1px solid var(--glass-rim);
  border-radius: 12px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 500;
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  box-shadow:
    inset 0 1px 0 rgba(245, 241, 235, 0.12),
    0 4px 14px rgba(8, 22, 21, 0.28);
  transition: all 0.2s ease;
}
.btn:hover {
  background: rgba(245, 241, 235, 0.10);
  border-color: rgba(201, 168, 124, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(245, 241, 235, 0.18),
    0 6px 20px rgba(8, 22, 21, 0.4),
    0 0 0 1px rgba(201, 168, 124, 0.18);
}
```

#### Ghost（幽灵按钮）

```css
.btn-ghost {
  background: transparent;
  border: 1px solid rgba(245, 241, 235, 0.12);
  color: var(--text-dim);
  padding: 8px 14px;
}
.btn-ghost:hover {
  color: var(--accent);
  border-color: var(--accent);
}
```

#### Danger（危险操作 · 陶土红）

```css
.btn-danger {
  background: rgba(201, 122, 110, 0.12);
  color: #E8A89C;
  border: 1px solid rgba(201, 122, 110, 0.35);
}
.btn-danger:hover {
  background: rgba(201, 122, 110, 0.22);
}
```

### 4.2 Cards（玻璃卡片 · 容器）

```css
.card {
  position: relative;
  background: var(--glass-2);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-radius: 22px;
  border: 1px solid var(--glass-rim);
  padding: 24px;
  box-shadow:
    inset 0 1px 0 rgba(245, 241, 235, 0.10),
    0 12px 40px rgba(8, 22, 21, 0.42),
    0 2px 6px rgba(8, 22, 21, 0.25);
  overflow: hidden;
}
.card::before {
  /* 顶部反光线 */
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 50%;
  background: linear-gradient(180deg, rgba(245, 241, 235, 0.10) 0%, rgba(245, 241, 235, 0) 100%);
  pointer-events: none;
  border-radius: 22px 22px 50% 50% / 22px 22px 24px 24px;
}
```

### 4.3 Inputs（输入框 · 玻璃质感）

```css
.input {
  background: rgba(245, 241, 235, 0.04);
  border: 1px solid var(--glass-rim);
  border-radius: 12px;
  padding: 11px 14px;
  color: var(--text);
  font-size: 14px;
  backdrop-filter: blur(8px);
  transition: all 0.2s ease;
}
.input::placeholder { color: var(--text-faint); }
.input:focus {
  outline: none;
  border-color: var(--accent);
  background: rgba(245, 241, 235, 0.08);
  box-shadow:
    inset 0 1px 0 rgba(245, 241, 235, 0.12),
    0 0 0 3px rgba(201, 168, 124, 0.18);
}
```

### 4.4 Dropzone（拖拽上传区 · 液态玻璃框）

```css
.dropzone {
  position: relative;
  background: rgba(245, 241, 235, 0.03);
  border: 1.5px dashed rgba(201, 168, 124, 0.45);
  border-radius: 20px;
  padding: 56px 28px;
  text-align: center;
  backdrop-filter: blur(16px) saturate(150%);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.dropzone::before {
  /* 液体流动高光 */
  content: "";
  position: absolute;
  top: -50%;
  left: -10%;
  right: -10%;
  height: 80%;
  background: radial-gradient(ellipse at center, rgba(201, 168, 124, 0.10) 0%, transparent 60%);
  pointer-events: none;
  animation: liquidFloat 8s ease-in-out infinite;
}
@keyframes liquidFloat {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(20px, -10px) scale(1.05); }
}
.dropzone.drag {
  border-color: var(--accent);
  background: rgba(201, 168, 124, 0.10);
  transform: scale(1.01);
  box-shadow:
    inset 0 1px 0 rgba(245, 241, 235, 0.18),
    0 0 0 4px rgba(201, 168, 124, 0.12),
    0 16px 48px rgba(8, 22, 21, 0.5);
}
```

### 4.5 Badges / Tags（徽章 · 玻璃药丸）

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  background: rgba(127, 184, 154, 0.14);
  color: #B6D4C2;
  border: 1px solid rgba(127, 184, 154, 0.32);
  backdrop-filter: blur(8px);
}
.badge.muted {
  background: rgba(245, 241, 235, 0.05);
  color: var(--text-dim);
  border-color: rgba(245, 241, 235, 0.12);
}
```

### 4.6 Spinner（旋转指示器）

```css
.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(201, 168, 124, 0.18);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

### 4.7 Banners（提示条）

```css
.banner {
  border-radius: 14px;
  padding: 14px 16px;
  font-size: 13.5px;
  line-height: 1.55;
  backdrop-filter: blur(14px);
}
.banner.warn {
  background: rgba(212, 165, 116, 0.12);
  border: 1px solid rgba(212, 165, 116, 0.32);
  color: #E2C49C;
}
.banner.error {
  background: rgba(201, 122, 110, 0.12);
  border: 1px solid rgba(201, 122, 110, 0.32);
  color: #E8A89C;
}
```

### 4.8 Table（数据表 · 玻璃）

```css
.table-wrap {
  background: rgba(15, 42, 41, 0.32);
  border-radius: 14px;
  border: 1px solid var(--glass-rim);
  overflow: auto;
  backdrop-filter: blur(14px);
}
table.data th {
  background: rgba(245, 241, 235, 0.06);
  color: var(--text-dim);
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border-bottom: 1px solid var(--glass-rim);
}
table.data td {
  border-bottom: 1px solid rgba(245, 241, 235, 0.04);
  font-family: var(--font-mono);
  font-size: 13px;
}
table.data tr:hover td {
  background: rgba(201, 168, 124, 0.05);
}
```

---

## 5. Layout Principles（布局原则）

### 5.1 Spacing System（间距系统 · 4px 基线）

```css
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
--space-24: 96px;
```

### 5.2 Grid System（栅格）

- **桌面端**：12 列，列宽 `minmax(0, 1fr)`，列间距 `--space-6 (24px)`
- **容器**：`max-width: 1240px`，左右 padding `--space-6`
- **断点（图表/卡片网格）**：
  - `grid-3`: `repeat(auto-fill, minmax(360px, 1fr))`（图表卡片）
  - `grid-2`: `repeat(2, 1fr)`
- **移动端**：单列堆叠

### 5.3 Section Spacing（区块间距）

- 页面顶部：`--space-12 (48px)`
- 区块之间：`--space-10 (40px)`
- 卡片内部：`--space-6 (24px)`
- 表单字段之间：`--space-4 (16px)`

### 5.4 留白哲学

**"重质不重量"**。每个区块都有充分呼吸空间，避免密集堆叠。卡片之间至少 24px，卡片内部 padding 不少于 20px。让眼睛有"走进博物馆展厅"的从容感，而不是"挤进地铁"的紧迫感。

---

## 6. Depth & Elevation（深度与层级）

### 6.1 Shadow System（阴影系统）

```css
--shadow-xs: 0 1px 2px rgba(8, 22, 21, 0.18);
--shadow-sm: 0 2px 6px rgba(8, 22, 21, 0.25);
--shadow-md:
  0 4px 14px rgba(8, 22, 21, 0.32),
  0 1px 2px rgba(8, 22, 21, 0.20);
--shadow-lg:
  0 12px 40px rgba(8, 22, 21, 0.42),
  0 2px 6px rgba(8, 22, 21, 0.25);
--shadow-xl:
  0 24px 60px rgba(8, 22, 21, 0.55),
  0 6px 16px rgba(8, 22, 21, 0.35),
  inset 0 1px 0 rgba(245, 241, 235, 0.10);
--shadow-2xl:
  0 40px 100px rgba(8, 22, 21, 0.65),
  0 10px 30px rgba(8, 22, 21, 0.40),
  inset 0 1px 0 rgba(245, 241, 235, 0.14);
--shadow-glow-gold:
  0 0 0 1px rgba(201, 168, 124, 0.35),
  0 8px 32px rgba(201, 168, 124, 0.22);
--shadow-inset-light:
  inset 0 1px 0 rgba(245, 241, 235, 0.18),
  inset 0 -1px 0 rgba(8, 22, 21, 0.12);
```

### 6.2 Surface Layers（表面层级）

| 层级 | 变量 | 用途 |
|------|------|------|
| **Layer 0 · Background** | `--brand-deep` | 页面底色（径向渐变中心外） |
| **Layer 1 · Surface** | `--brand` | 页面主背景（径向渐变中心） |
| **Layer 2 · Elevated** | `--glass-2` | 卡片 / 容器 |
| **Layer 3 · High Elevated** | `--glass-3` | Dropdown / Modal |
| **Layer 4 · Overlay** | `--glass-overlay` | 遮罩层 |

### 6.3 Z-index Scale（层级数值）

```css
--z-base:    0;
--z-raised:  10;
--z-sticky:  100;
--z-dropdown: 1000;
--z-modal-backdrop: 1500;
--z-modal:   2000;
--z-toast:   3000;
--z-tooltip: 4000;
```

### 6.4 Backdrop Effects（背景特效）

```css
--blur-sm: blur(8px);
--blur-md: blur(14px) saturate(160%);
--blur-lg: blur(20px) saturate(180%);
--blur-xl: blur(28px) saturate(200%);
```

---

## 7. Do's and Don'ts（设计规范与禁忌）

### 7.1 Do's（推荐）

1. ✅ **背景使用径向渐变**：`radial-gradient(ellipse at 30% 0%, #2D5F5C 0%, #1F4A48 40%, #0F2A29 100%)`，制造"光从左上方洒落"的博物馆射灯感
2. ✅ **所有容器加 backdrop-filter**：哪怕是 6% 透明度，也要让背景渗透进来，形成层次
3. ✅ **金色只用作品牌强调**：不要用它做大面积背景或装饰，只用于主按钮、链接、关键数据
4. ✅ **数字用等宽字体**：表格、统计、KPI 都用 mono，制造专业感
5. ✅ **标题用衬线字体**：H1 / Display 级别用 serif 注入温度
6. ✅ **不对称圆角制造"融化感"**：`border-radius: 22px 18px 24px 20px` 比统一 22px 更有手作温度
7. ✅ **hover 用金色辉光**：`box-shadow: 0 0 24px rgba(201, 168, 124, 0.25)`
8. ✅ **保留微弱噪点**（可选）：背景叠加 `background-image: url("data:image/svg+xml,...")` 0.02 opacity 的颗粒感

### 7.2 Don'ts（禁忌）

1. ❌ **不要用蓝紫色渐变**（紫罗兰 / 霓虹蓝 / 赛博粉）—— 这就是"AI 味"的根源
2. ❌ **不要用 emoji 作为 logo 或装饰元素**（除非是内容语义上的）
3. ❌ **不要让 glass surface 完全不透明** —— 必须保留 4-10% 透明度，否则失去玻璃感
4. ❌ **不要让文字直接压在背景上不包裹玻璃面** —— 必须用 card 容器
5. ❌ **不要用纯黑阴影** —— 阴影色统一用 `rgba(8, 22, 21, ...)`（带绿调），与背景色相协调
6. ❌ **不要让按钮圆角超过 padding 的一半太多** —— 12px 圆角配 22px 高度是最佳比例
7. ❌ **不要使用 box-shadow 直接做"内发光"** —— 内发光用 `inset 0 1px 0` 浅色高光更克制
8. ❌ **不要堆砌 3 层以上 backdrop-filter** —— 浏览器性能会爆，每个独立玻璃面最多 1 层

---

## 8. Responsive Behavior（响应式行为）

### 8.1 Breakpoints（断点）

| 断点 | 范围 | 容器 max-width | 卡片列数 |
|------|------|----------------|----------|
| **Mobile** | `< 640px` | 100% - 32px | 1 列 |
| **Tablet** | `640px - 1024px` | 720px | 1-2 列 |
| **Desktop** | `1024px - 1440px` | 1180px | 2-3 列 |
| **Wide** | `> 1440px` | 1240px | 3-4 列 |

```css
@media (max-width: 640px) {
  .container { padding: 20px 16px 60px; }
  .card { padding: 18px; border-radius: 18px; }
  .topbar { flex-direction: column; align-items: flex-start; }
  .grid-3 { grid-template-columns: 1fr; }
  h1 { font-size: 24px; }
}
```

### 8.2 Touch Targets（触摸目标）

- **最小尺寸**：44px × 44px（按钮 / 可点击元素）
- **按钮高度**：桌面 38px / 移动 44px
- **数据行高度**：≥ 44px（移动端）

### 8.3 折叠策略

- **Topbar**：桌面横向，移动端垂直堆叠
- **Brand + 操作按钮**：桌面同行，移动端分两行
- **图表网格**：桌面 3 列 → 平板 2 列 → 移动 1 列
- **导航**：当前无 nav，未来若有：桌面顶栏 / 移动汉堡菜单

### 8.4 Font Scaling（字体缩放）

- 桌面端按上述 Type Scale 执行
- 移动端：Display -25%、H1 -15%、Body 不变
- 通过 CSS `clamp()` 实现流体排版：

```css
h1 { font-size: clamp(22px, 2.5vw, 28px); }
.display-hero { font-size: clamp(32px, 4.5vw, 48px); }
```

---

## 9. Agent Prompt Guide（AI 代理提示指南）

### 9.1 Quick Reference（快速参考）

**核心三色**：`#1F4A48`（深青墨绿 · 背景）/ `#C9A87C`（古铜金 · 强调）/ `#F5F1EB`（米白 · 表面+文字）

**核心材质**：双层玻璃 = `backdrop-filter: blur(20px) saturate(180%)` + `rgba(245, 241, 235, 0.07)` 背景 + `inset 0 1px 0 rgba(245,241,235,0.18)` 顶部高光 + 多层深色阴影

**核心字体**：sans 正文 + serif 标题 + mono 数字

**核心禁忌**：❌ 蓝紫渐变 ❌ 纯黑阴影 ❌ 不透明卡片 ❌ emoji 装饰

### 9.2 Component Prompts（可直接使用的 Prompt 示例）

**Prompt 1 · 创建玻璃卡片**
```
基于 DESIGN.md Verdigris 主题，创建一个 GlassCard 组件。
- 背景：rgba(245, 241, 235, 0.07)
- backdrop-filter: blur(24px) saturate(180%)
- 圆角：22px
- 边框：1px solid rgba(245, 241, 235, 0.16)
- 阴影：0 12px 40px rgba(8, 22, 21, 0.42), inset 0 1px 0 rgba(245, 241, 235, 0.10)
- 顶部 ::before 伪元素叠加 linear-gradient(180deg, rgba(245,241,235,0.10), transparent 50%) 高光
- 内容 padding: 24px
```

**Prompt 2 · 创建金色玻璃按钮**
```
创建一个 PrimaryButton，符合 Verdigris 主题。
- 背景：linear-gradient(180deg, #C9A87C, #A88560)
- 文字色：#0F2A29，字重 600
- 圆角：12px，padding：11px 22px
- backdrop-filter: blur(14px) saturate(160%)
- 阴影：inset 0 1px 0 rgba(245,241,235,0.35) + 0 6px 20px rgba(8,22,21,0.35) + 0 0 0 1px rgba(201,168,124,0.2)
- hover：金色辉光 + translateY(-1px)
```

**Prompt 3 · 创建数据仪表 KPI 卡片**
```
创建一个 KPI 卡片（数字大、标签小、趋势箭头）。
- 玻璃材质（同 GlassCard）
- 大数字：48px serif, color: #C9A87C, font-weight: 600
- 标签：11px uppercase letter-spacing: 0.18em, color: rgba(245,241,235,0.45)
- 趋势箭头：上升用 #7FB89A，下降用 #C97A6E
- hover 时整张卡片 translateY(-2px) 并添加金色辉光
```

**Prompt 4 · 创建拖拽上传区**
```
创建一个 FileDropzone 组件。
- 边框：1.5px dashed rgba(201, 168, 124, 0.45)
- 背景：rgba(245, 241, 235, 0.03)
- backdrop-filter: blur(16px) saturate(150%)
- padding: 56px 28px
- ::before 伪元素叠加 radial-gradient 金色光晕，8s ease-in-out 无限浮动动画
- 拖拽态：边框变金色、背景加深、scale(1.01)
```

**Prompt 5 · 重构暗色蓝紫界面为 Verdigris 主题**
```
将以下界面从 [原品牌] 暗色蓝紫渐变风格重构为 Verdigris 液态玻璃主题：
1. 替换所有蓝紫 hex 为 #1F4A48（背景）/ #C9A87C（强调）/ #F5F1EB（文字）
2. 所有 .card 类加 backdrop-filter: blur(20px) saturate(180%)
3. 所有边框色改为 rgba(245, 241, 235, 0.16)
4. 所有阴影改为 rgba(8, 22, 21, ...) 系列（带绿调，不是纯黑）
5. 主按钮改为金色渐变玻璃
6. 添加 inset 顶部高光制造玻璃折射感
7. H1 标题改为 serif 字体（Cormorant Garamond / Songti SC）
8. 数字改为 JetBrains Mono / SF Mono
```

**Prompt 6 · 创建图表卡片（ECharts）**
```
基于 Verdigris 主题创建 ChartCard 包装 ECharts。
- 玻璃卡片（同 GlassCard），padding：20px
- 标题：18px sans-serif 600，color: #F5F1EB
- 副标题：12.5px，color: rgba(245, 241, 235, 0.72)
- ECharts 配置：背景透明、网格线 rgba(245,241,235,0.06)、轴文字 rgba(245,241,235,0.72)、数据色板 [#C9A87C, #7FB89A, #8FB0AD, #D4A574]
- 图表高度：300px
```

### 9.3 Iteration Guide（迭代建议）

1. **从背景开始**：先定径向渐变背景，所有玻璃面才有东西可"透"
2. **玻璃材质先于配色**：先把 backdrop-filter + 高光 + 阴影做对，再调颜色
3. **金色不要超过 5% 视觉占比**：用作重点提示而非装饰
4. **测试饱和度**：在 `prefers-reduced-transparency` 下备好纯色 fallback
5. **保留所有原始 CSS 变量名**：现有组件不需要改一行 .tsx 即可升级
6. **阴影必须带绿调**：纯黑阴影会立刻"出戏"
7. **圆角分两类**：大容器 22px、小元素 12px、徽章 999px
8. **数字用 mono**：表格、统计、KPI 一律用等宽字体
9. **标题用 serif**：仅 H1 / Display 级别，正文保持 sans
10. **噪点可选**：背景叠 `background-image: url(data:image/svg+xml;base64,...)` 极淡噪点可提升质感但牺牲性能，按需开启

---

**规格版本**：v1.0  
**适用项目**：Date-Tool（企微托管运营 · 可视化数据仪表）  
**参考气质**：博物馆 × 古铜器 × 实验室