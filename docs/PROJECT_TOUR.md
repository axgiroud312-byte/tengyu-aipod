# 项目导览（PROJECT_TOUR）

> 给项目主理人自己看的回神文档。不是给团队的规范，也不是给用户的说明书。
> 最后更新：2026-05-31

---

## 一句话讲项目

这是一个 **腾域 aipod 跨境电商桌面工作台**，解决 **"从看到一张好图、到把它上架到 Temu/Shein"这一整条手工链路效率太低** 的问题。

就像一个 **"自动美工流水线"**：你给它一个货号文件夹，它顺着采集 → 检测侵权 → 生图 → PS 套版 → 写标题 → 自动上架，一路走完，你只需要点几下"开始"。

---

## 当前进度速览

| 切片 | 模块 | 状态 | 备注 |
|---|---|---|---|
| 0 | 工程骨架 | ✅ 已完成 | monorepo / Electron / Next.js / CI |
| 1 | 登录与权益闭环 | ✅ 已完成 | v0.1.0，原授权闭环；文档已对齐微信登录 + 权益 |
| 2 | 标题生成 | ✅ 已完成 | v0.2.0，百炼 + Skill 缓存 |
| 3 | 侵权检测 | ✅ 已完成 | v0.3.0，百炼视觉 LLM |
| 4 | 生图 Grsai | ✅ 已完成 | v0.4.0，付费 API |
| 5 | 生图 ComfyUI | ✅ 已完成 | v0.5.0，晨羽云 + 自部署 |
| 6 | 采集 | ✅ 已完成 | v0.6.0，比特浏览器 + CDP |
| 7 | PS 套版 | ✅ 已完成 | v0.7.0，Windows-only |
| 8 | 上架 | ✅ 已完成 | Temu + Shein |
| v1.0 全链路 | 真实验收 | 🟡 待跑通 | **主理人本机** |
| v1.5 | 增量 | ⬜ 未启动 | i18n / 多平台 / 编排 / 签名 |

> 依据：`.trellis/tasks/archive/2026-05/` 下 91 个 task 已归档，git log 显示切片 1-8 feat+archive 双 commit 完整。

---

## 整体架构图

```mermaid
graph TB
    User[主理人/买家]
    subgraph Desktop[Electron 桌面端 packages/client]
        Renderer[渲染进程 React UI<br/>4 个工作台]
        Main[主进程 业务逻辑<br/>采集/检测/生图/PS/标题/上架]
        Preload[Preload IPC 桥]
        DB[(本地 SQLite<br/>workbench-db)]
        Keychain[(OS Keychain<br/>加密 API Key)]
    end
    subgraph Cloud[云端 packages/server]
        Admin[Admin 后台 UI]
        API[微信登录/权益/Skill API]
        PG[(Postgres + Prisma)]
    end
    subgraph Externals[外部服务]
        Bailian[阿里百炼<br/>视觉 LLM]
        Grsai[Grsai 付费生图]
        Comfy[晨羽云 / 自部署 ComfyUI]
        BitB[比特浏览器]
        PS[Windows Photoshop COM]
        Dianxiaomi[店小秘]
    end

    User --> Renderer
    Renderer <-->|IPC| Preload <--> Main
    Main --> DB
    Main --> Keychain
    Main -->|微信登录/权益校验/拉 Skill| API
    Main -->|HTTP API Key 在本地| Bailian
    Main --> Grsai
    Main --> Comfy
    Main --> BitB
    BitB --> Dianxiaomi
    Main -->|Windows-only| PS
    Admin --> API
    API --> PG
```

**用大白话讲一遍**：桌面 app 是工具人（实际干活），服务器是"账号与提示词控制台"（微信登录、权益、客户、Skill 系统提示词），不碰模型配置、图片和 Key。用户的 API Key 一律放在自己电脑的钥匙串里，**不上服务器**。

---

## 一次完整跑通的流程

```mermaid
sequenceDiagram
    autonumber
    主理人->>桌面: 选一个货号
    桌面->>比特浏览器: 起 CDP 接管页面
    比特浏览器-->>桌面: 采集图片回流
    桌面->>百炼: 检测侵权（视觉 LLM）
    百炼-->>桌面: pass / fail
    桌面->>Grsai/ComfyUI: 给 pass 图生成印花
    Grsai/ComfyUI-->>桌面: 出图
    桌面->>Photoshop: 套版（Windows）
    Photoshop-->>桌面: 04-上架工作区/ 输出
    桌面->>百炼: 生成标题
    桌面->>店小秘: 自动填写 + 上传 + 一键 SKU + 一键视频
    店小秘-->>主理人: 草稿已就位
```

---

## 4 个业务工作区（最重要的业务约定）

代码反复围着这 4 个目录转。**只放业务图片，不放 json/csv/jsx**（唯一例外：上架批次里的 `titles.xlsx`）。

```
~/腾域aipod工作台/
├─ 01-采集工作区/      ← 比特浏览器采集回来，按平台和时间分任务目录
├─ 02-印花工作区/      ← 文生图/图生图/提取/抠图，按任务子目录保存出图
├─ 03-检测工作区/      ← 百炼判定后按通过/复查/失败分类
└─ 04-上架工作区/      ← PS 输出 + 标题 + 上架输入（上架唯一读取域）
```

`02-印花工作区` 下面固定四个能力目录：`文生图` / `图生图` / `提取` / `抠图`。每次运行会在能力目录下再建一个 `{任务名}` 文件夹，默认“能力-时间”，前端可自定义。

---

## 业务模块详解：每个功能的代码在哪

> 这一节就是你最想看的"模块定位地图"。

### 1️⃣ 采集模块 — 从店小秘 / Temu / Shein 抓图回本地

| 部分 | 文件 |
|---|---|
| **主进程业务** | `packages/client/src/main/lib/collection-image-index-service.ts` ← 图池扫描/下载/商品页主图分组<br/>`collection-session-manager.ts` ← 会话状态机 + debug-log 事件<br/>`collection-click-service.ts` ← 点击模式<br/>`collection-injected-script.ts` ← 注入到页面的采集脚本<br/>`collection-record-store.ts` ← 采集记录 + manifest |
| **浏览器接入** | `bit-browser-client.ts` ← 比特浏览器 HTTP API<br/>`cdp-client.ts` ← Chrome DevTools Protocol<br/>`browser-profile-lock.ts` ← profile 互斥（不变规则 #5） |
| **UI 工作台** | `packages/client/src/renderer/src/features/collection/CollectionPage.tsx` ← 图池采集界面 + 日志弹窗<br/>`image-pool.ts` ← 散图/商品页分组<br/>`collection-debug-log.ts` ← 命令行式日志格式化 |
| **相关归档 task** | `.trellis/tasks/archive/2026-05/05-23-collection-*`、`05-27-fix-collection-remaining-issue`、`05-28-collection-debug-log-panel` |

### 2️⃣ 检测模块 — 用百炼视觉 LLM 判断是否侵权

| 部分 | 文件 |
|---|---|
| **主进程业务** | `packages/client/src/main/lib/detection-service.ts` ← 检测编排 + IPC<br/>`detection-config.ts` ← 阈值 / 模型配置<br/>`aliyun-bailian-adapter.ts` ← 阿里百炼 API 适配 |
| **UI 工作台** | `packages/client/src/renderer/src/components/detection-workbench.tsx`<br/>`detection-settings-panel.tsx` |
| **Spec** | `docs/spec/04-detection.md` |
| **相关归档 task** | `detection-module-service` / `module-ui` / `cost-estimator` / `thresholds` / `promote-to-matting` / `e2e` |

### 3️⃣ 生图模块 — 按能力组织，ComfyUI 走默认云机

当前 UI 只把**文生图**收敛成统一页：提示词生成、自己写提示词、提示词审稿共用，右侧“生图路径”选择 Grsai 或 ComfyUI 工作流，默认 Grsai。**图生图不合并**，Grsai 图生图和 ComfyUI 图生图继续按原入口走。

| 部分 | 文件 |
|---|---|
| **统一编排** | `packages/client/src/main/lib/generation-service.ts` ← 主调度 + `generation:debug-log` 运行期日志事件<br/>`generation-concurrency.ts` ← 并发控制（共享给所有 provider）<br/>`prompt-generator-service.ts` ← 提示词生成（百炼） |
| **Grsai 路径**（付费） | `grsai-adapter.ts`（节点切换 / 重试 / 异步轮询） |
| **ComfyUI 路径** | `comfyui-instance-manager.ts` ← 实例生命周期<br/>`comfyui-chenyu-adapter.ts` ← 晨羽智云<br/>`comfy-http-client.ts` ← HTTP 直连<br/>`chenyu-cloud-client.ts` ← 晨羽 API<br/>`comfyui-workflow-cache.ts` ← 工作流缓存 |
| **晨羽设置** | `SettingsPage.tsx` ← API Key 连接状态、固定杭州慎思 POD 创建、全部实例开关机、设为默认云机 |
| **图像预处理** | `preprocess-pool.ts` |
| **UI 工作台** | `packages/client/src/renderer/src/components/generation-workbench.tsx` ← 生图主界面 + 日志弹窗<br/>`packages/client/src/renderer/src/features/generation/generation-debug-log.ts` ← 命令行式日志格式化 |
| **Spec** | `docs/spec/03-generation.md` |
| **相关归档 task** | `grsai-adapter` / `generation-*` / `comfyui-*` / `chenyu-cloud-adapter` / `txt2img-*` / `img2img-*` / `extract-*` / `matting-*` |

ComfyUI 路径页面只显示默认云机状态卡：状态、实例 UUID、ComfyUI 地址和刷新按钮。开机、关机、设为默认云机仍在设置页处理。

生图页顶部的“日志”按钮打开运行期日志弹窗，实时显示提示词生成、任务提交、模型调用进度、完成/失败和保存路径。它只保存在前端内存中，最近 `1000` 条，重启后清空。

### 4️⃣ PS 套版模块 — Windows-only，真实 Photoshop COM

| 部分 | 文件 |
|---|---|
| **主进程业务** | `packages/client/src/main/photoshop/com-adapter.ts` ← COM 桥<br/>`execution-engine.ts` ← 执行引擎（多模板批次 + 跳过已完成）<br/>`multi-batch.ts` ← 任务分组<br/>`psd-scanner.ts` ← PSD 模板扫描<br/>`psd-template-cache.ts` ← 模板缓存<br/>`jsx-generator.ts` ← 生成 ExtendScript<br/>`status-checker.ts` ← Photoshop 进程检测<br/>`ipc.ts` ← IPC 入口 |
| **共享类型** | `packages/shared/src/photoshop.ts`、`photoshop-grouping.ts` |
| **UI 工作台** | （PS 模块 UI 在 App.tsx 注册，文件未单独抽出）|
| **Spec** | `docs/spec/05-photoshop.md` + `docs/adr/0007-photoshop-windows-only-v1.md` |
| **守护变量** | `REAL_PS=1` / `REAL_PS_MUTATE=1` / `PS_MATERIAL_ROOT` / `PS_OUTPUT_ROOT` |
| **相关归档 task** | `ps-*`（12 个，含 `psd-scanner` / `ps-com-adapter` / `ps-execution-engine` / `ps-clipping` 等） |

### 5️⃣ 标题生成模块 — 用百炼生成 + Skill 缓存

| 部分 | 文件 |
|---|---|
| **主进程业务** | `packages/client/src/main/lib/title-service.ts`<br/>`skill-cache.ts` ← 云端 Skill 系统提示词缓存 |
| **UI** | 集成在生图 / 检测工作台 |
| **Spec** | `docs/spec/06-title.md` |

### 6️⃣ 上架模块 — 唯一独立成模块的业务（按 SKILL 四层）

| 部分 | 文件 |
|---|---|
| **入口编排** | `packages/client/src/modules/listing/runner.ts` ← 任务驱动<br/>`evidence.ts` ← 截图存证<br/>`packages/client/src/main/lib/listing-batch-loader.ts` ← 扫 04-上架工作区 |
| **Temu 平台**（四层严格分） | `modules/listing/platforms/dianxiaomi-temu-pop/`<br/>　├─ `selectors.ts` ← DOM 选择器（静态）<br/>　├─ `page-parser.ts` ← 读 DOM 返状态<br/>　├─ `action-executor.ts` ← 动作原语（5 项核心动作）<br/>　└─ `workflow.ts` ← 12 阶段业务流程 |
| **Shein 平台**（同四层） | `modules/listing/platforms/dianxiaomi-shein/` 下同名 4 文件 |
| **共享类型** | `packages/shared/src/listing-types.ts` |
| **UI 工作台** | `packages/client/src/renderer/src/components/listing-workbench.tsx` |
| **Spec** | `docs/spec/07-listing.md` + `docs/adr/0004-listing-direct-port-with-rewrite.md` |
| **守护变量** | `REAL_LISTING=1` / `REAL_LISTING_MUTATE=1` |
| **相关归档 task** | `listing-skill-import` / `profile-lock` / `types-port` / `runner-port` / `temu-*` / `shein-*` / `batch-loader` / `resume` / `evidence` / `module-ui` / `failure-retry` / `module-e2e` |

### 7️⃣ 微信登录 & 权益 — 身份用微信，授权看权益

| 部分 | 文件 |
|---|---|
| **主进程业务** | `packages/client/src/main/lib/activation-state.ts`（历史命名，后续应迁到 auth/entitlement）← 登录/权益态机<br/>`activation-poller.ts`（历史命名）← 7 天内联网验证（不变规则 #8）<br/>`keychain.ts` ← OS 钥匙串加密<br/>`packages/client/src/main/onboarding.ts` ← 入门流程 + Dev 跳过开关 |
| **后台**（微信账户 / 客户 / 权益） | `packages/server/src/app/admin/customers/`（客户与微信账户）<br/>`packages/server/src/app/admin/skills/`（生图 Skill 系统提示词） |
| **Spec** | `docs/adr/0002-activation-code-no-accounts.md` |

### 公共基础设施（所有模块共用）

| 文件 | 干什么 |
|---|---|
| `packages/client/src/main/lib/temp-file-manager.ts` | 临时文件管理（24h 清理，不变规则 #10） |
| `packages/client/src/main/lib/workbench-config.ts` | 工作台配置 |
| `packages/client/src/main/lib/workbench-db.ts` | SQLite 元数据 |
| `packages/shared/src/errors.ts` | `AppError` 错误结构 |
| `packages/shared/src/schemas.ts` | IPC zod 校验 |
| `packages/shared/src/types.ts` | 业务类型 |
| `packages/shared/src/constants.ts` | 路径常量 / 模块常量 |

### 服务端（Admin 后台）

| 路径 | 干什么 |
|---|---|
| `packages/server/src/app/admin/customers/` | 客户 / 微信账户 / 权益管理 |
| `packages/server/src/app/admin/skills/` | 生图、提取、侵权检测固定 Skill 系统提示词槽位 |
| `packages/server/src/app/api/skills/` | 客户端拉取 Skill 系统提示词 |
| `packages/server/src/app/api/status/` | 客户端登录态和权益状态校验 |
| `packages/server/src/app/api/health/` | 服务健康检查 |
| `packages/server/prisma/schema.prisma` | 数据库表结构 |

---

## 数据怎么流的（一个真实例子）

举例：上架一个 Temu 服装货号 `GzG0023`。

```mermaid
flowchart LR
    A[采集图片<br/>01-采集工作区/] --> B[提取印花<br/>ComfyUI / Grsai]
    B --> C[检测侵权<br/>百炼 vision LLM]
    C -->|通过| D[套版候选清单]
    D --> E[PS 套版<br/>Windows Photoshop COM]
    E --> F[04-上架工作区/模板批次/GzG0023/]
    F --> G[标题生成<br/>百炼]
    G --> H[上架到 Temu<br/>店小秘<br/>2-1111 浏览器]
    H --> I[草稿就位<br/>+ 一键 SKU<br/>+ 一键视频]
```

**5 个流转规则**（任意一条违反 = 出 bug）：
1. 采集输出只进 `01-采集工作区/{platform}-{timestamp}/`
2. 生图输出只进 `02-印花工作区/{能力}/{任务名}/`
3. 检测输出只进 `03-检测工作区/{任务名}/{通过|复查|失败}/`
4. `04-上架工作区/` 是 PS 输出、标题写入和上架读取的唯一业务域
5. 服务端从不接触图片 / API Key（ADR-0003 红线）；同一比特浏览器 profile 同时刻最多 1 个模块占用

---

## 数据库长什么样

**桌面端 SQLite（本地，不上服务器）**：

| 表（概念） | 干什么 |
|---|---|
| `workbench_config` | 工作台路径 / 当前登录与权益态 |
| `print_artifact` | 印花 ID 全局唯一（不变规则 #9） |
| `detection_result` | 检测历史 |
| `generation_record` | 生图记录 |
| `collection_record` | 点击/滚动会话采集记录 + manifest（图池结果不写入该表） |
| `listing_task` / `listing_stage` | 上架任务 + 12 阶段状态 |
| `ps_job` | PS 套版任务 |

**服务端 Postgres（云端，只放微信身份、客户、权益和 Skill）**：

```mermaid
erDiagram
    CUSTOMER ||--o{ WECHAT_USER : binds
    CUSTOMER ||--o{ ENTITLEMENT : owns
    WECHAT_USER ||--o{ CLIENT_SESSION : logs-in
```

Skill 作为云端提示词资源单独管理，不再和 Provider / Workflow / Platform Rules 放在同一张云端关系图里。

---

## 我现在该看哪几个文件

按"快速回神"的顺序：

1. `CLAUDE.md` — 项目协作规则 + 当前阶段
2. `ROADMAP.md` — 108 task 总路线图 + 切片划分
3. `docs/CONTEXT.md` — 领域语言（货号 / 印花 / Skill / 微信登录 / 权益）
4. `docs/spec/00-overview.md` — 整体架构 + **10 条不可违反规则**
5. `CHANGELOG.md` — 切片 1-8 已交付的能力

---

## 下一步建议

基于"切片 0-8 代码完成、v1.0 还未真实跑通"这个现状：

1. ⚠️ **必须做**：主理人本机跑一次真实全链路 E2E（采集 → 检测 → 生图 → PS → 上架），用 1 个真实货号 + 真实店小秘 `2-1111`。这是 v1.0.0 放行的唯一卡点。没跑过任何 commit 都不算"完成"
2. ✅ **可以推进**：在等真实验收时，可以并行做 `v15-sign-mac` / `v15-sign-windows`（代码签名），这是发版给朋友试用的前提
3. 🤔 **要决策**：v1.5 的编排引擎（`v15-orch-*` 4 个 task）和 i18n（`v15-i18n-english`）哪个先做。建议**签名先做、编排和 i18n 等真实用户反馈再排**

---

## 相关文档

- **总路线图**：[ROADMAP.md](../ROADMAP.md)
- **AI 协作规则**：[CLAUDE.md](../CLAUDE.md)
- **领域语言**：[docs/CONTEXT.md](CONTEXT.md)
- **产品需求**：[docs/PRD.md](PRD.md)
- **整体架构 + 10 条不变规则**：[docs/spec/00-overview.md](spec/00-overview.md)
- **10 个 ADR（关键架构决策）**：[docs/adr/](adr/)
- **CHANGELOG**：[CHANGELOG.md](../CHANGELOG.md)
