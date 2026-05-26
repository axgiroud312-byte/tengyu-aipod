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

### Scenario: Listing Platform Commons and Selector Records

#### 1. Scope / Trigger
- Trigger: creating or modifying listing platform selector, parser, executor, workflow, real test, or cross-platform helper code under `packages/client/src/modules/listing/platforms/**`.
- Boundary: shared listing types live in `packages/shared/src/listing-types.ts`; cross-platform Playwright helper functions live in `packages/client/src/modules/listing/platforms/_commons/`; platform-specific DOM state and business actions stay in each platform directory.

#### 2. Signatures
- Shared selector type: ``ListingSelector = `css=${string}` | `text=${string}` | `label=${string}` | `placeholder=${string}` | `role=${string}```
- Shared selector record: `SelectorRecord<TKey extends string = string>`
- Required selector record fields: `key`, `name`, `primary`, `fallbacks`, `version`, `createdAt`
- Shared helper: `lookupSelector(records, key): SelectorRecord`
- Platform selector exports: `PLATFORM_SELECTOR_RECORDS satisfies readonly SelectorRecord<PlatformSelectorKey>[]`
- Platform compatibility map: `PLATFORM_SELECTORS = selectorRecordMap(PLATFORM_SELECTOR_RECORDS)`
- Common helper home: `packages/client/src/modules/listing/platforms/_commons/*.ts`

#### 3. Contracts
- `SelectorRecord[]` is the primary storage format for platform selectors. Plain `Record<key, selectors[]>` may exist only as a derived compatibility map.
- `primary` is the first selector attempted; `fallbacks` preserve fallback order.
- `version` and `createdAt` are required so v1.5 selector dispatch can replace local records with remote versioned records without another data-shape migration.
- Platform selector files must not import Playwright, Electron, filesystem modules, BitBrowser clients, runner code, parser code, executor code, or workflow code.
- Reusable primitives such as selector-to-locator conversion, fallback locating, editor ready waits, file chooser upload, toast feedback, action error classification, and test fixtures belong in `_commons`.
- `_commons` must stay function-based. Do not introduce inheritance, platform base classes, or mixins for listing actions.
- Business actions stay platform-local unless the observed state, target state, transition, success evidence, and failure policy are all identical across platforms.

#### 4. Validation & Error Matrix
- Missing selector prefix -> selector unit test failure.
- Missing selector record metadata -> selector unit test failure.
- Platform reimplements a helper already present in `_commons` -> review failure; replace with `_commons` import.
- `_commons` function without same-name unit test -> test coverage failure.
- Business action extracted only because function names match but DOM state differs -> refactor rejection; keep action platform-local.
- Remote selector dispatch attempted inside this layer before v1.5 contract exists -> out-of-scope rejection.

#### 5. Good/Base/Bad Cases
- Good: `selectors.ts` exports `TEMU_POP_SELECTOR_RECORDS` and derives `TEMU_POP_SELECTORS` with `selectorRecordMap`.
- Good: `page-parser.ts` calls `_commons/locateBySelectorsWithFallback` instead of defining its own fallback loop.
- Base: parser/executor can keep platform-specific state types and action functions while using `_commons` locator/wait/upload primitives.
- Bad: copying `selectorToLocator`, `waitUntilVisible`, or `ListingActionError` into a new platform folder.
- Bad: adding a `BaseListingPlatformExecutor` class that hides platform-specific parser/action verification.

#### 6. Tests Required
- `packages/shared/src/listing-types.test.ts` covers `SelectorRecord`, `lookupSelector`, and `ListingActionError`.
- Every `_commons/*.ts` file has a same-name `.test.ts`.
- Platform selector tests assert selector records and derived maps stay aligned.
- Parser/executor/workflow tests continue to assert serializable state, structured action errors, mutation guards, and stage evidence.
- Quality gates: `pnpm -F @tengyu-aipod/client test`, `pnpm -F @tengyu-aipod/client type-check`, `pnpm -F @tengyu-aipod/client lint`, `pnpm -F @tengyu-aipod/client build`, plus root `pnpm test`, `pnpm type-check`, and `pnpm lint`.
- Guarded real tests use `REAL_LISTING=1` and write evidence under the current task's `evidence/` directory.

#### 7. Wrong vs Correct

Wrong:
```ts
export const SHEIN_SELECTORS = {
  title_input: ['css=#productInfo input', 'label=产品标题'],
}
```

Correct:
```ts
export const SHEIN_SELECTOR_RECORDS = [
  {
    key: 'title_input',
    name: '产品标题输入框',
    primary: 'css=#productInfo input',
    fallbacks: ['label=产品标题'],
    version: '1.0.0',
    createdAt: '2026-05-26T00:00:00.000Z',
  },
] satisfies readonly SelectorRecord<SheinSelectorKey>[]

export const SHEIN_SELECTORS = selectorRecordMap(SHEIN_SELECTOR_RECORDS)
```

Wrong:
```ts
function selectorToLocator(page: Page, selector: ListingSelector) {
  // copied into a platform folder
}
```

Correct:
```ts
import { locatorForSelector } from '../_commons/page-locator'
```

### Scenario: Listing Platform Page Parser Contract

#### 1. Scope / Trigger
- Trigger: a listing platform adds a `page-parser.ts` file for Dianxiaomi DOM automation.
- Boundary: parsers read DOM and return observed state only. They must not click, fill, upload, save, publish, or return Playwright handles to executor/workflow code.

#### 2. Signatures
- Platform parser file: `packages/client/src/modules/listing/platforms/<platform>/page-parser.ts`
- Parser entry: `parseDraftPage(page: Page): Promise<PlatformDraftPageState>`
- State shape must include page identity, page guards, field states, upload/image states, SKU states, submit controls, and toast states when the platform supports them.
- Test guard: `REAL_LISTING=1`

#### 3. Contracts
- Parser return values must be JSON-serializable data: strings, numbers, booleans, nulls, arrays, and plain objects.
- Parser return values must not include `Page`, `Locator`, `ElementHandle`, DOM nodes, functions, promises, or class instances.
- Missing DOM elements must not throw by default. Return `found=false`, `count=0`, or `current_value=null` so executor/action code can raise structured listing errors with full state.
- Parsers should consume the platform selector table instead of scattering new locator strings. If a new locator is required, add it to `selectors.ts` first.
- Real parser tests must connect to the existing Bit Browser profile required by the task and assert state against real Dianxiaomi pages.
- Real parser tests must be skipped by default and run only when `REAL_LISTING=1` is set.
- Evidence should include screenshots and parsed state JSON. Avoid full-page HTML dumps unless a failure needs one.

#### 4. Validation & Error Matrix
- Parser throws on a missing optional/expected field -> test failure; return a not-found state instead.
- Parser returns a Playwright handle or non-serializable value -> unit test failure via JSON serialization.
- Real page guard says login/loading/blocking when the page is actually ready -> `REAL_LISTING=1` test failure.
- Required fields missing on both real templates -> `REAL_LISTING=1` test failure and selector/parser review.

#### 5. Good/Base/Bad Cases
- Good: `parseDraftPage(page)` reads fields, image counts, button states, and page guards into a serializable state object.
- Base: helper functions may use `Locator` internally for short-lived reads and discard it before returning.
- Bad: parser clicks dropdowns, mutates fields, stores locators in state, or calls executor/workflow code.

#### 6. Tests Required
- Unit tests assert parser state is JSON-serializable.
- Guarded real tests assert core page guards and required field/control states on the real v1 templates.
- Quality gates: `pnpm -F @tengyu-aipod/client test`, `pnpm -F @tengyu-aipod/client type-check`, `pnpm -F @tengyu-aipod/client lint`, `pnpm -F @tengyu-aipod/client build`, plus root `pnpm test`, `pnpm type-check`, and `pnpm lint`.

#### 7. Wrong vs Correct

Wrong:
```ts
return {
  titleField: page.locator('input[name="title"]'),
}
```

Correct:
```ts
return {
  title_field: {
    found: true,
    current_value: await titleInput.inputValue(),
    is_disabled: false,
  },
}
```

### Scenario: Listing Platform Action Executor Contract

#### 1. Scope / Trigger
- Trigger: a listing platform adds an `action-executor.ts` file for Dianxiaomi DOM automation.
- Boundary: executors perform one action primitive at a time. They must not orchestrate a full listing workflow, persist batch results, or reuse parser-time Playwright handles.

#### 2. Signatures
- Platform executor file: `packages/client/src/modules/listing/platforms/<platform>/action-executor.ts`
- Text actions return the post-action parser state: `fillTitle(page, value): Promise<PlatformDraftPageState>`
- Mutating upload/SKU actions must expose an explicit guard option such as `{ allowMutation?: boolean }`.
- Publishing must use a separate explicit guard such as `{ allowPublish?: boolean }`.
- Structured error: `ListingActionError` must carry `action`, listing error code, selector when known, URL/state context, page text excerpt, and optional evidence path.

#### 3. Contracts
- Every action must follow this sequence: `parseDraftPage(page)` -> validate page/action preconditions -> re-locate the target selector -> perform the action -> parse again -> verify the target state.
- Parser state is evidence, not a handle cache. Do not store or pass `Locator` / `ElementHandle` values from parser state into executor steps.
- Low-risk real tests may write the existing field value back to the same field.
- High-risk actions that change real drafts, including image upload, video upload, one-click SKU generation, shop switching, saving, and publishing, must be blocked by default and require explicit guard options.
- Upload success must be proven by parser-visible count/card/toast state, not by a file chooser opening or `setInputFiles()` resolving.
- Real executor tests must be skipped by default and run only when `REAL_LISTING=1` is set. Mutating real tests need a second guard such as `REAL_LISTING_MUTATE=1`.

#### 4. Validation & Error Matrix
- Login page -> `LOGIN_REQUIRED`
- Loading page or non-editing workflow step -> `PAGE_NOT_READY`
- Blocking modal -> `BLOCKING_MODAL`
- Missing target selector/control -> `SELECTOR_NOT_FOUND`
- Text value not reflected after fill -> `FIELD_VALUE_MISMATCH`
- Missing local media file -> `MATERIAL_FILE_MISSING`
- Upload control/file chooser unavailable -> `FILE_CHOOSER_TIMEOUT`
- Upload count/card does not change or failure toast appears -> `UPLOAD_COUNT_MISMATCH`
- Publish guard missing or publish fails -> `PUBLISH_FAILED`

#### 5. Good/Base/Bad Cases
- Good: `fillTitle` parses current state, re-locates `title_input`, fills, blurs, then waits until parser reads the target title.
- Base: `replaceShopName` returns immediately when the current shop already matches the target, and requires `allowMutation=true` only when changing shops.
- Bad: upload actions call `setInputFiles()` and return success without reading parser state after the upload.

#### 6. Tests Required
- Unit tests assert structured error shape, missing-file behavior, default mutation guards, and safe same-value no-op behavior.
- Guarded real tests assert low-risk same-value text/shop actions on both real v1 Temu templates with `REAL_LISTING=1`.
- Mutating real tests, when run, must explicitly set both `REAL_LISTING=1` and `REAL_LISTING_MUTATE=1`, use real material roots, and write evidence under the task evidence directory.
- Quality gates: `pnpm -F @tengyu-aipod/client test`, `pnpm -F @tengyu-aipod/client type-check`, `pnpm -F @tengyu-aipod/client lint`, `pnpm -F @tengyu-aipod/client build`, plus root `pnpm test`, `pnpm type-check`, and `pnpm lint`.

#### 7. Wrong vs Correct

Wrong:
```ts
await page.locator('#localFileUploadInp').setInputFiles(files)
return { ok: true }
```

Correct:
```ts
const before = await parseDraftPage(page)
await uploadFiles(page, files)
const after = await parseDraftPage(page)
if (after.carousel_images.count <= before.carousel_images.count) {
  throw new ListingActionError({ action: 'uploadCarouselImages', code: 'UPLOAD_COUNT_MISMATCH' })
}
```

### Scenario: Listing Platform Workflow Contract

#### 1. Scope / Trigger
- Trigger: a listing platform adds a `workflow.ts` file that orchestrates selectors, parser, and action executor into runner-facing listing results.
- Boundary: workflow owns business sequencing, stage evidence, and `ListingResult` assembly. It must not introduce scattered selectors, direct low-level DOM click/upload logic, or fake-DOM tests.

#### 2. Signatures
- Platform workflow file: `packages/client/src/modules/listing/platforms/<platform>/workflow.ts`
- Runner entry: `runListingItem(page, item, config): Promise<ListingResult>`
- Optional test seam: `runListingItem(page, item, config, dependencies?)` may inject action functions and `now()` for pure contract tests, but real DOM behavior must be covered by `*.real.test.ts`.
- Stage constants must use shared `ListingStage` values from `@tengyu-aipod/shared`.

#### 3. Contracts
- Every workflow stage records `observed_state`, `target_state`, `transition`, and `success_evidence` in `StageResult.details`.
- Every stage saves screenshot and compact DOM evidence under `config.evidenceDir/<stage>/`.
- Workflow failures must throw a serializable `ListingFailure` so `ListingRunner` can preserve the failing stage and decide retry behavior.
- Mutating actions such as image upload, video upload, one-click SKU, shop switching, saving, and publishing must stay guarded by explicit options and be skipped or rejected by default.
- `submit_publish` and `publish_result` must not publish real goods in `save-draft` mode.
- Real workflow tests must use the existing Bit Browser profile through `listProfiles()` plus `connectOverCDP`; do not create a new profile and do not mock CDP.

#### 4. Validation & Error Matrix
- Parser never reaches editable state before timeout -> `PAGE_NOT_READY`.
- Login page -> `LOGIN_REQUIRED`.
- Missing local image/video when mutation is explicitly enabled -> `MATERIAL_FILE_MISSING`.
- Action executor failure -> convert to `ListingFailure` with action selector/url/evidence when available.
- Workflow stage returns without evidence -> test failure.
- Default CI run executes only non-real tests; `REAL_LISTING=1` enables real DOM tests; `REAL_LISTING_MUTATE=1` is required for real draft mutation.

#### 5. Good/Base/Bad Cases
- Good: workflow stage calls parser, delegates action to executor, reparses through executor or parser, saves evidence, and returns typed `StageResult`.
- Base: default real workflow test performs low-risk same-value field actions and records guarded skips for upload/SKU mutation.
- Bad: workflow test uses fixture HTML or a fake Playwright page to claim end-to-end workflow success.

#### 6. Tests Required
- Pure tests may cover stage constants and deterministic helper functions using real material paths.
- Guarded real tests must run the workflow against every task-required real template and assert all stage details/evidence on the real page DOM.
- Quality gates: client build/test/type-check/lint, root test/type-check/lint, and `git diff --check`.

#### 7. Wrong vs Correct

Wrong:
```ts
it('runs workflow', async () => {
  const page = fakePageFromHtml('<input name="title">')
  await runListingItem(page, item, config)
})
```

Correct:
```ts
const browser = await chromium.connectOverCDP(endpoint.http)
const page = await browser.contexts()[0].newPage()
await page.goto(template.editUrl)
const result = await runListingItem(page, item, config)
expect(result.stages.every((stage) => stage.screenshotPath)).toBe(true)
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
