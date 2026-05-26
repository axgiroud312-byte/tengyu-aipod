# Spec 00 — 整体架构与技术栈

> 整个工程的总规格。所有模块 Spec 都基于本文档的约定。

## 1. 技术栈

### 桌面客户端

| 层 | 技术选型 |
|---|---|
| 运行时 | Electron 33+（双端 Windows + macOS）|
| 渲染层 | React 18+ + TypeScript 5+ |
| 构建 | electron-vite + Vite 5 |
| UI 库 | shadcn/ui + Tailwind CSS |
| 状态管理 | Zustand（轻量）|
| 路由 | React Router |
| 主进程 IPC | electron 原生 + zod 验证 |
| 数据库 | node:sqlite（Electron 内置、同步、ABI 跟随 Electron）|
| 浏览器自动化 | playwright + playwright-extra |
| 图像处理 | sharp（C++ libvips）|
| Excel | exceljs / xlsx |
| 加密存储 | electron.safeStorage（OS keychain）|
| HTTP 客户端 | undici / native fetch |
| 日志 | pino（结构化）|
| 测试 | vitest + playwright（E2E）|
| 打包 | electron-builder |

### 服务端

| 层 | 技术选型 |
|---|---|
| 框架 | Next.js 15 (App Router) |
| 语言 | TypeScript 5+ |
| 数据库 | Postgres 16 + Prisma ORM |
| 认证 | 自实现 JWT（不用 Auth.js，需求简单）|
| Admin UI | shadcn/ui dashboard 模板 |
| API 验证 | zod schema |
| 邮件（如发激活码邮件）| Resend / 阿里云 DM |

### 共享

| 层 | 技术选型 |
|---|---|
| 包管理 | pnpm 9+ |
| Monorepo | Turborepo |
| 类型校验 | TypeScript strict mode + zod |
| Linter | biome（比 ESLint+Prettier 快很多）|
| Git Hooks | husky + lint-staged |

## 2. Monorepo 目录结构

```
腾域aipod/                              ← Git 仓库根
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
│
├─ packages/
│   ├─ client/                         ← Electron 桌面客户端
│   │   ├─ package.json
│   │   ├─ electron.vite.config.ts
│   │   ├─ src/
│   │   │   ├─ main/                    ← 主进程
│   │   │   │   ├─ index.ts
│   │   │   │   ├─ ipc/                  ← IPC 处理器
│   │   │   │   ├─ adapters/             ← 跨模块共享适配器
│   │   │   │   │   ├─ bit-browser.ts
│   │   │   │   │   ├─ cdp.ts
│   │   │   │   │   ├─ photoshop.ts
│   │   │   │   │   ├─ chenyu-cloud.ts
│   │   │   │   │   ├─ grsai.ts
│   │   │   │   │   ├─ aliyun-bailian.ts
│   │   │   │   │   ├─ browser-profile-lock.ts
│   │   │   │   │   └─ temp-file-manager.ts
│   │   │   │   ├─ services/             ← 模块业务逻辑
│   │   │   │   │   ├─ collection/
│   │   │   │   │   ├─ generation/
│   │   │   │   │   ├─ detection/
│   │   │   │   │   ├─ photoshop/
│   │   │   │   │   ├─ title/
│   │   │   │   │   ├─ listing/
│   │   │   │   │   └─ orchestration/    ← v1.5
│   │   │   │   ├─ db/                   ← SQLite 模式 + 迁移
│   │   │   │   ├─ cache/                ← Skill/Provider/Workflow 缓存
│   │   │   │   ├─ activation/           ← 激活码客户端逻辑
│   │   │   │   └─ logger.ts
│   │   │   ├─ preload/
│   │   │   └─ renderer/                 ← React UI
│   │   │       ├─ index.html
│   │   │       ├─ src/
│   │   │       │   ├─ App.tsx
│   │   │       │   ├─ pages/
│   │   │       │   ├─ modules/          ← 每个模块的面板
│   │   │       │   │   ├─ collection/
│   │   │       │   │   ├─ generation/
│   │   │       │   │   ├─ detection/
│   │   │       │   │   ├─ photoshop/
│   │   │       │   │   ├─ title/
│   │   │       │   │   └─ listing/
│   │   │       │   ├─ components/
│   │   │       │   ├─ store/
│   │   │       │   └─ utils/
│   │   └─ resources/                    ← 打包资源（图标、内置图片）
│   │
│   ├─ server/                         ← Next.js 服务端
│   │   ├─ package.json
│   │   ├─ next.config.js
│   │   ├─ prisma/
│   │   │   ├─ schema.prisma
│   │   │   └─ migrations/
│   │   └─ src/
│   │       ├─ app/
│   │       │   ├─ api/                  ← /api/* REST 路由
│   │       │   │   ├─ activate/
│   │       │   │   ├─ status/
│   │       │   │   ├─ skills/
│   │       │   │   ├─ providers/
│   │       │   │   ├─ comfyui-workflows/
│   │       │   │   ├─ announcements/
│   │       │   │   ├─ client-version/
│   │       │   │   └─ telemetry/
│   │       │   ├─ admin/                ← /admin/* 管理后台
│   │       │   │   ├─ login/
│   │       │   │   ├─ codes/
│   │       │   │   ├─ customers/
│   │       │   │   ├─ skills/
│   │       │   │   ├─ providers/
│   │       │   │   ├─ comfyui-workflows/
│   │       │   │   ├─ announcements/
│   │       │   │   └─ client-versions/
│   │       │   └─ page.tsx
│   │       ├─ lib/
│   │       │   ├─ db.ts
│   │       │   ├─ auth.ts
│   │       │   └─ jwt.ts
│   │       └─ middleware.ts
│   │
│   └─ shared/                         ← 客户端和服务端共享
│       ├─ package.json
│       └─ src/
│           ├─ types.ts                  ← 共享 TS 类型
│           ├─ schemas.ts                ← zod schema
│           ├─ constants.ts
│           └─ errors.ts
│
├─ docs/                                ← 本文档目录
│   ├─ CONTEXT.md
│   ├─ PRD.md
│   ├─ spec/
│   └─ adr/
│
├─ references/                          ← 外部 API 参考资料
└─ scripts/                             ← 开发/构建脚本
```

## 3. 主进程与渲染进程的职责划分

### 主进程负责

- 文件系统操作（读写素材总目录）
- SQLite 数据库
- 所有 HTTP 调用（晨羽 / Grsai / 百炼 / 腾域服务器）
- Playwright（采集 + 上架）
- Photoshop COM 调用（Windows）
- Sharp 图像处理（在 Worker Thread 里）
- 长任务的状态管理
- API Key 解密（safeStorage）

### 渲染进程负责

- UI 展示和交互
- 通过 IPC 调用主进程
- 不直接访问文件系统
- 不直接调外部 API
- 不持有 API Key 明文

### IPC 协议

```ts
// 所有 IPC channel 名遵循 "module:action" 格式
// 主进程注册 handler，渲染进程用 invoke 调用

// 示例
ipcMain.handle('collection:start', async (event, params: StartSessionParams) => { ... })

// 渲染进程
const result = await window.api.collection.start(params)

// 所有 IPC 输入参数用 zod 校验，输出统一 { ok: boolean, data?, error? }
```

详见各模块 spec 的 "IPC 接口" 章节。

## 4. SQLite 数据库（.workbench/workbench.db）

### Schema 概览

```sql
-- 任务相关
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,                   -- UUID
  type          TEXT NOT NULL,                       -- "lightweight" | "full"
  module        TEXT NOT NULL,                       -- "collection" | "generation" | ...
  sku_code      TEXT,                                -- 货号，可为空（轻量任务有时没有）
  status        TEXT NOT NULL,                       -- "running" | "completed" | "failed" | "interrupted"
  config_json   TEXT NOT NULL,                       -- 任务配置快照
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER
);

CREATE TABLE workflow_steps (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  module        TEXT NOT NULL,
  step_order    INTEGER NOT NULL,
  status        TEXT NOT NULL,                       -- "pending" | "running" | "completed" | "failed" | "skipped"
  attempt       INTEGER DEFAULT 0,
  error_json    TEXT,
  started_at    INTEGER,
  completed_at  INTEGER
);

-- 产物追踪（核心血缘表）
CREATE TABLE artifacts (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT REFERENCES tasks(id),
  sku_code           TEXT,                           -- 关联货号
  print_id           TEXT,                           -- 关联印花
  step               TEXT NOT NULL,                  -- "collect" | "extract" | "txt2img" | "img2img" | "matting" | "mockup" | "title" | "listing"
  provider           TEXT,                           -- "comfyui-chenyu" | "grsai" | "aliyun-bailian" | "manual-import" | "internal"
  model_or_workflow  TEXT,                           -- 具体模型名或工作流 ID
  skill_id           TEXT,                           -- 用了哪个 skill
  skill_version      TEXT,
  source_artifact_ids TEXT,                          -- JSON 数组，上游产物 ID
  file_path          TEXT NOT NULL,
  file_size          INTEGER,
  file_hash          TEXT,                           -- SHA256
  prompt_snapshot    TEXT,                           -- LLM 提示词快照（可选）
  params_snapshot    TEXT,                           -- 参数快照
  created_at         INTEGER NOT NULL
);

CREATE INDEX idx_artifacts_sku_step ON artifacts(sku_code, step);
CREATE INDEX idx_artifacts_print ON artifacts(print_id);

-- 印花
CREATE TABLE prints (
  id              TEXT PRIMARY KEY,                  -- pri_xxx
  source_artifact_id TEXT REFERENCES artifacts(id),  -- 来源原图或上游印花
  category        TEXT,                              -- 用户标记的分类
  notes           TEXT,
  created_at      INTEGER NOT NULL
);

-- 货号（轻量记录，主要靠 artifacts 表的 sku_code 索引）
CREATE TABLE skus (
  code            TEXT PRIMARY KEY,
  template_batch  TEXT,                              -- 所属模板批次
  title           TEXT,
  language        TEXT,
  platform        TEXT,
  created_at      INTEGER NOT NULL
);

-- 上架状态（断点续传用）
CREATE TABLE listing_status (
  id              TEXT PRIMARY KEY,
  batch_path      TEXT NOT NULL,                     -- 05-货号成品/{batch}/
  sku_code        TEXT NOT NULL,
  platform        TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,                     -- bit-browser profile id
  status          TEXT NOT NULL,                     -- "pending" | "uploading" | "success" | "failed"
  draft_template_id TEXT,
  retry_count     INTEGER DEFAULT 0,
  last_attempted_at INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  UNIQUE(batch_path, sku_code, platform, workspace_id)
);

-- 客户端激活态（本地缓存）
CREATE TABLE activation_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  activation_token TEXT NOT NULL,
  device_name     TEXT,
  device_fingerprint TEXT NOT NULL,
  last_server_check INTEGER NOT NULL,
  cached_status_json TEXT NOT NULL                   -- { status, days_remaining, ... }
);

-- 采集会话和记录（详见 spec/02-collection.md）
CREATE TABLE collection_sessions (...);
CREATE TABLE collection_records (...);

-- 索引
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_module ON tasks(module);
CREATE INDEX idx_workflow_steps_task ON workflow_steps(task_id);
```

详细 schema 见各模块 spec。

## 5. 缓存目录（.workbench/cache/）

```
.workbench/cache/
├─ skills/                              ← 云端拉取的 skill 缓存
│   ├─ {skill_id}/
│   │   ├─ {version}.json
│   │   └─ latest.json (symlink 或字段)
├─ providers/                           ← Provider Registry 缓存
│   └─ registry.json
├─ comfyui-workflows/                   ← ComfyUI 工作流包元数据
│   ├─ index.json
│   └─ {workflow_id}/{version}.json    ← 含完整 workflow JSON
└─ announcements/
    └─ active.json
```

**缓存策略**：启动时拉一次；每 30 分钟后台静默刷新；用户进具体模块面板时若超 30 分钟立即刷新。离线场景用缓存，最长 7 天。

## 6. 临时文件（.workbench/tmp/）

由 TempFileManager 单例管理。

```
.workbench/tmp/
├─ collection/{taskId}/
├─ generation/{taskId}/
├─ detection/{taskId}/
│   └─ {imageHash}_preprocessed.jpg
├─ photoshop/{taskId}/
│   ├─ job-N.jsx
│   └─ job-N-result.json
├─ title/{taskId}/
└─ listing/{taskId}/
    └─ evidence/
        ├─ screenshots/
        └─ dom-snapshots/
```

**生命周期**：
- 任务启动时创建 `{taskId}/` 目录
- 单文件用完即删（成功后立即）
- 失败时保留 1 小时（用户重试可复用）
- 任务整体完成或取消 → 删整个目录
- 启动时扫描 `.workbench/tmp/`，删除超 24 小时的孤儿目录

## 7. 日志（.workbench/logs/）

```
.workbench/logs/
├─ main.log                             ← 主进程日志
├─ renderer.log                         ← 渲染进程日志
├─ {module}-{taskId}.log                 ← 模块任务日志
├─ crash/                                ← 崩溃日志
│   └─ crash-{timestamp}.json
└─ telemetry-queue.jsonl                ← 待上报错误队列
```

**格式**：pino JSON 每行一条
**保留**：30 天，超过自动清理
**用户操作**：设置面板可"导出压缩包"、"立即清理"

## 8. 全局并发与队列

```ts
// 主进程内单例
class TaskQueue {
  private queue: PriorityQueue<Task>
  private running: Set<Task> = new Set()
  private maxConcurrency: number = 3  // 用户可调

  // priority: 1 = user-initiated, 2 = orchestrator, 3 = retry
  async enqueue(task: Task, priority: 1 | 2 | 3): Promise<TaskResult>

  // 同时维护资源锁
  // - BrowserProfileLock（bit-browser profile）
  // - PhotoshopLock（PS 单实例）
  // - 同 SKU 唯一进行中任务锁
}
```

任务的优先级、资源依赖、可暂停粒度详见各模块 spec。

## 9. 错误处理基线

所有可预见的错误**必须分类**：

```ts
// shared/errors.ts
export const ErrorCode = {
  // 网络/远程
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  HTTP_429: 'HTTP_429',
  HTTP_5XX: 'HTTP_5XX',
  HTTP_4XX: 'HTTP_4XX',

  // 认证
  ACTIVATION_INVALID: 'ACTIVATION_INVALID',
  ACTIVATION_EXPIRED: 'ACTIVATION_EXPIRED',
  ACTIVATION_BANNED: 'ACTIVATION_BANNED',
  ACTIVATION_DEVICE_LIMIT: 'ACTIVATION_DEVICE_LIMIT',

  // 外部 API
  CHENYU_INSTANCE_DOWN: 'CHENYU_INSTANCE_DOWN',
  CHENYU_BALANCE_INSUFFICIENT: 'CHENYU_BALANCE_INSUFFICIENT',
  GRSAI_VIOLATION: 'GRSAI_VIOLATION',
  GRSAI_FAILED: 'GRSAI_FAILED',
  BAILIAN_QUOTA_EXCEEDED: 'BAILIAN_QUOTA_EXCEEDED',

  // 自动化
  BROWSER_NOT_CONNECTED: 'BROWSER_NOT_CONNECTED',
  PROFILE_LOCKED: 'PROFILE_LOCKED',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  SELECTOR_NOT_FOUND: 'SELECTOR_NOT_FOUND',
  PAGE_NOT_READY: 'PAGE_NOT_READY',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',

  // Photoshop
  PS_NOT_INSTALLED: 'PS_NOT_INSTALLED',
  PS_NOT_RUNNING: 'PS_NOT_RUNNING',
  PS_COM_FAILED: 'PS_COM_FAILED',
  JSX_EXEC_FAILED: 'JSX_EXEC_FAILED',

  // 业务
  SKU_DUPLICATE: 'SKU_DUPLICATE',
  TEMPLATE_NESTED_SO_UNSUPPORTED: 'TEMPLATE_NESTED_SO_UNSUPPORTED',
  // ...
} as const

export interface AppError {
  code: keyof typeof ErrorCode
  message: string                    // 用户友好的中文消息
  details?: Record<string, unknown>  // 调试信息
  retryable: boolean
  cause?: unknown
}
```

**重试策略**：只对 `retryable: true` 的错误自动重试，其他直接报给用户。指数退避，最多 3 次。

## 10. 关键不变量（Invariants）

以下事实任何代码都不能违反：

1. **5 大类目录下只放图片**（含子目录），元数据全在 SQLite
2. **05-货号成品 是上架域**，禁止其他模块写
3. **04-待套版印花 是生产入口**，可三种入图方式
4. **同一货号同时刻最多 1 个进行中任务**
5. **同一比特浏览器 profile 同时刻最多 1 个模块占用**
6. **服务端不接触图片/API Key/任务数据**
7. **客户端 API Key 永远 OS keychain 加密存储**
8. **激活码在 7 天内必须联网验证一次**
9. **印花 ID 全局唯一**，跨 provider 共享同一 ID 空间
10. **临时文件用完即删**，最长保留 24 小时

## 11. 性能预算

| 指标 | 预算 |
|---|---|
| 客户端启动 → UI 可点击 | < 5 秒 |
| 内存峰值（空闲）| < 400 MB |
| 内存峰值（跑 5 个并发任务）| < 1.5 GB |
| 单次 API 请求（云端）| < 500 ms |
| SQLite 单次查询 | < 50 ms |
| 图像预处理（1 张 1024px）| < 500 ms |
| 单次套版任务组 | < 30 秒（单 SO 模板）|

## 12. 已知约束

- macOS 上 PS 套版不可用（仅 Windows）
- 比特浏览器必须本地安装并运行（默认 127.0.0.1:54345）
- 用户必须自己注册晨羽智云/Grsai/阿里云百炼账号并购买额度
- 用户必须自己在店小秘后台创建草稿模板
- v1 不支持多语言 UI（仅中文）

## 13. 测试策略

| 测试类型 | 范围 | 工具 |
|---|---|---|
| 单元测试 | 工具函数、解析器、状态机 | vitest |
| 集成测试 | adapter 与 mock API | vitest + msw |
| E2E 测试 | UI 关键路径 | playwright |
| 真实页面验证 | 店小秘 / 各平台 | listing-automation-builder SKILL 流程 |

## 14. 部署

### 客户端

- **打包**：electron-builder
- **分发**：你的官网下载页（v1 不上应用商店）
- **更新**：v1 半自动（提示跳转下载页），v1.5 用 electron-updater

### 服务端

- **运行**：2 核 2G 云服务器（阿里云 Lighthouse / 腾讯云 Lighthouse）
- **数据库**：Neon Postgres 免费档（或自托管 Postgres）
- **反代**：Caddy 自动 SSL
- **CDN**：Cloudflare 免费档（含 DDoS 防护）
- **监控**：UptimeRobot 免费档
- **备份**：Neon 自动备份；自托管时 cron + rclone 到对象存储

## 15. 演进路线（v1 → v1.5）

参见 [../PRD.md#15](../PRD.md) 的"关键 v1 → v1.5 演进"。
