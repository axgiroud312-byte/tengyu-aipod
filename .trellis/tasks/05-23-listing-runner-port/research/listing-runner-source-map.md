# listing-runner-port research

## Purpose

Port the stable listing runner framework from `/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner*` into Tengyu without importing any Dianxiaomi DOM action logic.

The runner should schedule listing items, acquire profile locks, connect to Bit Browser/CDP, retry retryable workflow failures, persist `listing_status`, and emit progress. Platform selectors/parser/executor/workflow remain separate tasks.

## Source files reviewed

```text
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner/batch-runner.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner/browser-sessions.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner/failures.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner/reporting.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner/types.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/listing-execution.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/types/listing.ts
```

## Port plan

Port into:

```text
packages/client/src/modules/listing/runner.ts
packages/client/src/modules/listing/runner.test.ts
```

Stable framework pieces to keep:

- `runLocalListingBatch` entry point.
- `runWorkspace` per-profile serial worker.
- `runItemWithRetries` per-item retry loop.
- Round-robin item assignment across enabled workspaces.
- Profile lock acquisition with module `listing`, release in `finally`.
- CDP connection through the existing `CDPClient` abstraction.
- `failStreakLimit` pause behavior.
- `listing_status` table with success resume skip.
- `listing:progress` events for UI consumption.

Avoid in this task:

- Source `runner/item-runner.ts` platform/page action imports.
- Source `platforms/*` selectors, parsers, actions, or workflows.
- Any fixture HTML tests.
- Real Dianxiaomi DOM assertions; those start at `listing-temu-selectors`.

## Target codebase findings

- Existing Bit Browser adapter: `packages/client/src/main/lib/bit-browser-client.ts`.
- Existing CDP adapter: `packages/client/src/main/lib/cdp-client.ts`.
- Existing shared profile lock: `packages/client/src/main/lib/browser-profile-lock.ts`.
- Existing main-process service/test style: `collection-session-manager.ts` and `collection-session-manager.test.ts`.
- Existing workspace metadata DB path: `{workbenchRoot}/.workbench/workbench.db`.

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

Real DOM tests must target Bit Browser `2-1111`, use `list-profiles` plus `connectOverCDP`, and be guarded by `REAL_LISTING=1`. This runner task keeps DOM-free unit tests and exposes the workflow injection point that later real tests will use.
