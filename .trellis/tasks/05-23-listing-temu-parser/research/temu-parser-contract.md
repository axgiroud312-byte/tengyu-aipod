# Temu PopTemu parser contract

## Purpose

Implement `page-parser.ts` for Temu PopTemu by reading real Dianxiaomi DOM state and returning serializable data. This task does not click, fill, upload, save, or publish.

## Required real templates

| Template | URL | Material root |
|---|---|---|
| Temu clothing | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`, excluding `GzG00010` |
| Temu general goods | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

This task implements only the two Temu templates. The Shein row is retained as Slice 8 v1 baseline context.

## Source/reference files reviewed

Target project:

```text
packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/selectors.ts
packages/client/src/modules/listing/platforms/dianxiaomi-temu-pop/selectors.real.test.ts
.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/evidence/real-selector-hit-report.json
.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/evidence/real-test-clothing.dom-snapshot.html
.trellis/tasks/archive/2026-05/05-23-listing-temu-selectors/evidence/real-test-general.dom-snapshot.html
packages/client/src/main/lib/bit-browser-client.ts
docs/spec/07-listing.md
docs/adr/0004-listing-direct-port-with-rewrite.md
.agents/skills/listing-automation-builder/SKILL.md
```

Reference project, for state-shape hints only:

```text
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser/index.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser/images.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser/carousel.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser/material.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser/preview.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser/color.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/common/page-parser.ts
```

Forbidden: direct port of source-project DOM logic.

## Parser output contract

`parseDraftPage(page)` returns `TemuPopDraftPageState`:

- Page identity: `url`, `page_title`, `template_key`, `shop_context`, `workflow_step`.
- Page guards: `is_login_required`, `is_loading`, `is_blocking_modal`.
- Field states: shop/category/title/English title/product SKU.
- Image states: carousel/material/preview/description image counts.
- SKU states: variant section, one-click SKU control, SKU table row count, SKU category batch, packing list batch.
- Video state: section found, upload button found/enabled, current video count.
- Submit state: shipping template, save button, publish button, success/failure toast.

Every returned nested value must be serializable and must not contain Playwright handles.

## Real test contract

- Default test run skips real parser tests unless `REAL_LISTING=1`.
- With `REAL_LISTING=1`, tests:
  1. Call `BitBrowserClient.listProfiles()`.
  2. Resolve the profile matching `2-1111`.
  3. Call `openProfile(profile.id)` and connect with `chromium.connectOverCDP(endpoint.http)`.
  4. Navigate to both Temu edit URLs.
  5. Run `parseDraftPage(page)`.
  6. Assert real state values:
     - `shop_context === "dianxiaomi-temu-pop"`
     - `workflow_step === "editing"`
     - login/loading/blocking guards are false
     - title/English title/SKU fields are found and have values
     - carousel/material/description image sections are found
     - `one_click_sku`, SKU table, save and publish controls are found
  7. Save screenshots and parsed state JSON under task evidence.

## Reuse analysis

- Direct reuse: `TEMU_POP_SELECTORS`, `TEMU_POP_TEMPLATE_URLS`, `selectorToLocator()`, `BitBrowserClient`.
- Abstract reuse: selector real-test connection pattern can be copied with local helper functions because it is test harness code, not runtime business logic.
- New implementation: `page-parser.ts` and `page-parser.real.test.ts`.
- Forbidden reuse: source project parser/action/workflow DOM traversal logic.
