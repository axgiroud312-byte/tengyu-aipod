# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

### Scenario: Listing Runner Framework

#### 1. Scope / Trigger
- Trigger: listing batch orchestration, Bit Browser workspace scheduling, listing resume, listing progress IPC changes, or platform parser state changes.
- Boundary: the runner framework lives in `packages/client/src/modules/listing/runner.ts`; platform DOM automation must stay in platform `selectors/`, `page-parser/`, `action-executor/`, and `workflow/` layers.

#### 2. Signatures
- `runLocalListingBatch(config, items, dependencies?)`
- `runWorkspace(profileId, queue, config, dependencies?)`
- `runItemWithRetries(page, item, config, dependencies?)`
- IPC channel: `listing:run`
- Progress channel: `listing:progress`
- Platform parser signature: `parseDraftPage(page): Promise<TemuPopDraftPageState>` or the platform-specific equivalent.

#### 3. Contracts
- Runner config uses snake_case fields at the orchestration boundary: `task_id`, `batch_id`, `batch_dir`, `max_attempts`, `fail_streak_limit`, `timeout_ms`, `evidence_dir`.
- `listing_status` is the resume table keyed by `batch_path`, `sku_code`, `platform`, and `workspace_id`.
- Per workspace processing is serial; different workspaces run in parallel after round-robin item assignment.
- Profile locks must be acquired before CDP work and released in `finally`.
- The runner may call an injected platform workflow but must not contain Dianxiaomi selectors, parsers, upload clicks, SKU generation clicks, or other DOM business steps.
- `registerListingRunnerIpc()` is registered from `packages/client/src/main/index.ts`.
- Platform parsers return serializable observed state only; they must not return Playwright `Locator` or `ElementHandle` objects.
- Parser loading guards must check visible loading indicators, not merely selector existence. Dianxiaomi can keep hidden loading DOM in the page after the editor is ready.
- Toast guards must be scoped to Ant Design message/notification containers. Do not use whole-page `text=发布失败` / `text=发布成功` selectors because explanatory copy can contain those words.

#### 4. Validation & Error Matrix
- No selected workspaces -> validation `AppErrorClass`.
- Missing platform workflow -> validation `AppErrorClass`.
- Retryable workflow errors are retried up to `max_attempts`; non-retryable errors fail the item immediately.
- Reaching `fail_streak_limit` pauses that workspace and marks remaining queued items skipped.
- Resume mode skips existing `success` rows in `listing_status`.
- Missing parser fields -> parser returns `found=false` and `count=0`; executor/workflow owns converting that state into structured action errors.
- Hidden loading indicator only -> `is_loading=false`.
- Copy text containing "publish failed" semantics outside toast containers -> `failure_toast.found=false`.

#### 5. Tests Required
- Runner unit tests must cover workspace assignment, profile lock release, retry behavior, resume skips, `listing_status` writes, fail-streak pause, and progress emission.
- Runner tests must use injected workflow/CDP/status-store dependencies. Real Dianxiaomi DOM tests belong to platform selector/parser/executor/workflow tasks and are guarded by `REAL_LISTING=1`.
- Platform parser real tests must assert page guards, field states, image counts, SKU controls, video controls, and save/publish controls directly against the real Dianxiaomi DOM.
- Parser evidence must include screenshots and serialized parser state JSON for each real template.

#### 6. Wrong vs Correct

Wrong:
```ts
const isLoading = await page.getByText('加载中').count() > 0
const hasFailure = await page.getByText('发布失败').count() > 0
```

Correct:
```ts
const isLoading = await visibleCount(page.locator('#dPageLoading, .d-module-loading')) > 0
const hasFailure = await page.locator('.ant-message-error, .ant-notification-notice-error').count() > 0
```

### Scenario: Listing Failure Retry Contract

#### 1. Scope / Trigger
- Trigger: listing failure list UI, failed-only retry controls, listing status IPC, evidence folder opening, or `listing_status` schema changes.
- Boundary: renderer code must request status rows through preload IPC; it must not open sqlite directly or bypass `ListingRunner`.

#### 2. Signatures
- IPC: `listing:list-status(input: { batchDir: string; platform?: ListingPlatformKey; status?: ListingStatus }): Promise<ListingStatusRow[]>`
- IPC: `listing:open-path(input: { path: string }): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>`
- Runner retry config: `ListingRunConfig.retry_failed_only?: boolean`
- DB row field: `listing_status.last_error_code TEXT`

#### 3. Contracts
- Failure lists read `listing_status` rows keyed by `batch_path`, `sku_code`, `platform`, and `workspace_id`.
- Failed-only retry must pass `resume: true` and `retry_failed_only: true`; the runner then runs only rows whose existing status is `failed`.
- Single-row retry must preserve the failed row's `workspace_id`; multi-workspace retries must group rows per workspace so round-robin assignment cannot point a SKU at the wrong status key.
- Evidence links open through main-process `shell.openPath`, not through renderer filesystem access.
- Success or uploading status writes must clear `last_error_code`; failed and skipped rows must persist the structured listing failure code.

#### 4. Validation & Error Matrix
- Missing `batchDir` in `listing:list-status` -> validation `AppErrorClass`.
- Missing `path` in `listing:open-path` -> validation `AppErrorClass`.
- `shell.openPath` returns an error string -> `{ ok: false, error: { code: 'OPEN_PATH_FAILED', message } }`.
- `retry_failed_only` sees a non-failed existing row -> runner skips that item instead of mutating the real page.
- Missing matching scanned listing item for a failed row -> UI must stop before launching retry.

#### 5. Good/Base/Bad Cases
- Good: UI scans the batch, reads failed rows through IPC, opens evidence, and retries failed SKUs through `listing:run`.
- Base: no failed rows returns an empty list and disables retry actions.
- Bad: renderer imports `better-sqlite3`, retries all scanned SKUs without `retry_failed_only`, or launches a multi-workspace retry that changes each row's `workspace_id`.

#### 6. Tests Required
- Runner tests assert failed rows store `last_error_code`, success clears it, and fail-streak skipped rows store `CONSECUTIVE_FAILURES`.
- Default client tests must keep real Dianxiaomi tests skipped unless `REAL_LISTING=1`.
- Quality gates: `pnpm -F @tengyu-aipod/client build`, `pnpm -F @tengyu-aipod/client test`, `pnpm -F @tengyu-aipod/client type-check`, `pnpm -F @tengyu-aipod/client lint`, root `pnpm test`, `pnpm type-check`, `pnpm lint`, and `git diff --check`.

#### 7. Wrong vs Correct

Wrong:
```ts
await window.api.listing.run({ config: { retry_failed_only: false }, items: allItems })
```

Correct:
```ts
await window.api.listing.run({
  config: { resume: true, retry_failed_only: true, workspaces: [{ profile_id: row.workspace_id }] },
  items: [item],
})
```

### Scenario: Collection Session CDP Page Wiring

#### 1. Scope / Trigger
- Trigger: collection session startup/resume, BitBrowser CDP connection, platform-domain filtering, or injected collection script changes.
- Boundary: collection sessions are scoped to one BitBrowser profile. They must not be scoped to the first tab or first Playwright `BrowserContext`.

#### 2. Signatures
- `CollectionSessionManager.startSession(config: CollectionSessionConfig): Promise<CollectionSession>`
- `CollectionSessionManager.resume(): Promise<CollectionSession | null>`
- Internal CDP hook: `CDPClient.injectPageScript(page, { script, onEvent })`

#### 3. Contracts
- Startup must scan every existing `browser.contexts()` entry and every existing page before deciding whether to open an entry page.
- If any existing page matches the selected platform domains, startup must not open another entry page.
- If no existing page matches, startup may open exactly one page to the platform `entry_url`.
- Existing pages and future `context.on('page')` pages should be wired at the page level; the injected script owns platform-domain filtering before emitting data.
- `about:blank` pages must still be wired because they can later navigate to the selected platform.
- Stopping or reconnecting must detach every context page handler owned by the runtime.

#### 4. Validation & Error Matrix
- No browser context is available after CDP connection -> retryable browser/CDP error.
- Page script injection fails on a non-target existing page -> ignore that page and keep the session start path alive.
- Page script injection fails on the chosen target page -> surface the failure so session startup can fail.

#### 5. Good/Base/Bad Cases
- Good: a Temu tab in a second context is reused and brought to front without opening a duplicate Temu tab.
- Base: no Temu tab exists, so one Temu entry page is opened.
- Bad: only `browser.contexts()[0]` is scanned, causing hidden Temu tabs in other windows to be missed.
- Bad: new pages are wired only when their creation-time URL already matches the platform domain, which misses `about:blank -> Temu` flows.

#### 6. Tests Required
- Unit tests must cover existing allowed pages across multiple contexts, multiple allowed pages being wired, no duplicate entry page when an allowed page exists, one entry page when none exists, and `about:blank` new pages being wired.
- Injected script tests must assert non-platform pages stay inert and do not emit collection events.

#### 7. Wrong vs Correct

Wrong:
```ts
const context = browser.contexts()[0]
const page = context.pages().find((item) => isAllowedDomain(item.url(), domains))
```

Correct:
```ts
const pages = browser.contexts().flatMap((context) => context.pages())
const page = pages.find((item) => isAllowedDomain(item.url(), domains))
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
