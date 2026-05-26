# ADR-0010 — 上架平台抽取 `_commons` 基础层，selector 升级为 record

**状态**：已采纳
**日期**：2026-05-26

## 背景

Temu PopTemu 和 Shein 的店小秘上架实现已经按 `selectors / page-parser / action-executor / workflow` 四层结构落地，但两个平台之间出现了稳定重复：

- selector 字符串转 Playwright Locator
- 多 selector fallback 定位
- 页面可见等待和编辑器 ready 等待
- file chooser / 全局 input 上传兜底
- toast / 错误反馈读取
- `ListingActionError` 和 listing failure/error 判定
- real test 使用的 BitBrowser profile 查找和 parser state fixture helper

这些重复属于跨平台基础动作，不是平台业务 action。继续复制会让后续 Ozon / Mercado / TikTok 接入时重复扩散，也会让 selector 云端派发前的数据形态不统一。

## 决策

在 `packages/client/src/modules/listing/platforms/_commons/` 建立上架平台共用基础层：

- `page-locator.ts`：`selectorToLocator`、`locatorForSelector`、`selectorRecordMap`、`locateBySelectorsWithFallback`
- `page-wait.ts`：通用可见等待、编辑器 ready 等待、状态轮询
- `file-upload.ts`：file chooser、菜单入口、全局 file input 上传兜底
- `page-feedback.ts`：toast / 页面反馈读取
- `error-utils.ts`：listing failure/action error 判定与转换
- `test-helpers.ts`：仅供平台测试使用的 fixture helper 和 BitBrowser profile 查找

`ListingActionError`、`ListingSelector`、`SelectorRecord`、`lookupSelector` 上移到 `packages/shared/src/listing-types.ts`。

平台 selector 文件从 `Record<key, ListingSelector[]>` 主存储升级为 `SelectorRecord[]`，字段包含：

```ts
type SelectorRecord = {
  key: string
  name: string
  primary: ListingSelector
  fallbacks: readonly ListingSelector[]
  version: string
  createdAt: string
}
```

平台内仍可用 `selectorRecordMap(records)` 派生兼容 map，避免 parser/executor 大面积改成按 key 查找。

## 边界

`_commons` 只放基础操作原语，不放平台业务 action。

保留在平台层：

- `replaceShopName`
- `fillTitle`
- `fillSku`
- `uploadMaterialImages` / `uploadVariantImages`
- `uploadVideo`
- `generateSkuCode`
- `runListingItem`

只有当前置状态、目标状态、失败策略、成功证据都一致，且差异可以通过小参数表达时，才允许继续抽到 `_commons`。

## 选择器云端派发预留

当前 selector record 仍在客户端本地代码中，不做 HTTP 拉取和缓存。

这样做的目的不是提前实现派发，而是让 v1.5 `v15-selectors-dispatch` 只需要把“读取本地 record”替换为“读取远端版本化 record + 缓存”，而不是同时重构 selector 数据结构。

## 候选方案

| 方案 | 结论 | 原因 |
|---|---|---|
| 继续每个平台复制 helper | 放弃 | 后续平台越多，重复越多，错误修复无法集中 |
| 把业务 action 也抽象为统一 class / 继承 | 放弃 | 店小秘 DOM 差异大，继承会隐藏真实状态转换，违背 listing-automation-builder |
| 只抽 `_commons` 函数式基础层 | 采纳 | 保留平台差异，同时集中复用稳定原语 |

## 执行规范

新增或修改 listing 平台时：

1. 先搜索 `_commons` 是否已有基础函数，禁止重新实现同类 helper。
2. `selectors.ts` 必须以 `SelectorRecord[]` 作为主存储，包含 `key/name/primary/fallbacks/version/createdAt`。
3. `selectors.ts` 不允许导入 Playwright、Electron、filesystem、BitBrowser、runner 或 workflow。
4. `_commons/*.ts` 必须函数式、单一职责；每个文件必须有同名 `.test.ts`。
5. 平台 parser/executor/workflow 仍按状态转换验证，不以“按钮能点 / file input set 成功”作为成功。
6. real tests 必须继续用 `REAL_LISTING=1` guard，并把截图和状态证据写入当前 task 的 `evidence/` 目录。

## 影响

正面：

- Temu / Shein 主代码减少超过 200 行。
- `ListingActionError` 和 selector record 变成 shared contract。
- 后续平台能复用定位、等待、上传、错误转换、测试 fixture。
- v1.5 selector dispatch 的数据形态已准备好。

负面：

- 平台 selector 文件需要维护 record 元数据。
- `_commons` 增加后，review 必须检查“是不是把业务差异过早抽象了”。

## 验证

- `_commons` 每个文件有同名单测。
- `pnpm -r build`
- `pnpm test`
- `pnpm -r type-check`
- `pnpm -r lint`
- `pnpm -F @tengyu-aipod/client build`
- `pnpm -F @tengyu-aipod/client test`
- `pnpm -F @tengyu-aipod/client type-check`
- `pnpm -F @tengyu-aipod/client lint`
- `git diff --check`
- `REAL_LISTING=1` real tests 仍作为本机验收项；如果失败发生在 BitBrowser/CDP 连接层，需要先修本机 profile / CDP 环境，再判断 selector/parser/action 是否回归。
