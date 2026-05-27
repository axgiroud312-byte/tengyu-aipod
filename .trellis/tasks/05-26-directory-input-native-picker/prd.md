# 全前端目录输入接入系统文件选择器

## Goal

让客户端所有「目录路径输入框」旁都有一个统一的「选择目录」按钮，点击后唤起 Electron 系统文件夹选择器（`dialog.showOpenDialog({ properties: ['openDirectory'] })`），用户不再依赖手敲路径。

## What I already know

### 主进程现有 IPC 通道（4 个 openDirectory dialog）

- `onboarding:choose-workbench-root` — 选「素材总目录」
- `photoshop:choose-print-folder` — 选印花文件夹
- `title:choose-batch-dir` — 选标题批次目录
- `listing:choose-batch-dir`（在 runner.ts 内）— 选上架批次目录

### 渲染层目录输入位置盘点（6 处）

| # | 文件 / 字段 | 现有按钮 | 是否已接系统选择器 |
|---|---|---|---|
| 1 | `OnboardingPage.tsx:336` 素材总目录 | 浏览 | ✅ |
| 2 | `PhotoshopPage.tsx:250` 印花输入目录 | FolderOpen | ✅ |
| 3 | `PhotoshopPage.tsx:348` 货号成品输出目录 | 打开（仅 shell.openPath） | ❌ |
| 4 | `CollectionPage.tsx:588` 采集输出目录 | 清空（命名叫 `onOutputDirBrowse` 但实际是清空字段） | ❌ |
| 5 | `TitlePage.tsx:179` 批次目录 | 选择 | ✅ |
| 6 | `components/listing-workbench.tsx:684` 批次目录 | 选择 | ✅ |

### 现有模式（已在用）

- 主进程：`ipcMain.handle('xxx:choose-yyy', …)`，返回 `{ ok: true, data: { path } } | { ok: false, error: { code: 'CANCELED'/'CANCELLED', … } }`
- preload：在对应模块下暴露 `chooseXxx()` 异步方法
- 渲染：旁边放一个 `<Button variant="secondary">` 带 `FolderOpen` 图标，点击后回填 input

> 现状不一致点：error code 有 `CANCELED` 与 `CANCELLED` 两种拼写；按钮文案有「浏览」「选择」「FolderOpen 图标无文字」三种。

## Open Questions

~~所有问题已答。~~ 见 Decision。

## Decision (ADR-lite, final)

**Context**：4 处目录输入已能选，2 处只能手敲；按钮文案 / 图标 / error code 拼写分裂。

**Decision**：B1 + C3 + 推荐文案 ——
1. renderer 抽出 `<DirectoryPicker value onChange title? defaultPath? showOpen? />` 组件
   - 「选择目录」按钮内置（必有，文案=「选择目录」，图标=`FolderOpen`）
   - 「打开目录」按钮可选（`showOpen` prop，文案=「打开」，图标=`ExternalLink`，调 `shell.openPath`）
   - 「清空」不内置（CollectionPage 自行保留）
2. 主进程新增通用 IPC `dialog:choose-directory({ title?, defaultPath? })`
   - 返回结构：`{ ok: true, data: { path } } | { ok: false, error: { code: 'CANCELED', message } }`
   - error code 统一为 `CANCELED`（单 L）
   - 用 zod 校验入参
3. preload 暴露 `window.api.dialog.chooseDirectory(input?)`
4. 删除 4 处旧 IPC：`onboarding:choose-workbench-root` / `photoshop:choose-print-folder` / `title:choose-batch-dir` / `listing:choose-batch-dir`
   - 调用方（OnboardingPage / PhotoshopPage 印花区 / TitlePage / listing-workbench）改用 `<DirectoryPicker>`
5. 补齐 CollectionPage 采集输出目录 + PhotoshopPage 货号成品输出目录的「选择目录」按钮
6. 修正 CollectionPage 的 `onOutputDirBrowse` → `onOutputDirClear`（命名 vs 行为一致）

**Consequences**：好处是组件 / IPC / 文案 / 图标全栈一致，后续新加目录输入零成本；风险是动了 4 处稳定调用方，需 Codex 完成后由主理人手动点过所有目录输入框确认无回归。

## Requirements (final)

- [ ] 新增主进程 IPC `dialog:choose-directory`，入参 zod 校验，返回统一结构
- [ ] preload 在 `window.api.dialog.chooseDirectory()` 暴露
- [ ] 渲染层新增 `<DirectoryPicker>` 组件
- [ ] 删除 4 处旧 IPC handler + preload 方法
- [ ] OnboardingPage / PhotoshopPage（印花区+输出区）/ TitlePage / listing-workbench / CollectionPage 全部迁移到 `<DirectoryPicker>`
- [ ] CollectionPage 新增「选择目录」按钮，原「清空」按钮保留，handler 重命名 `onOutputDirClear`
- [ ] 取消选择时保持原值不变
- [ ] `pnpm typecheck` / `pnpm lint` 全绿

## Acceptance Criteria (final)

- [ ] 6 处目录输入框旁都有「选择目录」按钮，点击弹出系统 dialog 并能回填路径
- [ ] PhotoshopPage 印花/输出 两处都有「选择目录」+「打开」两个按钮
- [ ] CollectionPage 输出目录 有「选择目录」+「清空」两个按钮，输入数字无前导 0（沿用之前修复）
- [ ] 取消 dialog 时所有输入框值不变
- [ ] 主进程旧 4 个 IPC handler 删除，全仓 grep `choose-workbench-root|choose-print-folder|title:choose-batch-dir|listing:choose-batch-dir` 返回 0 命中
- [ ] Codex 完成后 main 分支可直接打包跑通

## Implementation Plan（单一分支 / 单 PR / 3 个 commit）

**分支名**：`feat/directory-picker-uniform`

**Commit 1 — 基础设施**
- 主进程：`packages/client/src/main/dialog.ts` 新增 `registerDialogIpc()` → `dialog:choose-directory` handler
- 在 `main/index.ts` 注册
- preload：`packages/client/src/preload/index.ts` 增加 `dialog.chooseDirectory()` 暴露 + 类型
- renderer：`packages/client/src/renderer/src/components/directory-picker.tsx` 实现 `<DirectoryPicker>`

**Commit 2 — 迁移已有 4 处 + 删除旧 IPC**
- OnboardingPage（素材总目录）→ 用 `<DirectoryPicker>` + `defaultPath={defaultWorkbenchRoot}`
- PhotoshopPage（印花输入目录）→ `<DirectoryPicker>`
- TitlePage（批次目录）→ `<DirectoryPicker>`
- listing-workbench（批次目录）→ `<DirectoryPicker>`
- 删除主进程 4 个旧 handler、preload 4 个旧方法、App.tsx 等处的 wiring 代码

**Commit 3 — 补齐缺失 2 处**
- CollectionPage 输出目录：加「选择目录」按钮（保留「清空」，handler 重命名 `onOutputDirClear`）
- PhotoshopPage 货号成品输出目录：加「选择目录」按钮 + showOpen，保留原「打开」按钮（实际就是 showOpen 模式）

## Definition of Done (final)

- 3 个 commit 全部完成
- `pnpm typecheck` / `pnpm lint` 全绿
- 主理人在本机点过 6 处「选择目录」按钮，全部能弹 dialog 并回填
- 主理人在 PhotoshopPage 点过「打开」按钮，能在 Finder/资源管理器里打开目录
- 删除旧 IPC 后 grep 验证零残留
- PR 合并到 main → 删除 `feat/directory-picker-uniform` 分支

## Requirements (evolving)

- 缺失的两处必须补齐「选择目录」按钮：
  - `CollectionPage` 采集输出目录
  - `PhotoshopPage` 货号成品输出目录
- 点击「选择目录」→ 弹系统对话框 → 用户确认后回填到 input
- 用户取消时保持原值不变，不报错

## Acceptance Criteria (evolving)

- [ ] 采集页「4. 输出目录」旁边有「选择目录」按钮，点击可选目录并回填
- [ ] PS 套版页「输出目录」旁有「选择目录」按钮
- [ ] 取消选择不改变现有值
- [ ] 按钮文案 / 图标在所有目录输入位置一致

## Definition of Done

- 改动通过 `pnpm typecheck` / `pnpm lint`
- 主理人本机点过两个新按钮，确认能弹出 dialog 并回填路径
- Codex 完成后回到 main，分支删除

## Out of Scope (explicit)

- 不增加"历史路径下拉"
- 不做拖拽目录入框
- 不改 onboarding / title / listing 三处已有按钮的行为（除非用户要求统一文案/图标）

## Technical Notes

- 现有 IPC 返回结构已稳定，新接两处时复用现成模式即可（不需新建通用 dialog 通道，除非走"统一抽象"路线）
- `CollectionPage` 现有 `onOutputDirBrowse` 实际是"清空"，需要重新设计：要么改名为 `onOutputDirClear` 并新增 `onOutputDirBrowse`，要么把"清空"放进另一个按钮位
- error code 两种拼写应在本次统一为 `CANCELED`

## Branch / 开发流程

- 由主理人在隔壁终端 Codex 实施
- 分支名建议：`feat/directory-picker-uniform`
- 开发完成 → PR → squash merge → 删除分支
