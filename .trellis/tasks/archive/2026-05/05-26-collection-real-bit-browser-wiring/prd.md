# 采集模块真实接入比特浏览器与脚本注入

## Goal

把采集模块从"代码自测过但生产链路是断的"变成"在用户本机能真正打开比特浏览器、注入监听脚本、采到真实跨境电商商品图"。原则：**简单代码、逻辑自洽**。

## Requirements

### 漏电点（本任务必须修）

**F1 注入链路接通**
- `CollectionSessionManager.startSession()` 在 CDP 连上后，必须：
  - 拿 platformRule
  - 对 context 现有所有 page 调 `addInitScript(scriptString)` + `exposeBinding('__poseidonSendToHost', handler)`
  - 监听 `context.on('page', handler)`，新开 tab 自动注入
  - 对每个**当前已加载**的 page 触发一次 `page.reload()`，让 initScript 生效（UI 上明确提示用户"会自动刷新当前页"）

**F2 平台规则本地 fallback**
- 新增 `packages/client/src/main/lib/collection-platform-rules.ts`：把 spec §2 的 7 条平台 + `allowed_domains` / `goods_url_patterns` / `entry_url` / `original_image_resolver` 全部内置为常量
- 暴露 `collection:list-platforms` IPC
- renderer `CollectionPage` 的 `platformOptions` 改为从 IPC 拿，删除硬编码

**F3 真实 profile 列表**
- 新增 `collection:list-profiles` IPC：返回 `BitBrowserClient.listProfiles()` + `listOpenProfileIds()`（新增，调 `/browser/pids/all`）的 join 结果，每条带 `online: boolean`
- renderer `App.tsx` 删除 `defaultCollectionProfiles` mock，改为调上述 IPC + 提供刷新按钮
- 列表项均可选（含未开），点开始时由主进程负责拉起

**M1 缺失 IPC 补齐**
- `collection:list-platforms`（见 F2）
- `collection:list-profiles`（见 F3）
- `collection:delete-record { record_id }`：删 DB 记录 + 删文件（若存在）
- `collection:resume-session`：调 `manager.resume()`
- `collection:open-profile { profile_id }`（内部辅助）：调比特浏览器 `POST /browser/open`，开始会话流程会自动调用

**M2 恢复按钮接通**
- `CollectionPage.tsx:551` 那个 disabled 按钮启用，onClick 调 `window.api.collection.resumeSession()`
- `manager.resume()` 内部：重新走 `connectToProfile` + 重新注入脚本（最简实现，不做接续语义）

**M3 浏览器关闭自动暂停**
- `cdp-client` 持有 browser 句柄；监听 `browser.on('disconnected')` → 调 `manager.handleBrowserClosed()`
- 仅此一种自动暂停场景。"离开允许域" / "主窗口关闭" 不在 MVP

### 启窗行为

- 用户在 UI 选 profile（可以是未开的）+ 平台 + 模式 → 点"开始采集会话"
- 主进程：
  1. 通过 `/browser/list` + `/browser/pids/all` 确认 profile 当前是否打开
  2. 若**未打开** → 调 `POST /browser/open?id=xxx` 拉起 → 拿到 CDP 端点
  3. 若**已打开** → 直接拿 `/browser/ports` 拿 CDP 端点
  4. `chromium.connectOverCDP(cdpUrl)` 接入
  5. 走 F1 注入流程
- profile 锁仍然按现有逻辑生效（一个 profile 不能被多个模块/会话同时占用）

## Acceptance Criteria

- [ ] 启动腾域 → 采集模块，看到比特浏览器的**真实** profile 列表，每条带"已打开"标记
- [ ] 点刷新可以看到新打开/关闭的 profile 状态变化
- [ ] 选一个**未打开**的 profile + Temu + 点击模式 → 点开始 → 腾域自动拉起该 profile 窗口
- [ ] 选一个**已打开**的 profile（停在某 Temu 商品页）→ 点开始 → 当前页自动 reload 一次 → 注入生效
- [ ] 在 Temu 商品页点商品大图 → 主窗口出现"请填货号"浮窗 → 填写 → 真实图保存到 `01-采集/{货号}/`
- [ ] 在 Temu 列表页滚动（选滚动模式时）→ 散图池里出现真实图
- [ ] 同 profile 在比特浏览器里 Cmd+T 新开标签 → 进入 Temu 也能正常采集
- [ ] 关闭比特浏览器窗口 → 腾域 UI 自动切到"已暂停"状态
- [ ] 点"恢复" → 自动重连 + 重新注入 → 继续采集
- [ ] 失败记录可点"删除"消失 + 文件被删（若存在）
- [ ] `pnpm -F @tengyu-aipod/client typecheck && lint && test` 全绿
- [ ] 4 个现有 E2E 不退步；新增 1 个端到端"启动会话 → reload → 注入 → binding 回流"用例

## Definition of Done

- 主理人在 Mac 本机跑通完整链路：列窗口 → 选 profile → 开始 → 真实采集 ≥10 张 → 关闭浏览器自动暂停 → 恢复 → 停止 → CSV 导出
- typecheck / lint / test / 4 个旧 E2E 全绿
- 不影响 listing / detection / generation 现有功能
- prd 验收点全勾

## Out of Scope（明确）

- 云端 `/api/platform-rules` 拉取与缓存（单独 task）
- 自定义平台 CRUD UI（v1.5）
- 散图池"批量补填货号"视图（v1.5）
- 30 天审计日志（v1.5）
- "离开允许域 / 主窗口关闭" 自动暂停（v1.5）
- 服务端代理任何采集流量
- E2E 接真比特浏览器（CI 跑不动，本地手测即可）

## Technical Approach

### 关键 sequence（startSession 真接通版）

```
renderer.startSession({profile_id, platform_key, mode})
  → ipc 'collection:start-session'
  → manager.startSession()
      ├─ lock.acquire(profile_id)
      ├─ db.write(starting)
      ├─ rule = platformRules.get(platform_key)             ← F2
      ├─ if !isOpen(profile_id):                            ← 启窗
      │     await bitBrowserClient.openProfile(profile_id)
      ├─ cdpUrl = await bitBrowserClient.getCdpEndpoint(profile_id)
      ├─ browser = await chromium.connectOverCDP(cdpUrl)
      ├─ context = browser.contexts()[0]
      ├─ for page of context.pages():                       ← F1 现有 tab
      │     await wirePage(page, rule)
      │     await page.reload().catch(noop)                 ← 让 initScript 生效
      ├─ context.on('page', page => wirePage(page, rule))   ← F1 后续 tab
      ├─ browser.on('disconnected', () =>                   ← M3 自动暂停
      │     manager.handleBrowserClosed())
      └─ db.write(active) + emit('session-started')

wirePage(page, rule):
  await page.exposeBinding('__poseidonSendToHost', (_src, data) =>
    collectionClickService.dispatch(data, { rule, mode })   ← 新加纯函数入口
  )
  await page.addInitScript(createCollectionInjectedScript({ platformRule: rule }))
```

### 改动清单（按文件，预估行数）

| 文件 | 改动 | 估行 |
|---|---|---|
| `packages/client/src/main/lib/collection-platform-rules.ts` **(新)** | 内置 7 个平台常量 + `getPlatformRule(key)` + `listPlatformRules()` | ~100 |
| `packages/client/src/main/lib/bit-browser-client.ts` | 加 `listOpenProfileIds()` / `getCdpEndpoint(profile_id)` / `openProfile(profile_id)` 若缺 | +30 |
| `packages/client/src/main/lib/cdp-client.ts` | `connectToProfile` 返回 `{browser, page0}` 并暴露 `onDisconnected(handler)` | +20 |
| `packages/client/src/main/lib/collection-session-manager.ts` | startSession 接注入流程；resume 同上；新加 wirePage 私有方法；扩 IPC | +90 |
| `packages/client/src/main/lib/collection-click-service.ts` | 暴露 `dispatch(payload, ctx)` 给 manager 直调；保留旧 IPC | +20 |
| `packages/client/src/main/lib/collection-record-store.ts` | 加 `deleteRecord(id)` | +20 |
| `packages/client/src/preload/index.ts` | 暴露 5 个新 IPC | +30 |
| `packages/client/src/renderer/src/App.tsx` | mock → 真 IPC；接恢复按钮 | +35 |
| `packages/client/src/renderer/src/features/collection/CollectionPage.tsx` | platforms 改受控；恢复按钮启用；删除按钮 + 提示"会自动刷新" | +25 |
| `packages/client/src/renderer/src/vite-env.d.ts` | 类型补 | +15 |
| 单测：`collection-platform-rules.test.ts` **(新)** | 7 条规则结构正确 | +20 |
| 单测：`collection-session-manager.test.ts` | "startSession 注入脚本被调用 + 多 tab + disconnected → pause" | +40 |
| 单测：`bit-browser-client.test.ts` | listOpenProfileIds / openProfile | +20 |
| E2E：`collection.spec.ts` | 加 "启动会话 → reload → binding 回流" 用例（chromium launch + connectOverCDP） | +60 |

**总计约 525 行新增/改动**，单 PR 可控。

## Decision (ADR-lite)

**Context**: 采集模块代码层完备但生产链路断在 3 个致命点，spec §13 列出的 IPC 缺一半，spec §8.3 描述的自动暂停场景在主进程没有事件源绑定。

**Decision**:
- 范围 = 致命 3 + 中等 3，单 PR 落地
- 平台规则用主进程内置常量（云端派发归独立 task）
- 启窗：腾域主动调 `/browser/open` 拉起未打开的 profile
- 注入时机：addInitScript + 启动时 reload 一次当前页
- 多 tab：context.pages() + context.on('page') 全覆盖
- 自动暂停：MVP 只接 `browser.on('disconnected')` 一种

**Consequences**:
- 用户在比特浏览器里手填的筛选/位置在会话启动那一刻会丢（reload 一次）—— UI 上明确提示
- 平台规则若变动需要发版（云端派发到下一个 task 解决）
- "离开允许域 / 主窗口关闭" 不自动暂停 —— 用户需要手动停止

## Technical Notes

- 比特浏览器本机 API 已验证：`/browser/list`、`/browser/pids/all`、`/browser/ports`、`/browser/open` 可用
- 开发期测试 profile: `02b6125939804e04bdf61c75da386c0a`（"1111"），CDP 端口 58791
- `bit-browser-client.ts:50` 已有 `listProfiles()`
- spec/02 §7.3 / §13 / §8.3 是改造对照基线
- `createCollectionInjectedScript` 已实现且单测过，本任务**不动**它

## Research References

无外部研究：所有改造模式（CDP、Playwright addInitScript、exposeBinding、多 page 监听）都在本仓库现有代码或 Playwright 标准 API 内有现成参考。
