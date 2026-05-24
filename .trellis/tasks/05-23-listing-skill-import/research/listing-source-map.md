# listing-skill-import research: source map

## Purpose

This task imports the `listing-automation-builder` skill before any Slice 8 listing implementation starts.

## Required project contracts

- `docs/adr/0004-listing-direct-port-with-rewrite.md`
  - Port only the listing framework pieces from `/Users/macmini/Desktop/一键pod/上架程序`.
  - Rewrite Dianxiaomi DOM automation per the skill's four layers: `selectors`, `page-parser`, `action-executor`, `workflow`.
  - Validate selectors and state transitions on real Dianxiaomi pages.
- `docs/spec/07-listing.md`
  - v1 supports Temu PopTemu and Shein.
  - Framework code can be ported; platform DOM code must be rewritten.
  - Runtime platform directories must keep selectors/parser/executor/workflow boundaries separate.

## External source tree

Reference root:

```text
/Users/macmini/Desktop/一键pod/上架程序
```

Use only as reference. Do not directly port DOM automation from platform folders.

Relevant source paths discovered for later tasks:

```text
/Users/macmini/Desktop/一键pod/上架程序/.agents/skills/listing-automation-builder/SKILL.md
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/types/listing.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/listing-execution.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/shared/src/listing-orchestration.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/runner/
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/stage-evidence.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/main/ListingAdapter.ts
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/main/bitbrowser-cdp.ts
```

Platform DOM folders are for behavioral reconnaissance only; selectors/actions must be rewritten:

```text
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/
/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/shein/
```

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

Test constraints:

- Target the already-open Bit Browser `2-1111` profile.
- Use `bit-browser-adapter` `list-profiles` plus Playwright `connectOverCDP`.
- Do not create a new profile and do not mock CDP.
- Real DOM tests are gated by `REAL_LISTING=1`; CI skips them by default.
- Selectors/parser/executor/workflow assertions must hit real Dianxiaomi DOM, not fixture HTML.
- Smoke tests must upload real material files to real template pages and assert resulting DOM state.
