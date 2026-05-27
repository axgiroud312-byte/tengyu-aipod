# brainstorm: listing platforms commons refactor

## Goal

抽出 Temu / Shein 两个平台之间的真实重复代码到 `packages/client/src/modules/listing/platforms/_commons/`（或更上层的合适位置），消除约 30% 的重复，并为 v1.5 多平台扩展（Ozon / Mercado / TikTok）铺路。

## What I already know

### 从代码扫描出的事实

- Temu 总行数 6,192（含测试），Shein 总行数 6,192（含测试）
- Temu 主代码 ~1,837 行（不含 test），Shein 主代码 ~1,784 行
- 两边**确定重复**的项：

| 项 | 位置 | 重复程度 |
|---|---|---|
| `ListingActionError` class | 两个 `action-executor.ts` 都各自 export 一份 | 完全重复（type） |
| `selectorToLocator` | 两边 `selectors.ts` 都各 export 一份 | 同名同签名 |
| `locatorForSelector` | 测试 helper，3 处都有 | 同名同实现 |
| `findBitBrowserProfile2_1111` | real.test 里出现 8 次 | 完全重复 |
| `isRetryableListingActionCode` / `isListingFailure` / `isListingActionError` | 错误处理 helper | 同名同实现 |
| `createState` / `textField` / `control` / `toast` / `imageSection` | 测试 helper | 同名同实现 |
| Action 函数同名签名：`replaceShopName` / `fillTitle` / `fillSku` / `uploadVideo` / `generateSkuCode` | 业务层 | 接口同，实现不同 |

### 重复程度分级

- **P0 完全可共用**（类型 / 简单 helper）：`ListingActionError`、`selectorToLocator`、`findBitBrowserProfile2_1111`、`isRetryable*`、测试 helper 共 5-8 个
- **P1 中等可共用**：error utilities、locate / wait / upload 等 page 操作原语
- **P2 难度高**：业务 action（replaceShopName / fillTitle 等）——接口同但实现因 DOM 差异不同

## Assumptions (temporary)

- 重构期间**不打断 v1.0 验收前的稳定性**
- 用 **helper 函数式**，不引入 class 继承（贴合项目现有风格）
- `_commons` 目录路径：`packages/client/src/modules/listing/platforms/_commons/`

## Open Questions

- ✅ MVP 范围 — **P0+P1**（不做 P2 业务 action 通用化，不做选择器云端派发）
- ✅ 改造时机 — **一气改完，1 个大 commit**（在独立 feature branch 上，PR 合并）
- ✅ 测试策略 — 新 `_commons` 必须有独立单测；重构后 Temu/Shein 的 `*.test.ts` + `*.real.test.ts` 全部必须跑过；行数减少用 `wc -l` 验证

## Technical Approach

### 分支与提交策略

- 创建独立 feature branch：`refactor/listing-platforms-commons`
- 在分支上完成所有 _commons 抽取 + Temu/Shein 改造 + 测试更新
- 单次 commit 提交（一气改完，原子性）
- push 到远程后开 PR、跑 CI、合并到 main
- 合并后删除本地和远程的 feature branch

### 接口设计

- helper 函数式（不引入 class 继承），符合现有项目风格
- 每个 `_commons/*.ts` 文件单一职责，导出几个纯函数

### Selector 数据结构升级

```ts
// 当前（写死在 selectors.ts 文件里）
export const TEMU_POP_SELECTORS = {
  title_input: { css: '...', fallbacks: [...] },
  ...
}

// 目标（record 形式，含元数据，为 v1.5 派发铺路）
type SelectorRecord = {
  key: string;              // 'title_input'
  name: string;             // 人读的名字
  primary: ListingSelector;
  fallbacks: ListingSelector[];
  version: string;          // '1.0.0'
  createdAt: string;        // ISO 8601
};
export const TEMU_POP_SELECTOR_RECORDS: SelectorRecord[] = [...];
```

仍存在客户端，**不做服务端拉取**。但形态已经派发就绪。

## Decision (ADR-lite)

**Context**：上架模块 Temu 和 Shein 重复约 30%（错误类、selector 工具、测试 helper、page 操作原语）。v1.5 计划加 3 个新平台，重复会成倍恶化。

**Decision**：抽 P0+P1 到 `_commons/`，selector 数据结构升级为 record 形式，但**不做选择器云端派发**（v1.5 `v15-selectors-dispatch` 再做）。

**Consequences**：
- 短期：客户端 listing 代码减少 ~25%，未来加平台成本降低
- 中期：v1.5 派发实现时，只需把"读本地 record"换成"读 HTTP+缓存"
- 风险：重构期间 Temu/Shein 的 real.test 必须全过，否则不合并

## Definition of Done

- ✅ `pnpm test` / `type-check` / `lint` / `build` 全绿（client + workspace 根）
- ✅ `REAL_LISTING=1 pnpm -F @tengyu-aipod/client test --grep "real"` Temu 和 Shein 真实页面全过（主理人本机）
- ✅ `_commons/` 每个文件有独立单测
- ✅ Temu 和 Shein 的旧重复定义已全部删除（`grep -c "class ListingActionError"` 在 client 下应等于 1）
- ✅ 行数验证：Temu+Shein 行数总和（不含 test）减少 ≥ 200 行
- ✅ `docs/spec/07-listing.md` 加一节"_commons 共用基础层"说明
- ✅ feature branch 已 PR、CI 全绿、合并 main、本地和远程 branch 已删除

## Requirements (evolving)

### MVP 范围（P0+P1，已锁定）

**P0 必抽（类型 + 简单工具 + 测试 helper）**
- `ListingActionError` class → 抽到 `packages/shared/src/listing-types.ts` 或 `modules/listing/errors.ts`
- `selectorToLocator` / `locatorForSelector` → `_commons/page-locator.ts`
- `findBitBrowserProfile2_1111` → `_commons/test-helpers.ts`
- `isRetryableListingActionCode` / `isListingFailure` / `isListingActionError` → `_commons/error-utils.ts`
- 测试 helper（`createState` / `textField` / `control` / `toast` / `imageSection`）→ `_commons/test-helpers.ts`

**P1 中等价值（page 操作原语）**
- `locateBySelectorsWithFallback`（多选择器降级定位）→ `_commons/page-locator.ts`
- `waitUntilVisible`（等元素出现，含超时和重试）→ `_commons/page-wait.ts`
- `handleFileChooserWithRetry`（文件上传重试）→ `_commons/file-upload.ts`
- Toast 等待 / 错误识别 → `_commons/page-feedback.ts`

**Selector 数据结构升级（为 v1.5 派发铺路）**
- 当前：选择器分散在 `selectors.ts` 里，按字段名导出
- 目标：每个 selector 作为一个 `record`，含 `key / name / fallbacks / version / createdAt`
- 仍然存在客户端（不做服务端拉取），但形态已经"派发友好"

### 改造范围（非 MVP 但必须）
- 改造 Temu 和 Shein 的现有 selectors.ts / action-executor.ts / 测试，引用 _commons
- 删除两边重复定义

### 不做
- ❌ P2 业务 action 通用化（`replaceShopName` / `fillTitle` / `fillSku` / `uploadVideo` / `generateSkuCode`）
- ❌ 选择器云端派发（等 v1.5 `v15-selectors-dispatch`）
- ❌ 服务端 schema / Admin UI 改动
- ❌ 平台间共享基础组件库的设计抽象（class / mixin）—— 用 helper 函数式

## Acceptance Criteria (evolving)

- [ ] `packages/client/src/modules/listing/platforms/_commons/` 目录下有 4-5 个文件，函数式接口
- [ ] Temu 和 Shein 的 `selectors.ts` / `action-executor.ts` 引用 `_commons` 函数，删除两边重复定义
- [ ] Temu 和 Shein 的 selectors 改成 record 数据结构（含 key/name/fallbacks/version/createdAt）
- [ ] `_commons` 每个文件有独立单测
- [ ] 重构后跑 `REAL_LISTING=1 pnpm -F @tengyu-aipod/client test` 对 Temu 和 Shein 真实页面全过
- [ ] 重复代码减少约 25%（行数 wc -l 验证）
- [ ] `docs/spec/07-listing.md` 加一节"_commons 共用基础层"说明

## Definition of Done

- pnpm test / type-check / lint 全绿
- Temu 和 Shein 的 real.test（`REAL_LISTING=1`）跑过一遍，证明重构未破坏真实行为
- 任何抽到 _commons 的函数都有独立单测
- 文档：`docs/spec/07-listing.md` 加一节"_commons 共用基础层"说明

## Out of Scope (explicit)

待定（取决于 MVP 范围选择）

## Technical Notes

- 现有平台代码：`packages/client/src/modules/listing/platforms/dianxiaomi-{temu-pop,shein}/`
- 共享类型已在：`packages/shared/src/listing-types.ts`（`ListingActionError` 可能应该挪到这里）
- spec：`docs/spec/07-listing.md`
- ADR：`docs/adr/0004-listing-direct-port-with-rewrite.md`
- SKILL：`.agents/skills/listing-automation-builder/SKILL.md`

## Research References

（无外部研究需要——重复代码已经在仓库里，直接重构）
