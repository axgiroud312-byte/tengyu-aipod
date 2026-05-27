# 采集点击任意图片保存到目标文件夹

## Goal

让点击采集变成用户能理解的稳定行为：在已启动 Temu 采集会话时，用户在 Temu 搜索列表页或商品详情页点击可见商品图片区域，图片必须下载到当前会话配置的目标文件夹，并在 aipod 采集记录里增加一条记录。

## What I Already Know

- 用户已经打开比特浏览器并准备好环境，要求直接开始操作。
- 验收标准是“不论点击什么图片都能下载到目标文件夹里”。
- 现有实现通过页面注入脚本监听 click，解析图片 URL 后经主进程保存。
- 之前现场检查过，Temu 页面里 `window.__poseidonSendToHost` 可注入，商品图片本身是 `<img>`。
- 现有 Temu 商品页规则只认 `/goods/` 或 `/goods.html`，Temu 加拿大详情页常见 URL 是 `/ca/...-g-数字.html`。

## Assumptions

- “任何图片”指允许平台页面里的真实可见商品图片和商品图片容器，不包括站点 logo、支付图标、头像、`data:`/`blob:` 占位图、浏览器 UI 或非平台页面。
- 如果点击的是列表页图片，保存到输出目录下的 `散图池`。
- 如果点击的是详情页商品图，若商品 URL 规则能识别但没有货号，则允许先进入现有货号流程；本任务优先保证记录/文件不静默丢失。
- 目标文件夹以当前会话 `output_dir` 为准。

## Requirements

- R1 点击 Temu 列表页商品图片或图片容器，应保存图片，不要求用户刚好点到 `<img>` 标签本体。
- R2 点击 Temu 商品详情页大图或缩略图，应保存图片。
- R3 点击被遮罩层、嵌套容器包住的图片区域时，应能向下/向上解析到最近的真实图片。
- R4 原图 URL 不能是 `data:`、`blob:`、空 URL；这些应被跳过。
- R5 Temu 加拿大/区域详情页 `-g-数字.html` 应被识别为商品页。
- R6 失败不能静默：至少测试能区分“未触发”“触发但下载失败”“保存成功”。

## Acceptance Criteria

- [x] 单元测试覆盖：点击 `img` 本体保存事件仍正常产生。
- [x] 单元测试覆盖：点击图片外层容器/遮罩时，能解析并发送最近真实图片。
- [x] 单元测试覆盖：Temu `-g-数字.html` URL 匹配商品页规则。
- [x] 真实 Playwright 验收：连接当前比特浏览器，点击 Temu 列表页商品图片后，`collection_records` 增加，目标输出目录出现图片文件。
- [x] 真实 Playwright 验收：点击 Temu 详情页可见商品图后，也能产生保存结果或明确货号待处理状态。

## Verification Notes

- 2026-05-27 Playwright connected to BitBrowser CDP `http://127.0.0.1:49157`.
- Detail-page image click: `collection_records` count changed `9 -> 10`; saved `/Users/macmini/Desktop/1111/散图池/temu-20260527-180518-001.png`; `file` reported PNG `1005 x 1005`.
- Home/list product image click: `collection_records` count changed `10 -> 11`; saved `/Users/macmini/Desktop/1111/散图池/temu-20260527-180634-001.png`; `file` reported PNG `199 x 199`.

## Out Of Scope

- 不做批量 URL 队列。
- 不绕过登录、验证码、风控。
- 不把站点图标、logo、头像、支付图标都强行保存为商品素材。
- 不改上架模块。

## Technical Notes

- 主要文件：
  - `packages/client/src/main/lib/collection-injected-script.ts`
  - `packages/client/src/main/lib/collection-platform-rules.ts`
  - `packages/client/src/main/lib/collection-click-service.ts`
  - `packages/client/src/main/lib/collection-injected-script.test.ts`
  - `packages/client/src/main/lib/collection-platform-rules.test.ts`
- 权威 spec：`docs/spec/02-collection.md`
