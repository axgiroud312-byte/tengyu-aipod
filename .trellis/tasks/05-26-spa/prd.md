# 采集点击模式 SPA 全程生效 + 自定义尺寸过滤

## Goal

让"点击采集"在 SPA 站点（Temu / Shopee / TikTok 等）也能稳定工作：用户点哪张图就采哪张，不论页面如何跳转、SPA 路由如何切换，都要持续生效。同时把尺寸过滤暴露到前端 UI，click / scroll 两种模式都生效，由用户自行设定 min/max width/height，避免误点小图标/装饰图被采进库。

背景：实测发现 click 模式启动后只采到了一张登录跳转瞬间的首屏图，后续怎么点都没反应。

## Decision Log

- **2026-05-26 / Q1**：货号识别 / SKU 弹窗 / 按 SKU 分目录全部**保留**（方案 A）。本任务不改 `collection-click-service` 的落地逻辑。
- **2026-05-26 / Q2**：尺寸阈值 UI **click + scroll 都生效**（方案 B），共用一段输入区。

## What I already know

- 注入脚本经 `cdp-client.ts:113` 的 `page.addInitScript()` 走，**只对未来 navigation 生效**，对已加载页面无效。
- `collection-session-manager.ts:333-347` 的 `acquireCollectionPage` 两条路径都踩这个坑：找到现有 page 直接返回；新建 page 先 `goto` 后 `wirePage`。结果当前页面根本没注入脚本。
- Temu 等站点是 SPA，登录后是 pushState 路由切换，不触发新 navigation。一次硬刷新后 setupScrollObserver 只跑了一次，之后路由变化脚本不重跑。
- `injected-script` 里 click handler 没有尺寸过滤；scroll handler 已有 `minWidth/maxWidth/minHeight/maxHeight`，但前端 UI 目前只透出了 keywords 文本框，那 4 个阈值是写死的 0（不限制）。
- 现 click 模式落地路径保留不变：
  - 商品详情页 + goodsLink + 无 sku → 弹货号输入框
  - 商品详情页 + sku → 保存到 `<output>/<sku>/`
  - 非商品页或无 goodsLink → 保存到 `<output>/散图池/`

## Requirements

- 注入脚本对**当前已加载页面**立刻生效，不依赖下一次 navigation。
- 脚本在 SPA 路由切换（`pushState/replaceState/popstate`）后继续工作；URL 变化时清空去重 set，避免新页面图被误过滤。
- 前端在「采集模式」卡片下新增 4 个 number Input：minWidth / minHeight / maxWidth / maxHeight，0 表示不限制。
- click 和 scroll 两种模式都接尺寸过滤；阈值不通过的 img 不发送给主进程。
- click 模式落地逻辑保持不变（货号识别 / SKU 弹窗 / 散图池分目录全部保留）。
- 过滤掉 `data:` / `about:` / `blob:` / 空字符串等无效 URL，不下载占位图。

## Acceptance Criteria

- [ ] 在 Temu 已登录主页直接点商品大图 → 立刻保存一张（落散图池或弹货号，看是否商品详情页）
- [ ] 通过 SPA 路由跳到第二个商品列表页继续点 → 仍能立刻保存
- [ ] 把 minWidth 设为 500，点击小于 500px 宽的图标 → 不保存、不留 failed 记录
- [ ] scroll 模式下设置 minWidth=500，滚动页面 → 只有原图宽 ≥500 的图被保存
- [ ] 启动会话后，浏览器 console 输入 `typeof window.__poseidonSendToHost` 返回 `"function"`
- [ ] 单元测试：injected script 在模拟 pushState 路由切换后，`seenScrollImages` 被清空、click listener 仍能触发
- [ ] 单元测试：click handler 在 img 尺寸不满足阈值时不调用 send
- [ ] 单元测试：`data:` / `blob:` URL 不被 send

## Definition of Done

- 相关单元测试更新通过（`collection-injected-script.test.ts` / `cdp-client` 相关测试若有 / `CollectionPage` 状态测试）
- `pnpm -F @tengyu-aipod/client lint && pnpm -F @tengyu-aipod/client typecheck && pnpm -F @tengyu-aipod/client build` 全绿
- 真实 Temu 站点手动跑通：点击采集 + scroll 采集 + 尺寸过滤生效，截图存到 task 目录

## Out of Scope

- 不改采集会话生命周期管理（启动/暂停/恢复/停止流程不动）
- 不引入新平台规则
- 不持久化尺寸阈值（会话级输入即可，关掉会话就丢）
- 不改 `collection-click-service` 的落地分支（货号弹窗 / SKU 分目录全部保留）

## Technical Approach

**主进程 / 注入**

1. `cdp-client.ts` 的 `injectPageScript`：`addInitScript` 之后追加 `await page.evaluate(options.script).catch(() => null)`，让脚本在当前已加载页面立刻跑起来。
2. `collection-injected-script.ts`：
   - 把 `scrollFilter` 重命名为 `sizeFilter`（语义上 click 也要用），保持后向兼容字段。
   - click handler 在 `send` 前调用 `insideSizeRange(img)`；不通过直接 return。
   - `resolveOriginalImage` 返回值过滤 `data:` / `about:` / `blob:` 前缀，命中返回空字符串。
   - 在脚本里 hook `history.pushState` / `history.replaceState`，监听 `popstate`，URL 变化时 `seenScrollImages.clear()`；click listener 是 document capture 阶段绑定，本来就不受路由影响，无需重绑。
3. `collection-session-manager.ts`：`CollectionSessionConfig` 增加 `size_filter: { min_width?, max_width?, min_height?, max_height? }` 字段；传入 `createCollectionInjectedScript` 时合并进选项。
4. `CollectionSessionConfigSchema`（IPC）增 4 个 optional non-negative int。

**前端**

5. `CollectionPage.tsx`：「3. 采集模式」卡片内（RadioGroup 下方）补一个固定显示的「尺寸过滤」子区，4 个 number Input + 0=不限制说明。原有 scroll 关键词框保留（继续放在 mode==='scroll' 分支里）。
6. `CollectionPageState` 增加 `minWidth / maxWidth / minHeight / maxHeight: number`（默认 0）。
7. 启动 session 时把 4 个数字加进 `collection:start-session` 的 payload。

**测试**

8. `collection-injected-script.test.ts` 增三个 case：click handler 受 sizeFilter 限制、`data:` URL 被过滤、模拟 `history.pushState` 后 `seenScrollImages` 被清空。
9. cdp-client / session-manager 如果有 mock harness，补一个 "addInitScript 和 evaluate 都被调用" 的断言。

## Technical Notes

- 关键文件：
  - `packages/client/src/main/lib/cdp-client.ts`（注入修复）
  - `packages/client/src/main/lib/collection-injected-script.ts`（脚本：尺寸 + SPA + data:）
  - `packages/client/src/main/lib/collection-session-manager.ts`（配置透传）
  - `packages/client/src/renderer/src/features/collection/CollectionPage.tsx`（UI 4 个 Input）
  - 状态/Hook 文件：搜 `CollectionPageState` 看在哪里被消费
- 现有诊断证据见上一轮对话；不单独再起 research/。
