# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

(To be filled by the team)

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

(To be filled by the team)

### Scenario: Listing Shared Type Contract

#### 1. Scope / Trigger
- Trigger: listing runner, batch loader, platform workflow, evidence, and UI all need the same v1 listing data contract.
- Boundary: shared listing types live in `packages/shared/src/listing-types.ts`; platform DOM code must stay under the listing platform four-layer structure.

#### 2. Signatures
- Export source: `packages/shared/src/listing-types.ts`
- Re-export: `packages/shared/src/index.ts`
- Core types: `ListingItem`, `ListingConfig`, `ListingResult`, `StageResult`, `WorkspaceResult`, `ListingTemplateKey`, `ListingPlatformKey`, `ListingErrorCode`
- Template constants: `SLICE_8_LISTING_TEMPLATES`
- Pure helpers: `isListingRetryable`, `createListingFailure`, `listingFailureFromAppError`

#### 3. Contracts
- Slice 8 v1 template keys are exactly `temu-clothing`, `temu-general`, and `shein`.
- Platform keys are `temu-pop` and `shein`.
- Template constants must carry the real Dianxiaomi edit URLs and real local material roots used by listing tests.
- Listing failures must be serializable and mapped to existing `ErrorCode` values.
- `packages/shared/src/listing-types.ts` must not import Playwright, Electron, filesystem modules, DOM selectors, runner orchestration, or platform workflow code.

#### 4. Validation & Error Matrix
- Retryable listing errors: `TIMEOUT`, `BLOCKING_MODAL`, `PAGE_NOT_READY`, `FILE_CHOOSER_TIMEOUT`, `FIELD_VALUE_MISMATCH`, `UPLOAD_COUNT_MISMATCH`, `UNKNOWN`.
- Non-retryable listing errors: `LOGIN_REQUIRED`, `SELECTOR_NOT_FOUND`, `DRAFT_NOT_FOUND`, `PUBLISH_FAILED`, `PROFILE_LOCKED`, `BROWSER_NOT_CONNECTED`, `CONSECUTIVE_FAILURES`, `MATERIAL_FILE_MISSING`.
- Unknown `AppErrorClass` codes map to listing `UNKNOWN`.

#### 5. Good/Base/Bad Cases
- Good: runner, UI, and platform workflow import listing contracts from `@tengyu-aipod/shared`.
- Base: a platform-specific parser defines local DOM state types but converts workflow-facing results into shared `StageResult` / `ListingResult`.
- Bad: a platform folder defines its own `ListingItem` or hard-codes duplicate Slice 8 template URLs.

#### 6. Tests Required
- Shared package unit tests assert the three v1 templates, real material roots, error retryability, AppError mapping, and assignability of runner-facing result shapes.
- Quality gates: `pnpm -F @tengyu-aipod/shared test`, `pnpm -F @tengyu-aipod/shared type-check`, `pnpm -F @tengyu-aipod/shared lint`.
- Cross-package gates: `pnpm -F @tengyu-aipod/client build`, `pnpm -F @tengyu-aipod/client test`, `pnpm -F @tengyu-aipod/client type-check`, `pnpm -F @tengyu-aipod/client lint`, plus root `pnpm test`, `pnpm type-check`, and `pnpm lint`.

#### 7. Wrong vs Correct

Wrong:
```ts
type ListingItem = {
  sku: string
  editUrl: string
}
```

Correct:
```ts
import type { ListingItem } from '@tengyu-aipod/shared'
```

### Scenario: Listing Batch Loader Contract

#### 1. Scope / Trigger
- Trigger: listing runner/UI need a filesystem scan result from a local `05-货号成品/{batch}/` directory.
- Boundary: scanner lives in Electron client main code and returns shared listing contracts; it must not depend on Playwright, DOM selectors, or platform workflow code.

#### 2. Signatures
- `loadBatchAsListingItems(batchDir, options?): Promise<ListingMaterialScanResult & { listingItems: ListingItem[] }>`
- Options: `{ template?: ListingTemplateConfig; excludedFolderNames?: string[] }`
- Title source: `readExistingTitles(join(batchDir, 'titles.xlsx'))`

#### 3. Contracts
- Scan only first-level SKU folders under `batchDir`.
- Template is explicit from `options.template` or inferred by matching `SLICE_8_LISTING_TEMPLATES[].materialRootDir`.
- Excluded folder names are `template.excludedFolderNames + options.excludedFolderNames`; v1 Temu clothing excludes `GzG00010` through the template config.
- Missing title or missing images produces a warning and skips that SKU.
- Image paths are natural-sorted and mapped into `ListingItem.imageGroups`; top-level loose images default to `material`.
- Nested non-role folders become `variantGroups` and their images are also placed in `imageGroups.sku`.
- Video files and description text are optional fields; absent values should not be serialized as explicit `undefined`.

#### 4. Validation & Error Matrix
- Empty or missing `titles.xlsx` -> warning on batch, then per-SKU title warnings as applicable.
- SKU folder with no supported images -> warning and skip.
- Excluded folder -> no item and no warning.
- Existing real Slice 8 material roots should scan without `REAL_LISTING` because scanning is pure local file I/O.

#### 5. Good/Base/Bad Cases
- Good: runner consumes `listingItems` typed as shared `ListingItem[]`.
- Base: UI may show `items` for scan preview and pass `listingItems` to runner.
- Bad: duplicating a local `ListingItem` shape in the scanner or hard-coding `GzG00010` in loader logic.

#### 6. Tests Required
- Unit tests cover title lookup, natural image ordering, excluded folders, missing title/image warnings, nested variant folders, videos, and description text.
- Real-path smoke test should attempt the three `SLICE_8_LISTING_TEMPLATES` roots when they exist and skip missing paths without failing.

#### 7. Wrong vs Correct

Wrong:
```ts
const excluded = folder.name === 'GzG00010'
```

Correct:
```ts
const excluded = template.excludedFolderNames.includes(folder.name)
```

### Scenario: Listing Platform Selector Contract

#### 1. Scope / Trigger
- Trigger: a listing platform adds a `selectors.ts` file for Dianxiaomi DOM automation.
- Boundary: selectors are static locator contracts only. Page reading, clicking, parsing, uploading, saving, and publishing belong to parser/executor/workflow/smoke tasks.

#### 2. Signatures
- Platform selector file: `packages/client/src/modules/listing/platforms/<platform>/selectors.ts`
- Selector type: ``type ListingSelector = `css=${string}` | `text=${string}` | `label=${string}` | `placeholder=${string}` | `role=${string}```
- Selector table: `PLATFORM_SELECTORS satisfies Record<SelectorKey, readonly ListingSelector[]>`
- Real-test required keys: `PLATFORM_REQUIRED_REAL_SELECTOR_KEYS satisfies readonly SelectorKey[]`
- Test guard: `REAL_LISTING=1`

#### 3. Contracts
- Every selector value must use an explicit prefix: `css=`, `text=`, `label=`, `placeholder=`, or `role=`.
- Every selector group must provide at least two candidates so executor tasks have fallbacks.
- `selectors.ts` must not import Playwright, Electron, filesystem modules, Bit Browser clients, or runtime runner code.
- Real selector tests must connect to the existing Bit Browser profile required by the task and assert selectors against real Dianxiaomi pages.
- Real selector tests must be skipped by default and run only when `REAL_LISTING=1` is set.
- Evidence should include screenshots, selector hit reports, and lightweight DOM snapshots around matched elements. Do not commit full multi-megabyte page HTML dumps when smaller selector-scoped snapshots prove the contract.

#### 4. Validation & Error Matrix
- Missing prefix -> selector unit test failure.
- Fewer than two candidates for a selector key -> selector unit test failure.
- Required real selector key has no hit on any target template -> `REAL_LISTING=1` test failure.
- Real profile unavailable or not logged in -> `REAL_LISTING=1` test failure; default CI remains green because the real test is skipped.
- Full-page HTML evidence larger than needed -> replace with selector-scoped DOM snapshots before committing.

#### 5. Good/Base/Bad Cases
- Good: static selector table plus default unit tests and a guarded real test that writes a selector hit report.
- Base: platform-specific helper converts prefixed selector strings into Playwright locators inside the test or executor layer.
- Bad: `selectors.ts` calls `page.locator()`, reads DOM, clicks buttons, opens Bit Browser, or contains page workflow logic.

#### 6. Tests Required
- Unit tests assert every selector group has at least two candidates and every candidate uses an allowed prefix.
- Unit tests assert all required real selector keys exist.
- Guarded real tests assert each required key hits both real v1 templates and persist evidence under the task's `evidence/` directory.
- Quality gates: `pnpm -F @tengyu-aipod/client test`, `pnpm -F @tengyu-aipod/client type-check`, `pnpm -F @tengyu-aipod/client lint`, `pnpm -F @tengyu-aipod/client build`, plus root `pnpm test`, `pnpm type-check`, and `pnpm lint`.

#### 7. Wrong vs Correct

Wrong:
```ts
export async function titleInput(page: Page) {
  return page.getByLabel('Product title')
}
```

Correct:
```ts
export const PLATFORM_SELECTORS = {
  title_input: ['label=Product title', 'css=.title input'],
} as const satisfies Record<SelectorKey, readonly ListingSelector[]>
```

---

## Validation

<!-- Runtime validation patterns (Zod, Yup, io-ts, etc.) -->

(To be filled by the team)

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

(To be filled by the team)

---

## Forbidden Patterns

<!-- any, type assertions, etc. -->

(To be filled by the team)
