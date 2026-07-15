# 腾域 aipod — Claude / AI 协作指南

> **上架模块强制规则**：任何实现、测试或修改上架模块的任务，必须先读 ADR-0004，并按 selectors / page-parser / action-executor / workflow 四层结构落地。

> 这是项目级 AI 协作指南。Claude Code / Codex / Cursor 等 AI 工具开始任何任务前**必须先读**：
> 1. 本文件
> 2. `docs/CONTEXT.md`（领域语言）
> 3. 相关模块的 `docs/spec/*.md`

## 一句话项目简介

**腾域 aipod** = 跨境电商运营桌面工作台。采集 → 生图 → 检测 → PS 套版 → 标题 → 店小秘上架，一站式集成；服务端管理客户账号授权并派发 Skill / 公告 / 版本，Provider、模型、Workflow 和 API Key 都在客户端本地管理。

## 当前阶段

- ✅ 文档体系完成（PRD / CONTEXT / 10 个 Spec / 14 个 ADR / 4 份 references/）
- ✅ 旧 Trellis 任务资料已清理，当前以代码、docs/spec 和 ADR 为准
- ✅ 切片 0-8 代码层归档完成，v1 全功能（采集 / 检测 / 生图 / PS 套版 / 标题 / 上架）已就位
- ✅ 完整任务最初版已就位：来源 → 可选抠图 → 可选检测 → 可选 PS 套版 → 可选标题生成
- 🟡 待主理人本机跑通完整链路 + 提供完整 fixture 矩阵，才正式放行 v1.0.0
- ⏸ v1.5 增量尚未启动：i18n / 多平台上架 / 通用编排引擎 / 自动更新 / 代码签名

**切片 0 — 工程骨架**（5 task）：monorepo / shared / client electron / server next / CI
**切片 1 — 首次设置与本地配置**（工作区选择 + API Key 本地保存 + Skill 缓存）→ v0.1.0
**切片 2-8 + v1.5**：见 [ROADMAP.md](./ROADMAP.md) / [CHANGELOG.md](./CHANGELOG.md)

> 具体进度看 `git log --oneline` 或 SessionStart hook 注入的 active tasks——不要在本文件维护"task X 已完成"的状态。

## 文档导航（**所有重要决策都在这里**）

```
docs/
├─ CONTEXT.md                   ← 领域语言（所有术语的唯一权威）
├─ PRD.md                       ← 产品需求文档
├─ spec/
│   ├─ 00-overview.md            ← 整体架构 + 技术栈
│   ├─ 01-orchestration.md       ← 任务/货号模型
│   ├─ 02-collection.md          ← 采集模块
│   ├─ 03-generation.md          ← 生图模块
│   ├─ 04-detection.md           ← 侵权检测
│   ├─ 05-photoshop.md           ← PS 套版（Windows-only）
│   ├─ 06-title.md               ← 标题生成
│   ├─ 07-listing.md             ← 上架（直接 Port + 重写）
│   ├─ 08-server.md              ← 服务器端 + Admin
│   └─ 09-cross-cutting.md       ← 跨平台 / 并发 / 暂停 / 打包
└─ adr/                          ← 14 个关键架构决策
    ├─ 0001-electron-react-stack.md
    ├─ 0002-no-client-auth-gate.md
    ├─ 0003-skill-and-provider-cloud-dispatch.md
    ├─ 0004-listing-direct-port-with-rewrite.md
    ├─ 0005-task-and-sku-two-layer-model.md
    ├─ 0006-unified-generation-module-by-capability.md
    ├─ 0007-photoshop-windows-only-v1.md
    ├─ 0008-temp-file-manager-and-cleanup.md
    ├─ 0009-replace-better-sqlite3-with-node-sqlite.md
    ├─ 0010-collection-image-pool-and-runtime-logs.md
    ├─ 0011-customer-login-via-php-auth.md
    ├─ 0012-complete-task-initial-fixed-pipeline.md
    ├─ 0013-complete-task-explicit-stage-toggles.md
    └─ 0014-listing-platforms-commons.md

references/                      ← 外部依赖参考资料（不是设计文档）
├─ generation-comfyui/chenyu-cloud-api.md      ← 晨羽智云 API
├─ generation-paid/grsai-api.md                ← Grsai 付费生图 API
├─ vision-llm-providers/aliyun-bailian-api.md  ← 阿里云百炼 API
└─ photoshop/open-source-references.md         ← PS 套版开源借鉴
```

## 7 个最重要的关键概念

| 术语 | 定义 | 详见 |
|---|---|---|
| **货号 / SKU** | 一个上架 listing，文件夹名，业务标识 | CONTEXT.md / ADR-0005 |
| **印花 / print** | 一张可套版的图，全局唯一 `pri_xxx` ID | CONTEXT.md |
| **模板批次** | 04-上架工作区 下的一级目录，对应一个 PSD 模板，是上架程序的扫描单位 | spec/05 / spec/07 |
| **完整任务** | 内置固定顺序跨模块流程，后续步骤按开关执行，不包含上架；启用 PS 时印花货号决定等待套版图片名和 PS 后货号文件夹名 | CONTEXT.md / ADR-0012 / ADR-0013 |
| **客户账号** | 旧 PHP uid 对应的授权账号，active 且未到期才可进入 Workbench | CONTEXT.md / ADR-0011 |
| **Skill** | 云端派发的提示词模板 | ADR-0003 |
| **工作区** | 设置页选择的本地根目录，自动创建 4 个业务工作区 | CONTEXT.md |

## 11 条不可违反的规则（Invariants）

来自 `spec/00-overview.md §10`，复制在此方便引用：

1. **4 个业务工作区目录下只放业务图片**（标题 xlsx 只允许在上架批次目录；当前优先 `标题.xlsx`，兼容旧 `titles.xlsx`），元数据全在 SQLite
2. **04-上架工作区 是上架域**，只有 PS 套版和标题模块写，上架模块读
3. **02-印花工作区和检测通过候选清单 是 PS 套版主要入口**
4. **完整任务等待套版目录是业务图片副本目录**，位于 `02-印花工作区/等待套版/{runId}/`
5. **同一货号同时刻最多 1 个进行中任务**
6. **同一比特浏览器 profile 同时刻最多 1 个模块占用**
7. **服务端不接触图片 / API Key / 任务数据**
8. **客户端 API Key 生产环境走 OS keychain 加密存储；开发环境 safeStorage 不可用时允许 plain: 兜底，仅限本地开发/测试**
9. **客户授权通过前不能进入 Workbench，不能启动 Skill 同步**
10. **印花 ID 全局唯一**，跨 provider 共享同一 ID 空间
11. **临时文件用完即删**，最长保留 24 小时（见 ADR-0008）

## 工作流约定

### 实现新功能前

1. 找对应的 `docs/spec/*.md`
2. 看相关 ADR 是否有约束
3. 看 `references/` 是否有外部 API 资料
4. 不确定就**问，不要猜**

### 修改外部 API 调用前

1. **重新抓**官方文档（references/ 顶部"抓取时间"超过 3 个月一律重抓）
2. 看 references 里"已知不确定项"是否还有效

### 修改 CONTEXT.md / Spec 前

1. 必须先在对话里明确改动意图
2. 改 CONTEXT.md 的术语时，**全 spec 文档搜索旧词，避免不一致**
3. 重大改动 → 写新 ADR 或更新现有 ADR

### 写上架模块代码（关键）

严格按 `references/.../open-source-references.md` 提到的 **listing-automation-builder SKILL** 四层结构（selectors / page-parser / action-executor / workflow）。详见 ADR-0004。

## 编码风格（指向）

具体见 `docs/spec/00-overview.md §1, §3`。要点：
- TypeScript strict mode，禁用 `any` / `as any` / `@ts-ignore`
- 主进程 vs 渲染进程职责严格分（API Key 不出主进程）
- IPC 用 `module:action` 命名 + zod 校验
- 错误用 `AppError` 结构化对象（`shared/errors.ts`）
- ✅ 主进程 SQLite 一律走 `packages/client/src/main/lib/sqlite.ts`，禁止直接 `import 'node:sqlite'` 或安装 `better-sqlite3`

## 不要做的事

- ❌ 不在 v1 实现编排引擎（v1.5 才做，详见 spec/01）
- ❌ 不在 v1 支持 Temu/Shein 以外的上架平台（详见 spec/07）
- ❌ 不在 4 个业务工作区里放 `.json` `.jsx` `.csv` 等非图片文件（除上架批次目录下的标题 xlsx；当前优先 `标题.xlsx`，兼容旧 `titles.xlsx`）
- ❌ 不让服务端代理生图 / LLM / 接触用户图片（ADR-0003）
- ❌ 不在客户端持有任何用户的 API Key 明文（生产环境走 OS keychain；开发环境 safeStorage 不可用时允许 plain: 兜底）
- ❌ 不直接 Port `一键pod/上架程序` 的店小秘 DOM 代码（屎山，要按 SKILL 重写）—— 只 Port 框架
- ❌ 不在主进程外新增 native 模块；新增任何带 `.node` 二进制的依赖前，必须更新 Native 兼容矩阵并走 ADR

## 本地开发起步

**Postgres dev DB**（packages/server 必需）：

```bash
docker compose -f docker-compose.dev.yml up -d        # 启
docker compose -f docker-compose.dev.yml down         # 停（保留数据）
docker compose -f docker-compose.dev.yml down -v      # 停 + 清空数据
docker exec -it tengyu-pg-dev psql -U dev -d tengyu_aipod   # 进 psql
```

连接串：`postgresql://dev:dev@localhost:5432/tengyu_aipod`
写入 `packages/server/.env` 的 `DATABASE_URL`（不入 git，`.env.example` 已示范）。

**全栈跑起来**：

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm -F @tengyu-aipod/server prisma:generate
pnpm -F @tengyu-aipod/server exec prisma migrate deploy --schema prisma/schema.prisma
pnpm dev                                              # 启动所有 workspace 的 dev
```

`/api/health` 返回 `{ ok: true, db_ok: true }` = server 端就绪。

补充说明：

- 客户端开发态当前默认连接 `https://wechat.tengyuai.com`
- 如需把客户端开发态显式切回本地 server，启动前设置 `TENGYU_SERVER_URL=http://127.0.0.1:3100`
- 如需改到其他 PHP 登录环境，启动前设置 `TENGYU_PHP_AUTH_BASE_URL=...`

**当前协作流**：

- 先读本文件、`docs/CONTEXT.md` 和相关 `docs/spec/*.md`
- 对齐现有代码和文档后再改，改完必须跑对应 type-check / lint / E2E
- 可以直接实施代码和文档改动，但不要重建旧 Trellis 流程

## 项目里的其他配置

- `AGENTS.md` / `CLAUDE.md` ← 当前 AI 协作入口
- `.codex/` `.claude/` `.cursor/` `.agents/` ← 各 AI 工具的本地配置（若存在）
- `references/TEMPLATE.md` ← 新增外部资料文档时用这个骨架

## 当用户说...

| 用户说 | 你应该做 |
|---|---|
| "把货号叫 SKU" | CONTEXT.md 已统一术语，沿用 |
| "用 ComfyUI 直接抠图" | spec/03 §7 抠图能力 |
| "晨羽默认云机 / 实例管理" | spec/03 §9；生图只发默认云机，未运行时提示去设置页开机 |
| "店小秘改版了" | spec/07 §12 + ADR-0004，按 listing-automation-builder SKILL 重写选择器 |
| "服务器加个新接口" | spec/08 §4，注意 ADR-0003 边界 |
| "PS 套版 Mac 也要支持" | ADR-0007 已明确 v1 不做；如果用户坚持，先问预算 |
| "我想看具体怎么实现" | 找 spec/*.md，里面有伪代码 |

## Agent skills

### Issue tracker

Issues and specifications are tracked in GitHub Issues for `axgiroud312-byte/tengyu-aipod`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the default five-role triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain documentation layout rooted at `docs/CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
