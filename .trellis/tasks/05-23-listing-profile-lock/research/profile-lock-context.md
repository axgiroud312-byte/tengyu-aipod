# listing-profile-lock research

## Required source context

- `docs/spec/01-orchestration.md §4.1`
  - Same Bit Browser profile can be occupied by only one module at a time.
  - Modules in scope: `collection` and `listing`.
- `docs/spec/07-listing.md §4`
  - Listing runner must acquire a profile lock before connecting to Bit Browser/CDP.
  - On conflict, listing should surface `PROFILE_LOCKED`.
- `docs/adr/0004-listing-direct-port-with-rewrite.md`
  - Framework-level pieces can be ported/reused.
  - DOM automation remains four-layer and real-DOM-tested in later tasks.
- `.agents/skills/listing-automation-builder/SKILL.md`
  - This task is shared infrastructure, not a DOM workflow task, but later listing workflows depend on it.

## Existing implementation found

Existing files:

```text
packages/client/src/main/lib/browser-profile-lock.ts
packages/client/src/main/lib/browser-profile-lock.test.ts
packages/client/src/main/lib/collection-session-manager.ts
packages/client/src/main/lib/collection-session-manager.test.ts
```

Current shape:

- `BrowserProfileLockManager` stores locks in a `Map`.
- `browserProfileLocks` exports a singleton.
- `CollectionSessionManager` acquires a `collection` lock before CDP connect.
- Collection tests already verify releasing the lock when CDP connect fails.

Likely gaps for this task:

- Add/confirm explicit conflict coverage for `collection` vs `listing`.
- Add/confirm `clear()` coverage for process-exit cleanup.
- Add/confirm `status()` / `list()` expose module, task id, profile id, and `acquiredAt`.
- Listing runner code does not exist yet; this task exposes the shared singleton now, and `listing-runner-port` must acquire it before CDP connection.
- The renderer can read current locks through `browser-profile-lock:list`; actual profile list presentation belongs to `listing-module-ui`, because listing UI is task 18.

## Slice 8 v1 real test baseline

Templates:

| Platform | URL | Material root |
|---|---|---|
| Temu clothing | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515` | `/Users/macmini/Desktop/服装素材摆放举例`, excluding `GzG00010` |
| Temu general goods | `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551` | `/Users/macmini/Desktop/素材文件夹` |
| Shein | `https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551` | `/Users/macmini/Desktop/服装素材摆放举例/GzG0001` |

Core workflow actions for later platform tasks:

1. Replace shop name.
2. Replace title.
3. Replace images.
4. Generate SKU with one click.
5. Upload video with one click.

Real tests for DOM tasks must target the already-open Bit Browser `2-1111` profile via `bit-browser-adapter` `list-profiles` plus Playwright `connectOverCDP`, guarded by `REAL_LISTING=1`.
