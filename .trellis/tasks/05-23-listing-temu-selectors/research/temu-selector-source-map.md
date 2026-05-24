# listing-temu-selectors research

## Purpose

Build the Temu PopTemu selector contract for Slice 8 v1 by observing real Dianxiaomi edit pages through the existing Bit Browser `2-1111` profile. This task owns static selector definitions only; parser, executor, workflow, and smoke behavior are later tasks.

## Required real templates

| Template | URL | Material root |
|---|---|---|
| Temu clothing | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`, excluding `GzG00010` |
| Temu general goods | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

Temu selectors must support the first two templates. The Shein row is recorded here because every Slice 8 task PRD/context must carry the full v1 baseline.

## Core workflow actions selectors must support

1. Replace shop name.
2. Replace title.
3. Replace images.
4. Generate SKU with one click.
5. Upload video with one click.

## Source/reference files reviewed

Reference project:

```text
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/selectors.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser/index.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/action-executor.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/workflow.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/common/selectors.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/common/page-parser.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/common/action-executor.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/main/bitbrowser-api.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/main/ListingAdapter.ts
```

Historical real inspection artifacts:

```text
/Users/macmini/Desktop/一键pod/上架程序/output/automation-runs/2026-05-22-dianxiaomi-listing-real-batch/reports/temu-clothing/element-checklist.md
/Users/macmini/Desktop/一键pod/上架程序/output/automation-runs/2026-05-22-dianxiaomi-listing-real-batch/reports/temu-clothing/element-inventory.json
/Users/macmini/Desktop/一键pod/上架程序/output/automation-runs/2026-05-22-dianxiaomi-listing-real-batch/reports/temu-clothing/page-initial.png
/Users/macmini/Desktop/一键pod/上架程序/output/automation-runs/2026-05-22-dianxiaomi-listing-real-batch/reports/temu-general/element-checklist.md
/Users/macmini/Desktop/一键pod/上架程序/output/automation-runs/2026-05-22-dianxiaomi-listing-real-batch/reports/temu-general/element-inventory.json
/Users/macmini/Desktop/一键pod/上架程序/output/automation-runs/2026-05-22-dianxiaomi-listing-real-batch/reports/temu-general/page-initial.png
```

Target project:

```text
packages/client/src/main/lib/bit-browser-client.ts
packages/client/src/main/lib/cdp-client.ts
packages/client/src/modules/listing/runner.ts
packages/shared/src/listing-types.ts
docs/spec/07-listing.md
docs/adr/0004-listing-direct-port-with-rewrite.md
.agents/skills/listing-automation-builder/SKILL.md
```

## Candidate findings before live reconnaissance

- Current target project already has `BitBrowserClient.listProfiles()` and `CDPClient.connectToProfile()`.
- `CDPClient.connectToProfile()` calls `bitBrowser.openProfile()`, which may start/activate a profile. For this real selector task, the test must first list profiles and target existing `2-1111`; it must not create a new profile or mock CDP.
- Historical inspection found stable Temu edit-page anchors:
  - `#productProductInfo .ant-form-item:has(label[title="产品标题"]) input`
  - `#productProductInfo .ant-form-item:has(label[title="英文标题"]) input`
  - `#productProductInfo input.productNumber`
  - `#productProductInfo .ant-form-item:has(label[title="产品轮播图"])`
  - `#productProductInfo .material-img-module`
  - `#skuDataInfo .img-options-action-btn`
  - `#skuDataInfo th:has-text("预览图") .img-options`
  - `role=button:保存`
  - `role=button:发布`
- Historical artifacts are only candidates. Final selectors must be confirmed against the current real `2-1111` pages for the two user-provided template IDs.

## Ownership plan

Add:

```text
packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/selectors.ts
packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/selectors.real.test.ts
.trellis/tasks/05-23-listing-temu-selectors/evidence/
```

Do not add parser/executor/workflow behavior in this task.

## Real test contract

- Default unit test run skips real DOM tests unless `REAL_LISTING=1`.
- With `REAL_LISTING=1`, tests:
  1. Call `bitBrowserClient.listProfiles()`.
  2. Resolve the profile whose name, remark, seq, or id matches `2-1111`.
  3. Connect to that already-open profile over CDP.
  4. Navigate/reuse pages for both Temu template URLs.
  5. Assert required selector groups have at least one candidate matching the real DOM.
  6. Save screenshot, DOM snapshot, and selector hit report under task evidence.

## Reuse analysis

- Direct reuse: shared Bit Browser/CDP adapter shapes and shared listing template constants.
- Abstract reuse: historical inspection artifacts can seed candidate selector names and risk categories.
- New implementation: all selector constants and real selector tests in the target project.
- Forbidden reuse: direct port of source `pop-temu/actions/*`, `page-parser/*`, or workflow DOM logic.
