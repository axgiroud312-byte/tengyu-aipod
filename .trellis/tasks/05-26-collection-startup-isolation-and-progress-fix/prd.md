---
name: 05-26-collection-startup-isolation-and-progress-fix
title: 采集启动隔离与进度可见性修复
status: planning
owner: 高博
spec_refs:
  - docs/spec/02-collection.md §3, §6, §8.2
---

# 采集启动隔离与进度可见性修复

## 1. 背景

用户在 v1 自测时报告：

1. 点「开始采集会话」后，比特浏览器一下子打开/刷新十几个 tab，URL 全是 `dianxiaomi.com/...`（店小秘）。
2. 完全分不出哪个 tab 是被腾域监听的。
3. aipod 主屏停在「启动中…」，没有明显进度，用户不确定采集是否真的在跑。

经定位（详见 §3 根因），三个现象都在 `collection-session-manager.ts:connectAndWire` 这一处代码路径里。

## 2. 目标

让采集启动满足以下三条：

- **F1 不动用户的现存 tab**：启动采集时**只**操作"采集 tab"这一个；其他比特浏览器里已经存在的 tab（包括上架模块留下的店小秘）保持原样、不刷新、不注入。
- **F2 落到正确的平台首页**：采集 tab 应该处于所选 platform 的 `entry_url`（如 temu → `https://www.temu.com`）。如果已有 tab 的 URL 在 `allowed_domains` 内则复用；否则新开一个并 `goto(entry_url)`。
- **F3 计数式进度反馈**：会话进入 active 后，主屏始终显示「已采集 N 张 · 最近一张 X 秒前」，每采到一张实时 +1。N=0 时也明确写「0 张 · 等待用户在浏览器内操作」，让用户清楚"采集器在工作，等你点图"。

## 3. 根因（让 Codex 直接对照修）

### Bug 1 — 把所有 tab 都 reload

`packages/client/src/main/lib/collection-session-manager.ts:309-333` `connectAndWire`：

```ts
const pages = context.pages()
for (const page of pages) {
  await this.wirePage(runtime, page)
  await page.reload().catch(() => null)   // ← 元凶
}
```

当用户的比特浏览器 profile 里已经开着 N 个 tab（比如上架用过没关），这段会把全部 N 个 tab 都 `addInitScript` + `reload`，看起来就像"采集打开了十几个网址"。

### Bug 2 — 不导航到 entry_url

同一段循环只 reload，没有任何 `page.goto(platformRule.entry_url)`。所以浏览器停在店小秘就 reload 店小秘，永远到不了 temu.com。

`collection-platform-rules.ts` 里 `entry_url` 各平台填的都是对的（已确认），**不需要改规则**，只需要在 session manager 里用上它。

### Bug 3 — 启动期与采集期 UI 都无感

- `startSession` 阻塞 `await connectAndWire`，而 connectAndWire 又串行 reload 全部 tab，每个 reload 几秒 = 启动很久。修完 Bug 1 后这个问题自然消失（只有 1 个 tab）。
- 主屏切到「最近保存」面板的条件是 `session != null`，但首张图采到之前 `records.length === 0`，会显示"暂无采集记录"，没有"我正在听"的信号。

## 4. 实施要点

### 4.1 改造 `connectAndWire`（必须）

将 `packages/client/src/main/lib/collection-session-manager.ts` 中 `connectAndWire` 重写为：

```ts
private async connectAndWire(runtime: SessionRuntime): Promise<void> {
  this.detachPageHandler(runtime)
  const browser = await this.cdp.connectToProfile(runtime.session.profile_id)
  runtime.browser = browser
  const context = await firstBrowserContext(browser)
  runtime.context = context

  // 只挑/开一个采集 tab，其他 tab 完全不动
  const targetPage = await this.acquireCollectionPage(context, runtime.platformRule)
  await this.wirePage(runtime, targetPage)
  await targetPage.bringToFront().catch(() => null)

  // 之后用户在浏览器里手动开新 tab（同 platform）也要能被监听
  const pageHandler = (page: Page) => {
    void this.wireIfAllowed(runtime, page).catch(() => null)
  }
  context.on('page', pageHandler)
  runtime.pageHandler = pageHandler

  browser.on('disconnected', () => {
    if (this.active?.session.id === runtime.session.id) {
      this.handleBrowserClosed()
    }
  })
}

private async acquireCollectionPage(
  context: BrowserContext,
  rule: CollectionPlatformRule,
): Promise<Page> {
  // 1. 现存 tab 里找一个 URL 在 allowed_domains 内的，直接复用，不 reload
  const existing = context.pages().find((p) => isAllowedDomain(p.url(), rule.allowed_domains))
  if (existing) return existing
  // 2. 否则新开一个并导航到 entry_url
  const page = await context.newPage()
  await page.goto(rule.entry_url, { waitUntil: 'domcontentloaded' }).catch(() => null)
  return page
}

private async wireIfAllowed(runtime: SessionRuntime, page: Page): Promise<void> {
  // 新开的 tab 只有 URL 进入 allowed_domains 才注入；切到店小秘就不管
  if (!isAllowedDomain(page.url(), runtime.platformRule.allowed_domains)) return
  await this.wirePage(runtime, page)
}
```

`isAllowedDomain` 帮手放在同文件或抽到 `collection-platform-rules.ts`，匹配 `allowed_domains` 里的精确域名和 `*.foo.com` 通配规则。

### 4.2 进度计数（UI 侧）

`packages/client/src/renderer/src/features/collection/CollectionPage.tsx` 在 session 激活态那一支增加一个**显眼**的计数卡：

```
已采集  23 张
最近一张 5 秒前    ← record.created_at 计算
当前页面 https://www.temu.com/goods/12345
```

`records.length === 0` 也要正常显示（"0 张 · 等待用户在浏览器内操作"），不被"暂无采集记录"那块空状态吃掉。最近时间用 `records[0]?.created_at` 算相对时间，每 5 秒刷一次显示。

### 4.3 启动 loading 文案修正

`onStartSession` 在 `connectAndWire` 完成前都是「启动中…」。改造后启动只需 1~2 秒（不再 reload N 个 tab），保持现状即可；但如果出错，要在主屏顶部红条里把错误码 + 文案显示出来（目前 `error` 字段已经有，确认 startSession 抛错时正确写入即可）。

## 5. 非目标

- ❌ 不引入"批量 URL 队列"模式（spec 上采集是用户驱动的，N/M 总数模型 v1 不做）
- ❌ 不改 `collection-platform-rules.ts` 的规则数据（entry_url 已正确）
- ❌ 不动 `cdp-client.ts`（注入路径不变）
- ❌ 不引入新的 ADR（这只是修 bug，不是架构变更）

## 6. 验收

人工 + 自动结合：

**人工（最关键）**：
1. 比特浏览器先开 3 个店小秘 tab（停在 dianxiaomi）。
2. aipod 里选 Temu + 该 profile，点「开始采集会话」。
3. 期望：店小秘 3 个 tab 不变，比特浏览器新开（或激活）一个 `https://www.temu.com` 的 tab，并被前置。
4. 在该 Temu tab 里点几张图，主屏「已采集 N 张」实时跳。
5. 切回店小秘 tab 操作不应该产生采集记录。

**自动**：
- 现有测试 `collection-session-manager.test.ts` 跑过。
- 新增用例：
  - `acquireCollectionPage`：现存 allowed_domains tab 时复用、否则新开 + goto entry_url。
  - 监听 context.page 时只对 allowed_domains 注入。
  - 启动时不调用 `page.reload()`（断言 mock 没被调）。

## 7. 风险

- `bringToFront` 在某些 Chromium 版本可能不生效；如果不生效，至少 entry_url 已经导航，用户能凭 URL 找到 tab。
- 用户复用现存 tab 时不 reload —— 如果那个 tab 上 platform 站点已经登录失效（session 过期），用户需要自己刷新登录。这个比"采集启动时强制刷新十几个 tab"代价小得多，可接受。

## 8. 关联

- spec/02-collection.md §3 会话生命周期、§6 PlatformRule、§8.2 会话激活 UI
- 不涉及 ADR 修改
