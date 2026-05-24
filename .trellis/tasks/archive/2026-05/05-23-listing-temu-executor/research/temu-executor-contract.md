# Temu PopTemu executor contract

## Purpose

Implement `action-executor.ts` for Temu PopTemu under the listing four-layer structure:

```text
selectors -> page-parser -> action-executor -> workflow
```

This task owns action primitives only. It must not decide the full business order or save/publish the draft.

## Slice 8 v1 baseline

| Platform | URL | Material root |
|---|---|---|
| Temu clothing | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`, excluding `GzG00010` |
| Temu general goods | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

Core workflow actions:

1. Replace shop name.
2. Replace title.
3. Replace images.
4. Generate SKU with one click.
5. Upload video with one click.

## Source/reference files reviewed

Target project:

```text
docs/spec/07-listing.md
docs/adr/0004-listing-direct-port-with-rewrite.md
.agents/skills/listing-automation-builder/SKILL.md
packages/shared/src/listing-types.ts
packages/client/src/modules/listing/runner.ts
packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/selectors.ts
packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/page-parser.ts
.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/research/temu-selector-source-map.md
.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/evidence/real-selector-hit-report.json
.trellis/tasks/archive/2026-05/05-23-listing-temu-parser/research/temu-parser-contract.md
.trellis/tasks/archive/2026-05/05-23-listing-temu-parser/evidence/real-parser-state-report.json
```

Reference project, for action boundaries and interaction patterns only:

```text
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/actions/fields.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/actions/carousel-images.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/actions/videos.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/actions/variants.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/actions/support.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/common/action-executor.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/common/file-upload.ts
```

Forbidden: direct port of source-project DOM code.

## Real page reconnaissance

Existing parser evidence showed both Temu templates are ready in Bit Browser `2-1111`:

- Clothing: shop `JoyCatVI`, SKU `T061218230080`, carousel count `5`, material count `1`, SKU rows `14`, video count `2`.
- General goods: shop `Limuyan`, SKU `GzG0005`, carousel count `5`, material count `1`, SKU rows `4`, video count `2`.

Read-only upload control reconnaissance saved:

```text
.trellis/tasks/05-23-listing-temu-executor/evidence/read-only-upload-control-recon.json
.trellis/tasks/05-23-listing-temu-executor/evidence/upload-menu-recon.json
```

Findings:

- The visible carousel button is `选择图片`; opening it shows menu text `本地图片 空间图片 网络图片 引用采集图片`.
- The visible video button is `添加视频`; opening it shows menu text `本地上传 网络上传`.
- The page has a global hidden file input `#localFileUploadInp`.
- Carousel/video sections do not expose a direct local `input[type=file]` beside the visible button in the current DOM snapshot.

Executor upload primitive should therefore:

1. Click the visible dropdown trigger.
2. Click the local upload menu item.
3. Prefer Playwright file chooser if one opens.
4. Fall back to `#localFileUploadInp`.
5. Re-parse and verify changed DOM count or accepted uploaded card/file state.

## Real material availability

Image files exist under both Temu material roots.

No `.mp4`, `.mov`, or `.webm` files were found under:

```text
/Users/macmini/Desktop/服装素材摆放举例
/Users/macmini/Desktop/素材文件夹
```

That means the video upload primitive can be implemented, but a real video side-effect test cannot honestly run until the owner provides real video files in the real material roots. No fixture video should be generated for this task.

## State transition contracts

### `fillTitle(page, title)` / `fillEnglishTitle(page, title)` / `fillSku(page, sku)`

- Observed state: field exists, is editable, page is in `editing`.
- Target state: parser reads exact target value.
- Transition: clear then fill.
- Success evidence: `parseDraftPage(page).<field>.current_value === target`.
- Failure: `SELECTOR_NOT_FOUND`, `PAGE_NOT_READY`, or `FIELD_VALUE_MISMATCH`.
- Idempotency: safe to repeat with the same value.

### `replaceShopName(page, targetShopName)`

- Observed state: shop select exists and page is in `editing`.
- Target state: parser reads target shop name.
- Transition: if already target, no-op; otherwise open Ant select, search/click exact option.
- Success evidence: `parseDraftPage(page).shop_field.current_value === targetShopName`.
- Failure: `SELECTOR_NOT_FOUND` or `FIELD_VALUE_MISMATCH`.
- Idempotency: safe if target is current shop.

### `uploadCarouselImages(page, files)`

- Observed state: carousel upload button exists and page is in `editing`.
- Target state: carousel image count increases or remains at the target accepted maximum with no failure toast.
- Transition: open `选择图片` dropdown -> `本地图片` -> set files.
- Success evidence: parser count after upload is greater than before, or at least the expected accepted count when starting from empty/available capacity.
- Failure: `MATERIAL_FILE_MISSING`, `FILE_CHOOSER_TIMEOUT`, `UPLOAD_COUNT_MISMATCH`, or `SELECTOR_NOT_FOUND`.
- Idempotency: not safe. Mutating real tests require `REAL_LISTING_MUTATE=1`.

### `uploadVideo(page, files)`

- Observed state: video upload button exists and page is in `editing`.
- Target state: parser video count increases or a video card becomes visible with no failure toast.
- Transition: open `添加视频` dropdown -> `本地上传` -> set files.
- Success evidence: parser `video_section.current_video_count` increases or remains populated after upload.
- Failure: `MATERIAL_FILE_MISSING`, `FILE_CHOOSER_TIMEOUT`, `UPLOAD_COUNT_MISMATCH`, or `SELECTOR_NOT_FOUND`.
- Idempotency: not safe. Mutating real tests require `REAL_LISTING_MUTATE=1` and real video files.

### `generateSkuCode(page, skuPrefix)`

- Observed state: one-click SKU control exists and SKU table exists.
- Target state: SKU table contains generated values with the prefix.
- Transition: click `一键生成`, fill prefix in modal, confirm.
- Success evidence: live DOM under `#skuDataInfo` contains the target prefix.
- Failure: `SELECTOR_NOT_FOUND`, `FIELD_VALUE_MISMATCH`, or `PAGE_NOT_READY`.
- Idempotency: not safe. Mutating real tests require `REAL_LISTING_MUTATE=1`.

## Reuse analysis

- Direct reuse: target `TEMU_POP_SELECTORS`, `selectorToLocator`, and `parseDraftPage`.
- Abstract reuse: source project's action pattern of file chooser first plus global hidden input fallback.
- New implementation: structured `ListingActionError`, local locator helpers, Temu-specific actions.
- Forbidden reuse: source project's large DOM traversal/upload cleanup implementation.
