# ADR-0009 — 用 node:sqlite 替代 better-sqlite3

**状态**：已采纳
**日期**：2026-05-26

## 背景

客户端主进程曾因 `better-sqlite3` 外部 native 模块与 Electron 内置 V8 / Node ABI
不一致而启动失败。本次故障表现为本机 Node 编译出的 `NODE_MODULE_VERSION 137`
与 Electron 42 期望的 `NODE_MODULE_VERSION 146` 不匹配。

继续升级 `better-sqlite3` 也没有稳定解决问题：当时上游对 Electron v42 的 prebuild
支持处在真空期，且本地编译路径会撞到 V8 13+ API 签名变化。问题根因不是 SQL 代码，
而是"外部 native sqlite driver 需要与 Electron ABI 对齐"。

## 决策

主进程 SQLite 统一改用 Electron 内置 Node 提供的 `node:sqlite`：

- 唯一允许直接 `import 'node:sqlite'` 的位置是 `packages/client/src/main/lib/sqlite.ts`
- 业务代码只依赖中央类型别名 `SqliteDatabase`
- 打开数据库统一走 `openSqliteDatabase(path)`
- 不引入 ORM，不改 schema，不做数据迁移

选择 `node:sqlite` 的核心理由是：它跟随 Electron 内置 Node 生命周期发布，SQLite 绑定与
Electron ABI 天然一致，不再依赖第三方 prebuild 或 `electron-rebuild`。

## 后果

### 正面

- 消除外部 native sqlite 依赖
- 删除 `better-sqlite3`、`@types/better-sqlite3`、`@electron/rebuild`
- `pnpm install` 不再需要为 sqlite 编译或下载 Electron ABI 对应产物
- 启动阶段通过 native smoke 提前验证 SQLite 可用性

### 风险

- `node:sqlite` 当前仍是 Release Candidate（Stability 1.2），Node 团队保留 API 微调权
- 业务代码必须继续只使用基础 API 子集：`exec`、`prepare`、`run`、`all`、`get`、`close`
- 新增 native 依赖必须先更新兼容矩阵并写 ADR

### 回退路径

如果出现以下任一条件，回退候选是 `node-sqlite3-wasm`：

- `node:sqlite` 出现 breaking change，且迁移成本超过 1 人日
- SQLite 性能实测下降超过 20%
- 出现 `node:sqlite` 无法覆盖且业务必须依赖的功能缺口

## 参考

- Task：`.trellis/tasks/05-26-native-sqlite-migration/`
- Commit：PR 合并后补
