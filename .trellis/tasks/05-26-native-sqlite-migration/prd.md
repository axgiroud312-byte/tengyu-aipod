# native-sqlite-migration — 用 `node:sqlite` 替代 `better-sqlite3`

## Goal

消除"主进程 native 模块 ABI 与 Electron 内置 V8 错位"这一类 bug 的**根因**：把
`better-sqlite3`（外部 native 模块，需 prebuild / electron-rebuild）替换为
`node:sqlite`（Electron 内置 Node 24.15 自带，无外部编译）。同时建立守门
机制（postinstall ABI 检查 + 主进程 native smoke），让此类问题永久无法
静默通过。

## What I already know

### 故障复现
- 当前 client 报错：`NODE_MODULE_VERSION 137 vs 146`（系统 Node 24.14.1 编译
  的 better-sqlite3 与 Electron 42 内置 V8 不兼容）
- 升级到 `better-sqlite3@12.10.0`（latest）后依然过不去：上游 release notes
  写明 "Temporarily rollback support for Electron v42 prebuilds"；源码本身的
  `v8::External::New(isolate, addon)` 2 参数调用与 V8 13+ 的新 3 参数签名
  不兼容，本地 node-gyp 编译失败
- 这是上游 WiseLibs/better-sqlite3 还没适配新 V8 API 的真空期

### 目标技术栈
- **Electron 42.2.0** 内置 **Node 24.15.0** + V8 14.8
- `node:sqlite` 从 Node v22.13.0 起**无需 `--experimental-sqlite` flag**，
  v25.7.0 起为 Release Candidate（Stability 1.2）
- 在 Electron 42 主进程中 `import { DatabaseSync } from 'node:sqlite'` 直接
  可用，零额外配置

### API 兼容性盘点
`node:sqlite.DatabaseSync` 对当前代码的 API 覆盖：

| better-sqlite3 API | node:sqlite 对应 | 改造成本 |
|---|---|---|
| `new Database(path)` | `new DatabaseSync(path)` | 中央 1 处 |
| `.prepare(sql)` | 同名同签名 | 0 |
| `.exec(sql)` | 同名同签名 | 0 |
| `stmt.run(...)` → `{changes, lastInsertRowid}` | 同名同返回结构 | 0 |
| `stmt.all(...)` / `.get(...)` | 同名同签名 | 0 |
| `.close()` | 同名 | 0 |
| `db.pragma('journal_mode = WAL')` | 改为 `db.exec('PRAGMA journal_mode = WAL')` | **1 处**（`workbench-db.ts:16`） |
| `db.transaction(fn)` | ❌ 无 helper，需手写 `BEGIN/COMMIT` | **0 处使用** |

### 影响面（grep 确认）
- 13 个生产 ts 文件 + 6 个测试 + 1 个 e2e 引用 `better-sqlite3`
- 其中 **类型引用占主体**，几乎全部用 `Pick<Database.Database, 'exec' | 'prepare' | 'close'>`
  结构性子类型 → 中央换 type alias 后 consumer 零修改
- 直接 `import Database from 'better-sqlite3'` 仅 2 处（`title-service.ts`、
  `collection-record-store.ts`）
- `new Database(...)` 仅 1 处（`workbench-db.ts`）

### 现有构建/打包配置
- `electron-vite.config.ts` 用 `externalizeDepsPlugin` 把 dependencies 外置
  → 当前 better-sqlite3 走 `node_modules/.node` 加载
- 项目**没有 electron-builder 配置**（打包阶段对 native 模块无显式策略）
- 换成 `node:sqlite` 后**不需要任何打包特殊处理**（Electron 自带）

### 现有数据
- Dev DB 路径：`{workbench_root}/.workbench/workbench.db`
- 主理人本机有真实数据；SQLite 文件格式跨 driver 兼容 → **不需要数据迁移**
- 测试用 `:memory:` DB；e2e 用临时目录 → **不需要 fixture 变更**

## Assumptions (temporary)

1. **A1 — node:sqlite 在 Electron 42 主进程稳定可用**：基于 Node 24.15.0 +
  无 flag 的事实推断，但需要落地后跑一次主进程 boot smoke 才能 100% 确认。
  **验证手段**：实施 PR1 后启动 `pnpm -F client dev`，主进程能 import
  `node:sqlite` 并打开测试 db，不报 ERR_UNKNOWN_BUILTIN_MODULE。
2. **A2 — `Stability 1.2 RC` 对生产桌面应用够用**：node:sqlite 不是"stable 2.0"，
  Node 团队保留 API 微调权。但实际 API 自 v22 起没有破坏性变更，且我们用的是
  最基础子集（exec/prepare/run/all/get），风险可控。
3. **A3 — 不引入 ORM**：当前是裸 SQL，迁移目标也是裸 SQL，**不顺手做 ORM 升级**。

## Decisions (locked)

- **D1 — 守门时机：postinstall hook**。`packages/client/package.json` 加
  `"postinstall": "node scripts/check-native-abi.mjs"`。错位在每次 install
  立刻爆，本地 + CI + 协作者首次拉代码三个场景全覆盖。
- **D2 — 完全移除 `@electron/rebuild`**。`sharp` 在 Electron 42 darwin-arm64
  有官方 prebuild，无需 rebuild。真出问题再补，不养"以防万一"的依赖。
- **D3 — ADR-0009 明文写回退路径**。回退候选确定为 `node-sqlite3-wasm`
  （纯 WASM，零 native 编译，永久跨平台兼容），并写明触发回退的判据：
  (a) Node 团队对 node:sqlite 引入破坏性 API 变更且回滚成本高于 1 人日；
  (b) 性能实测下降 > 20%；(c) 出现无法回避的功能缺失。

## Requirements (evolving)

### R1 — 代码层
- 新建 `packages/client/src/main/lib/sqlite.ts`，导出统一类型 `SqliteDatabase`
  和工厂 `openSqliteDatabase(path)`，**所有消费方仅依赖这一个模块**
- 替换 `workbench-db.ts` 的 `better-sqlite3` import 为 `node:sqlite`
- 所有 `import Database from 'better-sqlite3'` / `import type { Database } from
  'better-sqlite3'` 改为从 `./sqlite.ts` 导入
- 所有 `Database.Database` / `BetterSqliteDatabase` 类型别名归一为
  `SqliteDatabase`
- `.pragma()` 改 `.exec('PRAGMA ...')`

### R2 — 依赖层
- `packages/client/package.json`：
  - 移除 `better-sqlite3`
  - 移除 `@types/better-sqlite3`
  - 移除 `@electron/rebuild`（上一轮加进去的）
  - 移除 `rebuild:native` script
- `package.json` root：从 `pnpm.onlyBuiltDependencies` 删除 `better-sqlite3`
- 检查并保留 `sharp`（待 Q2 确认）

### R3 — 守门层（核心防退化）
- 新建 `packages/client/scripts/check-native-abi.mjs`：
  - 列出 `node_modules/**/*.node`（仅扫 client 工作区相关 path）
  - 读取 Electron 期望 ABI（`electron --abi` 或写死 142+，未来升级时更新）
  - 不匹配则 exit(1) 并打印修复指令
- 接入位置：见 Q1
- 新建 `packages/client/src/main/lib/native-smoke.ts`：
  - 主进程启动时 boot 阶段 require `node:sqlite` + 任何其他关键 native module
  - 任一失败：写 pino error log + `dialog.showErrorBox` 显示开发者可读信息
  - 在生产构建里也保留（早爆比晚爆好）

### R4 — 文档层
- 新增 `docs/adr/0009-replace-better-sqlite3-with-node-sqlite.md`：
  - 背景：本次事故 + 上游兼容真空期分析
  - 决策：用 `node:sqlite`
  - 后果：含 RC 状态风险 + 回退候选
- 更新 `docs/spec/09-cross-cutting.md`：新增"Native 兼容矩阵"小节，列出
  当前 client 所有 native module + 兼容性来源（内置 / prebuild / 自建）
- 更新 `CLAUDE.md`："不要直接 `import Database from 'better-sqlite3'`，从
  `main/lib/sqlite.ts` 导入"
- 更新 `packages/client/CLAUDE.md` 或对应 spec：sqlite 用法约定 + 不允许
  在主进程外加新 native 包的红线

### R5 — 数据迁移层
- **本地 dev DB 不需要导出/导入**：SQLite 文件格式跨 driver 兼容
- 在 native-smoke 里加一次 `PRAGMA quick_check`，启动时若 DB 损坏立即告警
- 在 README / spec 加一句"切换 sqlite 后无需对现有 `.workbench/workbench.db`
  做任何处理"

## Acceptance Criteria (evolving)

- [ ] `pnpm -F client dev` 启动后，"采集模块 → 开始采集会话"完整跑通，
  数据库读写正常
- [ ] `packages/client/package.json` 不含 `better-sqlite3`、
  `@types/better-sqlite3`、`@electron/rebuild`
- [ ] root `package.json` 的 `pnpm.onlyBuiltDependencies` 不含 `better-sqlite3`
- [ ] `grep -r "better-sqlite3" packages/client/src` 返回 0 行
- [ ] `pnpm -F client type-check` 通过
- [ ] `pnpm -F client test` 全部通过（含所有原 better-sqlite3 相关单测）
- [ ] `pnpm -F client e2e` 至少 detection.spec.ts 通过
- [ ] `node packages/client/scripts/check-native-abi.mjs` 在当前环境
  以 exit 0 结束
- [ ] 故意把一个 `.node` 文件改坏 ABI，check-native-abi 能 exit 1 报错
  （手动验证，不入自动化）
- [ ] 故意删除 node:sqlite 调用前的 import，主进程 native-smoke 能立即
  报错并阻断启动
- [ ] `docs/adr/0009-*.md` 已写
- [ ] `docs/spec/09-cross-cutting.md` 新增"Native 兼容矩阵"小节
- [ ] `CLAUDE.md` 含 sqlite 使用红线

## Definition of Done

- 所有 Acceptance Criteria 勾选完成
- `pnpm lint` / `pnpm type-check` / `pnpm test` 在 root 工作区全绿
- ADR-0009 + spec/09 + CLAUDE.md 改动入同一个 PR
- PR 描述含"故障复盘 + 根因 + 此后如何防退化"段落
- 不引入新的 native 依赖

## Out of Scope (explicit)

- ❌ 不顺手做 ORM 升级（依然裸 SQL）
- ❌ 不改 SQL schema、不动数据迁移工具
- ❌ 不替换 `sharp`（除非 Q2 决定要动）
- ❌ 不在 `packages/server` 改任何东西（server 用 Prisma + Postgres，与
  本次无关）
- ❌ 不解决 `packages/client` 现有未提交改动（card.tsx / index.css /
  Header / Shell / Sidebar / _commons），让它们留着，本任务只触 sqlite
  相关文件
- ❌ 不引入新数据库（保留 SQLite + WAL）

## Technical Notes

### node:sqlite RC 风险评估
- "Stability 1.2 Release Candidate" 意思是 Node 保留 API 微调权，但**自
  v22 起未发生破坏性变更**
- 我们用的 API 都是最基础子集（exec/prepare/run/all/get/close）—— 这些是
  SQLite 通用语义，几乎不可能变
- 极端情况若 Node API 真破坏：回退到 `node-sqlite3-wasm`（纯 WASM，永久
  跨平台）需 ~ 半天工作量，仍然不需要任何 native 编译

### 类型策略（关键）
- 中央 `sqlite.ts` 导出：
  ```ts
  import { DatabaseSync, type StatementSync } from 'node:sqlite'
  export type SqliteDatabase = DatabaseSync
  export type SqliteStatement = StatementSync
  export function openSqliteDatabase(path: string): SqliteDatabase { ... }
  ```
- 现有 `Pick<Database.Database, 'exec' | 'prepare'>` 改成
  `Pick<SqliteDatabase, 'exec' | 'prepare'>` —— 字面替换即可，结构相同

### 测试策略
- 单测里既有的 `:memory:` 用法直接兼容 `new DatabaseSync(':memory:')`
- e2e (Playwright + Electron) 不需要改

### 风险列表
- R1: node:sqlite 实际启动时报错 → A1 boot smoke 立即暴露，影响 0
- R2: 某个边角 API（如 `setReadBigInts`）有行为差异 → 现状没用到
- R3: 性能 → 都是 SQLite 库的 N-API 绑定，差异 <5%

### 实施 PR 切分建议（不强制）
- **PR1**：新建 `sqlite.ts` + 中央迁移 `workbench-db.ts` + 替换所有
  imports + 删除 better-sqlite3 依赖 + 跑通 dev + 单测 + e2e
- **PR2**：守门脚本 + native-smoke + postinstall 接入
- **PR3**：ADR-0009 + spec/09 兼容矩阵 + CLAUDE.md 红线
- 三个 PR 可在同一 task / 同一分支内分 commit 完成（任务范围是一个整体）
