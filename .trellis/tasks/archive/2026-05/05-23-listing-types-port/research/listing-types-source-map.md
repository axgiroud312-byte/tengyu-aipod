# listing-types-port research

## Purpose

Port stable listing shared types and error-code contracts from `/Users/macmini/Desktop/一键pod/上架程序/packages/shared` into Tengyu's `packages/shared` package.

This task must not port runner orchestration, DOM selectors, page parser logic, action logic, or workflow logic.

## Source files reviewed

```text
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/types/listing.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/listing-execution.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/listing-orchestration.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/constants/error-codes.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/tests/listing-execution.test.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/tests/listing-orchestration.test.ts
```

## Port plan

Port into:

```text
packages/shared/src/listing-types.ts
```

Export from:

```text
packages/shared/src/index.ts
```

Stable v1 subset to include:

- v1 platform/template identifiers for the three requested templates:
  - Temu clothing
  - Temu general goods
  - Shein
- `ListingItem`, `ListingConfig`, `ListingResult`, `StageResult`, `WorkspaceResult`.
- Image group types used by batch loader and workflow.
- Execution stage / state / progress event contracts used by runner and evidence tasks.
- Listing error code constants and retryability helper based on `docs/spec/07-listing.md §8`.
- `createListingFailure` helper that returns serializable data compatible with `AppErrorClass` details.

Avoid in this task:

- Source project `LISTING_TEMPLATE_CONFIGS` selector-heavy/default-selector blocks.
- Source project orchestration preview functions.
- Any Playwright, DOM, selector, runner, or workflow implementation.
- v1.5 platform-specific templates beyond disabled/future string unions unless they are needed for type compatibility.

## Slice 8 v1 real test baseline

Templates:

| Platform | URL | Material root |
|---|---|---|
| Temu clothing | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`, excluding `GzG00010` |
| Temu general goods | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

Core workflow actions for each template:

1. Replace shop name.
2. Replace title.
3. Replace images.
4. Generate SKU with one click.
5. Upload video with one click.

Real DOM tests are required only from selector/parser/executor/workflow/smoke tasks onward. They must target Bit Browser `2-1111`, use `list-profiles` plus `connectOverCDP`, and be guarded by `REAL_LISTING=1`.
