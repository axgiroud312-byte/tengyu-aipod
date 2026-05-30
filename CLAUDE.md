# 腾域 aipod — Claude / AI 协作指南

> **上架模块强制规则**：任何实现、测试或修改上架模块的任务，必须先加载 `.agents/skills/listing-automation-builder/SKILL.md`，并按 ADR-0004 的 selectors / page-parser / action-executor / workflow 四层结构落地。

> 这是项目级 AI 协作指南。Claude Code / Codex / Cursor 等 AI 工具开始任何任务前**必须先读**：
> 1. 本文件
> 2. `docs/CONTEXT.md`（领域语言）
> 3. 相关模块的 `docs/spec/*.md`

## 一句话项目简介

**腾域 aipod** = 跨境电商运营桌面工作台。采集 → 生图 → 检测 → PS 套版 → 标题 → 店小秘上架，一站式集成；服务端持续派发 Skill / 工作流 / Provider 配置。

## 当前阶段

- ✅ 文档体系完成（PRD / CONTEXT / 10 个 Spec / 10 个 ADR / 4 份 references/）
- ✅ Trellis 108 个原始 task 全部建好 prd.md，另有采集补充工作项 60A（见 ROADMAP.md）
- ✅ 切片 0-8 代码层归档完成，v1 全功能（采集 / 检测 / 生图 / PS 套版 / 标题 / 上架）已就位
- 🟡 待主理人本机跑通完整链路 + 提供完整 fixture 矩阵，才正式放行 v1.0.0
- ⏸ v1.5 增量（15 task）尚未启动：i18n / 多平台上架 / 编排引擎 / 自动更新 / 代码签名

**切片 0 — 工程骨架**（5 task）：monorepo / shared / client electron / server next / CI
**切片 1 — 登录与权益闭环**（原激活码闭环，后续对齐为微信登录 + 权益）→ v0.1.0
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
└─ adr/                          ← 10 个关键架构决策
    ├─ 0001-electron-react-stack.md
    ├─ 0002-activation-code-no-accounts.md
    ├─ 0003-skill-and-provider-cloud-dispatch.md
    ├─ 0004-listing-direct-port-with-rewrite.md
    ├─ 0005-task-and-sku-two-layer-model.md
    ├─ 0006-unified-generation-module-by-capability.md
    ├─ 0007-photoshop-windows-only-v1.md
    ├─ 0008-temp-file-manager-and-cleanup.md
    ├─ 0009-replace-better-sqlite3-with-node-sqlite.md
    └─ 0010-collection-image-pool-and-runtime-logs.md

references/                      ← 外部依赖参考资料（不是设计文档）
├─ generation-comfyui/chenyu-cloud-api.md      ← 晨羽智云 API
├─ generation-paid/grsai-api.md                ← Grsai 付费生图 API
├─ vision-llm-providers/aliyun-bailian-api.md  ← 阿里云百炼 API
└─ photoshop/open-source-references.md         ← PS 套版开源借鉴
```

## 5 个最重要的关键概念

| 术语 | 定义 | 详见 |
|---|---|---|
| **货号 / SKU** | 一个上架 listing，文件夹名，业务标识 | CONTEXT.md / ADR-0005 |
| **印花 / print** | 一张可套版的图，全局唯一 `pri_xxx` ID | CONTEXT.md |
| **模板批次** | 05-货号成品 下的一级目录，对应一个 PSD 模板，是上架程序的扫描单位 | spec/05 / spec/07 |
| **Skill** | 云端派发的提示词模板 | ADR-0003 |
| **微信登录 / 权益** | 客户端身份与授权主方案；激活码仅作兑换码 | ADR-0002 |

## 10 条不可违反的规则（Invariants）

来自 `spec/00-overview.md §10`，复制在此方便引用：

1. **5 大类目录下只放图片**（含子目录），元数据全在 SQLite
2. **05-货号成品 是上架域**，禁止其他模块写
3. **04-待套版印花 是生产入口**，可三种入图方式
4. **同一货号同时刻最多 1 个进行中任务**
5. **同一比特浏览器 profile 同时刻最多 1 个模块占用**
6. **服务端不接触图片 / API Key / 任务数据**
7. **客户端 API Key 永远 OS keychain 加密存储**
8. **微信登录权益在 7 天内必须联网验证一次**
9. **印花 ID 全局唯一**，跨 provider 共享同一 ID 空间
10. **临时文件用完即删**，最长保留 24 小时（见 ADR-0008）

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
- ❌ 不在 5 大类素材目录里放 `.json` `.jsx` `.csv` 等非图片文件（除 `titles.xlsx`）
- ❌ 不让服务端代理生图 / LLM / 接触用户图片（ADR-0003）
- ❌ 不在客户端持有任何用户的 API Key 明文（必须 OS keychain 加密）
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
pnpm -F @tengyu-aipod/server exec prisma db push     # 推 schema 到本地 DB
pnpm dev                                              # 启动所有 workspace 的 dev
```

`/api/health` 返回 `{ ok: true, db_ok: true }` = server 端就绪。

**双终端协作流**：

- 本终端（Claude Code）：写 spec / ADR / PRD / Trellis task prd.md / 解卡点
- 隔壁终端（Codex CLI）：按 Trellis 顺序自动实施代码，遇到 spec 没说的事或 git 冲突回来找 Claude
- Claude **不直接实施代码**；Codex **不动 spec/ADR**

## 项目里的其他配置

- `.trellis/` / `AGENTS.md` ← Trellis 框架的配置，由 Trellis 维护，不要手改 TRELLIS 段
- `.claude/` `.cursor/` `.codex/` `.agents/` ← 各 AI 工具的本地配置
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
