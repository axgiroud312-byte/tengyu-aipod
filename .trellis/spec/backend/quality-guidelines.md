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

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
