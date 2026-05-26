# v1 UI 全量重做 — 蓝白硅谷大厂风 Shell + 模块

## Goal

把腾域 aipod 客户端从"未完工 admin 模板"质感重做成统一的「蓝白 + 硅谷大厂工具」视觉语言，覆盖 4 步 Onboarding + 6 个模块面板 + 整套 chrome（sidebar / header）。本次只做亮色，design tokens 用 CSS variables 留好暗色钩子。

**为什么现在做**：v1 切片 0-8 代码层归档完成，准备主理人本机跑通后发 v1.0.0；当前 UI 不合格会拉低首次正式发布的口碑。

---

## Decisions Locked (Grill Phase Output)

| # | 决策项 | 选择 |
|---|---|---|
| 1 | 范围 | 全量重做（Onboarding 4 步 + 6 模块面板 + chrome） |
| 2 | Layout | 左 sidebar（可折叠 180px ↔ 60px）+ 顶 header |
| 3 | 视觉调性 | 硅谷大厂蓝白（Linear / Stripe Dashboard 路线） |
| 4 | 文案 | 中文极简、无英文裸露 |
| 5 | 暗色模式 | v1 只做亮色，CSS variables 留 `[data-theme="dark"]` 钩子 |
| 6 | 信息密度 | 标准（一屏 8-12 行表格） |
| 7 | 主蓝色 | `#2563eb` (Tailwind blue-600) |
| 8 | 字体 | 英文 Inter + 中文思源黑体 / Noto Sans SC，自带打包 ~2MB |
| 9 | 实施 | 单 PR 一锅出（Codex 隔壁终端 ~8-10 天） |
| 10 | Sidebar | 默认展开 180px，可折叠成 icon-only 60px，状态持久化 |

---

## What I already know (Codebase Inspection)

### 现状代码规模

- `App.tsx`: **1932 行**（巨型单文件，6 模块 + Onboarding 4 步全塞一起）
- `generation-workbench.tsx`: 2125 行
- `detection-workbench.tsx`: 1043 行
- `listing-workbench.tsx`: 967 行
- `detection-settings-panel.tsx`: 617 行
- **合计 6684 行**前端代码要重构

### 现状基础设施

- **shadcn 已装组件**：`accordion`、`button`（仅 2 个）
- **index.css**：已有 HSL CSS variables 框架（shadcn 风），但只定义了 background/foreground/primary/muted/border 5 组
- **tailwind.config.ts**：空配置（`theme.extend: {}`），CSS variables 没接进 tailwind theme
- **字体**：声明了 Inter 字体族但没自带 font 文件，中文 fallback 系统
- **窗口最小尺寸**：1100×700px（body min-width/min-height）
- **路由**：装了 `react-router-dom` 但实际没用，6 模块用 `useState<WorkbenchModule>` 切换
- **状态**：`zustand` 已在用（`useActivationStore`）

### 现状视觉问题清单

1. 没有 design tokens（颜色直接硬编码 emerald-50 / amber-200 / zinc 各种 hex）
2. 字体走系统 fallback，跨平台不一致
3. Tabs 当导航用（顶部 6 个 Button），没分隔、没选中下划线
4. 卡片全是手写 `rounded-md border`，圆角/阴影/padding 散乱
5. 信息层级混乱：「Workbench / 腾域 aipod / 模块名 / 模块描述」四层标题挤在 header + page 顶部
6. 「版本 0.0.0」单独一个 card 框，权重比正文还重
7. 英文裸露：`Workbench`、`Step 1/4`、`fit/auto/all/top` 等
8. 没有统一的 Empty / Loading / Error 状态组件

---

## Assumptions (To Validate)

- 思源黑体 / Noto Sans SC 走 Google Fonts 静态文件自带，规避 CDN（Electron 离线可用）
- 单 PR 但内部多 commit，让 Codex 有节奏地推进
- 复用现有 zustand 模式存 sidebar 折叠状态
- 现有 IPC / business logic 全部保留不动，只重写视图层

---

## Requirements (Evolving)

### 视觉系统（Design Tokens — Locked）

#### 颜色

- **Primary blue**: `#2563eb` (Tailwind blue-600)
- **Neutral**: **slate 系列** (冷蓝灰)，背景 / 文字 / border 全部走 slate
- **Status（统一 -600 主色 + -50/100 浅底 + -200 border）**：
  - success: `emerald-600 #059669` / bg `emerald-50` / border `emerald-200`
  - warning: `amber-600 #d97706` / bg `amber-50` / border `amber-200`
  - danger: `red-600 #dc2626` / bg `red-50` / border `red-200`
  - info: 直接用 primary blue（不另设）

#### CSS Variables 命名（shadcn 风，亮色 `:root` + 留 `[data-theme="dark"]` 钩子）

```
--background, --foreground
--primary, --primary-foreground
--secondary, --secondary-foreground
--muted, --muted-foreground
--accent, --accent-foreground
--destructive, --destructive-foreground
--border, --input, --ring
--card, --card-foreground
--popover, --popover-foreground
```

#### 字号 / 行高（baseline 14px）

| token | px | line-height | 用途 |
|---|---|---|---|
| `text-xs` | 11 | 16 | 极辅助（版本号、标签） |
| `text-sm` | 13 | 18 | 次级信息（meta、placeholder） |
| `text-base` | 14 | 22 | **正文 baseline** |
| `text-lg` | 16 | 24 | 强调段落 |
| `text-xl` | 18 | 28 | 卡片标题 |
| `text-2xl` | 22 | 30 | 模块大标题 |
| `text-3xl` | 28 | 36 | Onboarding 主标题 |

字重：400（正文）/ 500（强调）/ 600（标题）；不用 700+。

#### 字体（自带打包）

- **英文 / 数字**：Inter（variable font，latin subset，~50KB）
- **中文**：思源黑体 / Noto Sans SC（Regular 400 / Medium 500 / SemiBold 600，zh-CN subset，~1.5MB）
- 文件放 `packages/client/src/renderer/public/fonts/`，CSS `@font-face` + `font-display: swap` + `<link rel="preload">`
- `font-family: Inter, "Noto Sans SC", "PingFang SC", system-ui, sans-serif;`（中英 fallback）

#### 圆角

- `--radius-sm` (input/button/badge): **6px**
- `--radius-md` (card/dialog/dropdown): **8px**
- `--radius-lg` (hero/modal): **12px**
- `--radius-full` (pill/avatar): 9999px

#### 间距 (Tailwind 默认 scale)

4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64

#### Layout 原则（重要）

**核心 CTA 必须首屏可见**：在 1100×700 最小窗口下，主操作按钮（开始采集 / 开始生成标题 / 开始检测 / 开始套版 / 开始上架）**永远不需要滚动**就能点到。实现方式：

- 模块顶部 header 区右侧放主 CTA（如采集 idle 态）
- 或右侧 sticky aside 放预估 + CTA + 进度（如标题生成）
- 配置区用 2 列 grid（横向）而不是 1 列堆栈
- 高级参数默认折叠

#### 阴影（极淡，硅谷大厂风不强调投影）

- `shadow-xs`: `0 1px 2px 0 rgb(0 0 0 / 0.04)` （input focus / hover）
- `shadow-sm`: `0 1px 3px 0 rgb(0 0 0 / 0.06)` （card 默认）
- `shadow-md`: `0 4px 6px -1px rgb(0 0 0 / 0.08)` （dropdown / popover）
- `shadow-lg`: `0 10px 15px -3px rgb(0 0 0 / 0.10)` （dialog）

#### 动画 timing

- `duration-fast`: 100ms （hover）
- `duration-base`: 150ms （sidebar 折叠、tabs 切换）
- `duration-slow`: 200ms （dialog 进出、route 切换淡入）
- easing: `cubic-bezier(0.4, 0, 0.2, 1)` (ease-in-out)

#### Tailwind 配置

把上面所有 tokens 写进 `tailwind.config.ts` 的 `theme.extend`，引用方式 `bg-primary` / `text-muted-foreground` 等，shadcn 默认契合。

### Shell（chrome）

- [ ] 左 sidebar：腾域 logo / 6 模块导航（图标 + 中文）/ 折叠按钮 / 设置 / 教程
- [ ] 顶 header：当前模块标题（无 breadcrumb，单层）/ 激活状态 badge / 右上角设置入口
- [ ] sidebar 折叠状态持久化到 localStorage
- [ ] 主区滚动隔离（header / sidebar 固定）

### Onboarding 重做

- [ ] 4 步引导：激活 / 素材目录 / API Keys / 完成
- [ ] 进度条 + 步骤指示器（中文：「第 1 步 共 4 步」而非「Step 1/4」）
- [ ] 每步统一 design tokens / 组件

### 6 模块面板重做

- [ ] 采集模块
- [ ] 标题生成模块
- [ ] 生图模块（含 4 个 Tab）
- [ ] 侵权检测模块
- [ ] 上架模块
- [ ] PS 套版模块

每个模块面板内部：

- 模块标题区（无重复 chrome）
- 配置 / 操作区
- 进度 / 结果区
- 统一 Empty / Loading / Error 态

### 工程拆分

- [x] App.tsx 拆分：**react-router-dom 路由化**（`HashRouter`，7 个 route：`/onboarding/:step` + 6 模块）
- [x] 每个模块独立 feature folder：`src/renderer/src/features/{onboarding,collection,title,generation,detection,listing,photoshop}/`
- [x] 共享 layout 组件：`src/renderer/src/layout/{Shell.tsx,Sidebar.tsx,Header.tsx}`
- [ ] 统一文案 audit：所有英文裸露词换中文

#### shadcn 组件清单（要补 15 个）

`button` + `accordion` 已装。要补：

| 组件 | 用途 |
|---|---|
| `card` | 替换所有手写 `rounded-md border` 卡片 |
| `dialog` | 激活码输入、确认弹窗、激活异常 modal |
| `sheet` | 设置面板（右侧抽屉） |
| `dropdown-menu` | 激活 badge 下拉、模块右上角 more 菜单 |
| `select` | platform / language / model / format 等下拉 |
| `input` | 替换所有手写 `<input>` |
| `textarea` | 标题额外要求等长文本 |
| `checkbox` | 套版选项、图像预处理选项 |
| `radio-group` | 标题策略、replace range 等 |
| `tabs` | 生图模块 4 个 Tab |
| `tooltip` | hover 提示、表单帮助文案 |
| `separator` | sidebar / card 分隔线 |
| `badge` | 激活状态、风险等级、统计 |
| `scroll-area` | 采集记录、SKU 列表的自定义滚动条 |
| `progress` | 套版 / 标题 / 检测进度条 |
| `skeleton` | loading 态占位 |
| `toast` (sonner) | 操作成功 / 失败通知（替换内联 message） |

#### 状态持久化（localStorage）

| key | 值 | 说明 |
|---|---|---|
| `tengyu.ui.sidebar.collapsed` | `boolean` | sidebar 折叠态 |
| `tengyu.ui.lastRoute` | `string` | 上次访问的 route，下次启动恢复 |
| ~~theme~~ | — | v1 不开放，跳过 |

#### Icon 系统

继续 `lucide-react`，不引入第二套。

**Sidebar 模块图标（locked）**：

| 模块 | lucide icon |
|---|---|
| 采集 | `Download` |
| 标题生成 | `Type` |
| 生图 | `Sparkles` |
| 侵权检测 | `ShieldCheck` |
| 上架 | `Rocket` |
| PS 套版 | `Layers` |

**次级入口**：`Settings2`（设置）/ `HelpCircle`（教程）/ `KeyRound`（激活码）

#### Logo / 品牌

sidebar 顶部：**蓝色几何 mark + 文字 wordmark**
- mark：8×8px 圆角方块（`bg-primary rounded-md`），可后续替换为定制 SVG
- 文字：「腾域 aipod」思源黑体 SemiBold 16-18px，slate-900

---

## Open Questions (To Grill)

1. **Design tokens 具体值**：圆角 6/8/12 还是 4/8/16？字号 14 还是 13 baseline？neutral 用 slate 还是 zinc？
2. **App.tsx 拆分策略**：react-router-dom 拆成 6 个 route，还是 feature folder + state-based？
3. **shadcn 组件清单**：要补哪些（card、dialog、dropdown-menu、select、input、checkbox、radio、tabs、tooltip、scroll-area、separator、badge、sheet、command、data-table、skeleton…）？
4. **状态色具体色号**：emerald-500 偏明亮，"硅谷大厂蓝白"调要不要换成更柔的 #16a34a / #059669？
5. **logo**：现在没有 logo，sidebar 顶部用文字"腾域"还是要做个简单 mark？
6. **icon 系统**：继续 `lucide-react`（已在用）还是补一些自定义 SVG？
7. **响应式**：~~中等屏幕 sidebar 默认态~~ → 已定：不强制折叠，用户自己控制
8. **状态持久化**：sidebar 折叠 / 当前模块 / 主题（虽然 v1 不开放暗色但要不要 persist 选项）
9. **激活异常态**：~~是否重做~~ → 已定：保持现状大红框样式不动

---

## Acceptance Criteria (Evolving)

- [ ] 设计 tokens 文档化（`docs/design/tokens.md` 或 inline 注释）
- [ ] 所有原有功能保持不变（IPC / business logic 0 改动）
- [ ] 6 模块 + Onboarding 4 步视觉风格统一
- [ ] 无英文裸露词（自动 lint 或 grep 验证）
- [ ] Mac + Windows 截图对比一致
- [ ] type-check / lint / e2e 全绿
- [ ] 跟旧版截图对比放进 PR description

---

## Definition of Done

- 单 PR 合入 main 后跑一遍完整 e2e（playwright）通过
- 主理人本机 macOS 启动看一遍 6 模块 + Onboarding 风格统一
- 主理人 Windows 机启动对比 Mac 截图无割裂
- 打包后体积增长 ≤ 3MB（字体 + 资源预算）
- 没有功能回归

---

## Out of Scope

- ❌ 暗色模式实现（只留 CSS variables 钩子）
- ❌ i18n 抽离 / 多语言（**项目级 i18n 战略已取消，腾域只服务中文用户**；ROADMAP / CHANGELOG / CLAUDE.md / 旧 task `05-23-v15-i18n-english` 由独立 cleanup task 处理）
- ❌ 业务逻辑 / IPC / 数据流改动
- ❌ 编排引擎 UI（v1.5，见 `05-23-v15-orch-ui`）
- ❌ 自动更新 UI（v1.5，见 `05-23-v15-electron-updater`）
- ❌ 移动端 / 响应式（桌面 only，min-width 1100px）
- ❌ 字体加载兜底处理（内置打包 + `font-display: swap` + preload 即可，无需专门方案）
- ❌ 服务端 admin（Next.js）样式同步（设计 tokens 写成可复用形式即可，admin 改造另开 task）

---

## Technical Notes

### 关键文件

- `packages/client/src/renderer/src/App.tsx` — 1932 行，主入口
- `packages/client/src/renderer/src/components/*.tsx` — 4 个模块 workbench
- `packages/client/src/renderer/src/components/ui/` — 仅 button + accordion
- `packages/client/src/renderer/src/index.css` — CSS variables 框架
- `packages/client/tailwind.config.ts` — 空配置
- `packages/client/components.json` — shadcn 配置：new-york / zinc

### 约束

- Electron 渲染层：React 19 + Tailwind 4 + Vite
- 主进程 / IPC / 业务逻辑 0 改动（CLAUDE.md 编码风格)
- 字体加载走 `file://` 协议（Electron asar 内），不能 CDN
- min-width 1100px / min-height 700px 不变

### 参考产品（视觉锚定）

- Linear（layout / typography / sidebar）
- Stripe Dashboard（蓝色应用、status badge、表格）
- Vercel Dashboard（卡片留白、字重）

### 相关 Trellis tasks

- 不影响 v1.5 task（i18n / orch-ui / electron-updater 等都在 planning）
- 不动 v1 切片 0-8 已合代码（仅视图层）

---

## Module Wireframes (Locked)

> 所有 wireframe 共享原则：左主区配置（2 列 grid）+ 右 sticky aside（预估 / CTA / 进度），主 CTA 永远在 1100×700 首屏内可见，不滚动。

### M1 / 采集 Collection

**三态**：idle（无活动会话）/ active（进行中）/ paused（暂停）

idle 态：

```
顶部 [开始采集] CTA 与"当前无活动会话"提示同行右侧
主区 2×2 grid：
  ┌── 1. 采集平台 (radio) ───┐  ┌── 2. 比特浏览器环境 (checkbox 列表) ──┐
  │ Temu/Ozon/Shein/TikTok    │  │ profile-001 已登录 / 002 未登录 / ...   │
  │ Shopee/1688/Mercado/自定义 │  │ [刷新列表]                               │
  └────────────────────────────┘  └──────────────────────────────────────────┘
  ┌── 3. 采集模式 (radio) ───┐  ┌── 4. 输出目录 ─────────────────────────┐
  │ ● 点击采集  ○ 滚动采集     │  │ ~/.../01-采集/  [更改]                  │
  │ [滚动设置 ▾] 选了才展开    │  │                                          │
  └────────────────────────────┘  └──────────────────────────────────────────┘
```

active 态：

```
顶部「当前会话」横条 card（platform · mode · profile · 计数 · 当前页 url · [停止][导出][查看失败]）
主区「最近保存」列表（缩略图 + 文件名 + 货号·来源 + 状态 badge + 重试按钮）
填货号浮窗 fixed bottom-right（不抢焦点，2 分钟折叠 toast）
```

paused 态：顶部条改 amber + 显示暂停原因 + [恢复] 按钮，列表保留。

### M2 / 标题生成 Title

```
左主区：
  1. 批次目录 (输入 + 选择 + 扫描)
  2. 生成参数 (平台/语言/模型 一行 + 额外要求 textarea + 高级 ▾ 折叠)
     高级折叠内含：取第几张/重试/并发/边长/已有标题策略/图像预处理

右窄 sticky aside (280px)：
  - 预估 card（张数 + ¥ 费用 + [开始生成] CTA）
  - 概览 card（货号/已有/生成/费用 四数字）
  - 进度 card（百分比 + 处理 N/M + 成功/失败 / 状态文案）

底部「生成结果」（生成后才显示，成功/失败左右两列 + 打开 xlsx/批次目录）
```

模型 select 用现状 3 个（qwen3-vl-plus / flash / qwen-vl-max），**业务改造时扩到 5 个共享 `listVisionModels()`**。

### M3 / 生图 Generation

```
顶部 shadcn tabs：[文生图][图生图][提取][抠图]
每 Tab 复用骨架：
  左主区：
    实现方式 radio（provider 切换）
    顶部输入区（Tab 独有：图生图必传印花 / 提取的源图 / 抠图的印花图）
    主体配置：提示词来源 + 印花范围 + Skill+LLM 或 手动提示词
  右 sticky aside (280px)：
    生成参数 card（provider-dependent: Grsai 用 select；ComfyUI 用宽高数字 input）
    [开始生成] CTA + 预估
    进度 card
    草稿提示词 / 已选源图 card
  底部「本次生成的印花」缩略图网格 + 流转操作

4 Tab 矩阵（业务改造后）：
  文生图：Grsai / ComfyUI
  图生图：Grsai / ComfyUI（顶部必传印花参考图）
  提取  ：Grsai / ComfyUI（顶部采集源图选择）
  抠图  ：仅 ComfyUI（无 Skill）

文生图无参考图（spec 03 §1.2）。
切换 provider → 右 aside 参数 card swap，不弹窗、不刷新。
```

### M4 / 侵权检测 Detection

```
左主区 2 列：
  1. 输入图源：02-生图/01-04 + 04-待套版印花 多选 checkbox（含数量）+ 外部拖入区
  2. 预处理：透明底加白(必开) + 压缩 + 最大边长 + 格式 + 并发 + VL 模型 select

右 sticky aside：
  - 预估 + [开始检测] CTA
  - 阈值 card（pass 0-39 / review 40-69 / block 70-100，三个数字可调）
  - 进度 card（含分级实时统计：pass/review/block 各多少）

底部「检测结果」：
  filter tabs [全部][pass][review][block][失败]
  缩略图网格（角标 risk badge + 风险值）
  点缩略图弹 dialog（大图 + 风险值 + 模型依据 + 流转操作：人工通过/删除/打开）
```

模型默认 `qwen3-vl-flash`（spec 推荐），**业务改造后接 `listVisionModels()` 5 个共享**。

### M5 / 上架 Listing（业务改造后）

```
顶部「工作区 tabs」：每个 profile 一个 tab（登录态徽章 + 任务运行状态）+ [+ 新工作区]
当前工作区状态条：profile 名 + 登录状态 + 比特浏览器连接 + [刷新]

左主区「任务编排」：
  任务卡片纵向排列，每卡含 4 字段（平台模板 / 草稿模板 ID / 店铺名 / 批次目录）
  + 状态徽章（▶运行 / ⏸队列 / ✓完成 / ✗失败）
  + 行为参数（任务级，默认折叠）：SKU 模式 / 提交模式 / 重试 / 续传
  + [复制][编辑][删除]
  底部 [+ 新建任务]

右 sticky aside：
  - 「当前运行」card（任务名 + 进度 + 当前 SKU + [暂停][停止]）
  - 「队列」card（等待中的任务列表）
  - 「失败队列」card（失败 SKU 列表 + [全部重试]）

底部「任务运行明细」实时表格（货号/状态/步骤/profile/证据 [截图][日志][重试]）
跨工作区互不阻塞、并发跑；工作区内任务串行队列（profile 锁全程不释放）。
任务定义持久化到 DB（listing_tasks / listing_workspaces 新表）。
```

### M6 / PS 套版 Photoshop（Windows only）

```
顶部「Photoshop 状态」横条（COM 连接/运行中/已安装/未安装/Mac 不可用）+ [刷新]

左主区 2 列：
  1. 印花文件夹（默认 04-待套版印花，显示张数）
  2. PSD/PSB 模板列表（多文件选择 + 跳过已完成 checkbox）
  3. 输出参数（替换范围 / 裁切模式 / 格式 / 重试）
  4. 输出目录

右 sticky aside：
  - 预估 card（N 印花 × M 模板 = N×M 货号 + [开始套版]）
  - 进度 card（含「当前模板/SKU」+ 完成/失败/跳过 + [暂停][停止]）
  - 模板预览 card（每个 PSD + 裁切张数，双击打开）

底部「套版结果」：filter tabs + 缩略图网格 + 点缩略图弹 dialog（套版前后对比）

Mac 端：整个主区被替换为 amber 警告卡「PS 套版仅 Windows 可用」+ spec 链接。
```

## Follow-up tasks (本任务范围外，需另开 task)

1. **i18n 战略取消 cleanup**：删 `05-23-v15-i18n-english`、更新 ROADMAP / CHANGELOG / CLAUDE.md

## Scope (本任务全做，单 PR，工作量约 16-23 天 — 用户知情决策)

- ✅ 视图层（renderer）全量重做
- ✅ Design tokens + 字体打包 + tailwind config + shadcn 组件补齐 + react-router-dom 重构
- ✅ Onboarding 4 步 + 6 模块面板重做
- ✅ **ComfyUI 文生图后端实现**：spec 03 §1.1 修订 + workflow pack + adapter + 文生图 Tab 加 provider 切换
- ✅ **上架任务编排业务改造**：spec 07 修订 + `listing_workspaces` / `listing_tasks` DB schema + IPC 改造 + workflow runner 改造 + 编排 UI
- ✅ **VL 模型清单扩展**：抽出 `listVisionModels()`（5 个 VL），标题 + 检测共用
- ❌ v1.5 i18n / 暗色 / 编排引擎 / 自动更新 / 代码签名等仍在范围外

### 已确认的风险

- 单 PR 16-23 天，Codex 隔壁终端会跑很久才有可看产物
- 涉及 spec 03 / spec 07 修订 + DB schema 改 + 主进程 / IPC / renderer / 服务端类型多层联动
- 失败影响面大；接受此 trade-off 是为了换"一次到位、无中间状态混乱"

## Research References

（待 grill 完后补：design tokens 业界对照 / 思源黑体 vs HarmonyOS Sans / Electron 字体打包方案 / shadcn 组件补齐清单）
