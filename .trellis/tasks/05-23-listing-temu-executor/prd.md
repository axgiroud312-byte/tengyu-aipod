# Task: listing-temu-executor

## Goal

Implement Temu PopTemu `action-executor.ts` as the third layer of the Slice 8 listing automation stack.

The executor owns action primitives only: it reads the current parser state, re-locates the needed DOM element, performs one action, then parses again to verify the target state. It must not become workflow orchestration.

## Slice 8 v1 Baseline

All Slice 8 tasks must carry the same real baseline:

| Platform | Dianxiaomi edit URL | Real material root |
|---|---|---|
| Temu clothing | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`, excluding `GzG00010` |
| Temu general goods | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

This task implements only the two Temu templates. The Shein row is retained as cross-task context.

Every template workflow must eventually cover these five core actions:

1. Replace shop name.
2. Replace title.
3. Replace images.
4. Generate SKU with one click.
5. Upload video with one click.

## Real Test Baseline

- Test target is the already-open Bit Browser `2-1111` profile, logged into Dianxiaomi.
- Tests must call `bitBrowserClient.listProfiles()` and connect with Playwright `connectOverCDP` through the existing Bit Browser adapter.
- Do not create a new profile. Do not mock CDP.
- Selector, parser, executor, and workflow assertions must hit the real Dianxiaomi DOM, not fixture HTML.
- Real tests are guarded by `REAL_LISTING=1`; CI and normal local tests skip real DOM work by default.
- Unit-level mocks are allowed only for pure error formatting and pure local file checks. This executor task should not mock Playwright pages.

## References

- `docs/spec/07-listing.md`
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
- `.agents/skills/listing-automation-builder/SKILL.md`
- `.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/research/temu-selector-source-map.md`
- `.trellis/tasks/archive/2026-05/05-23-listing-temu-parser/research/temu-parser-contract.md`
- `.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/evidence/real-selector-hit-report.json`
- `.trellis/tasks/archive/2026-05/05-23-listing-temu-parser/evidence/real-parser-state-report.json`
- `/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/actions/*.ts`
- `/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/common/action-executor.ts`

Source-project DOM action code is reference-only. Do not port the DOM implementation directly.

## Scope

Add:

- `packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/action-executor.ts`
- `packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/action-executor.test.ts`
- `packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/action-executor.real.test.ts`
- `.trellis/tasks/05-23-listing-temu-executor/research/temu-executor-contract.md`
- Evidence under `.trellis/tasks/05-23-listing-temu-executor/evidence/`

## Required Runtime Contract

Export action primitives for:

- `replaceShopName(page, targetShopName)`
- `fillTitle(page, title)`
- `fillEnglishTitle(page, title)`
- `fillSku(page, sku)`
- `uploadCarouselImages(page, files)`
- `uploadVideo(page, files)`
- `generateSkuCode(page, skuPrefix)`

Each action must:

- Parse current state with `parseDraftPage(page)`.
- Validate page readiness: not login, not loading, not blocked, and `workflow_step === "editing"`.
- Re-locate the target DOM from `TEMU_POP_SELECTORS`.
- Perform the action.
- Re-parse state and verify the target state with parser output or a DOM table/file upload count check.
- Throw `ListingActionError` on failure with action, listing error code, selector when known, URL, before/after state, page text excerpt, and optional evidence path.

## Upload Contract

- Image upload uses the real Temu dropdown path: click `选择图片`, choose `本地图片`, then set files through file chooser or the global hidden `#localFileUploadInp`.
- Video upload uses the real Temu dropdown path: click `添加视频`, choose `本地上传`, then set files through file chooser or the global hidden `#localFileUploadInp`.
- Success is not "button clicked". Success means parser/Dianxiaomi DOM shows a changed count or an accepted file selection/uploaded card after the action.
- Do not save or publish in this task.

## Real Test Contract

With `REAL_LISTING=1`, executor tests must:

- Connect to Bit Browser `2-1111`.
- Navigate to both Temu edit URLs.
- Run text actions by writing the existing field value back to the same field and asserting parser still reads the target value.
- Verify shop replacement can keep the current shop unchanged.
- Verify one-click SKU generation on the real page only when `REAL_LISTING_MUTATE=1`, because it opens a modal and changes SKU rows.
- Verify image upload on the real page only when `REAL_LISTING_MUTATE=1`, using real image files from the provided material roots.
- Verify video upload on the real page only when `REAL_LISTING_MUTATE=1` and real video files exist under the provided material roots.
- Save screenshots and JSON reports to `.trellis/tasks/05-23-listing-temu-executor/evidence/`.

If a mutate test is disabled because the extra guard or real video files are missing, the report must say that explicitly. No fixture media may be generated.

## Out Of Scope

- Full workflow sequencing, stage result aggregation, and save/publish behavior.
- Shein executor.
- Batch loader fixes, including `标题.xlsx` vs `titles.xlsx` compatibility.
- Permanent cleanup of existing real draft content. That belongs to workflow/smoke/e2e acceptance.

## Quality Gate

Run:

```bash
pnpm -F @tengyu-aipod/client build
pnpm -F @tengyu-aipod/client test
pnpm -F @tengyu-aipod/client type-check
pnpm -F @tengyu-aipod/client lint
pnpm test
pnpm type-check
pnpm lint
git diff --check
```

Real executor verification:

```bash
REAL_LISTING=1 pnpm -F @tengyu-aipod/client test -- src/modules/listing/platforms/dianxiaomi-temu-pop/action-executor.real.test.ts
```

Mutating upload/SKU verification, only when the owner approves draft changes:

```bash
REAL_LISTING=1 REAL_LISTING_MUTATE=1 pnpm -F @tengyu-aipod/client test -- src/modules/listing/platforms/dianxiaomi-temu-pop/action-executor.real.test.ts
```
