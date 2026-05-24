# Temu PopTemu Workflow Contract

## Scope

Task: `05-23-listing-temu-workflow`.

Implement the Temu PopTemu workflow layer for the two Slice 8 v1 templates:

- Temu clothing: `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515`
- Temu general: `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551`

The workflow must orchestrate the existing rewritten layers:

- `selectors.ts`: static selector contracts only.
- `page-parser.ts`: reads real Dianxiaomi DOM state.
- `action-executor.ts`: performs action primitives and reparses state.
- `workflow.ts`: business state machine, stage evidence, and final `ListingResult`.

## Required Core Actions

The workflow must cover these five actions for both Temu templates:

1. Replace shop name.
2. Replace title.
3. Replace images.
4. Generate SKU code.
5. Upload video.

Mutation-heavy actions must remain guarded. Default tests can run low-risk same-value operations; real uploads and SKU generation require `REAL_LISTING_MUTATE=1`.

## Stage Contract

Use the 12-stage PopTemu sequence from the source framework, normalized to this project:

1. `enter_page`
2. `page_ready`
3. `confirm_shop_context`
4. `fill_title_and_sku`
5. `upload_material_images`
6. `upload_video`
7. `process_color_skc`
8. `reuse_size_chart`
9. `generate_sku_code`
10. `process_description`
11. `submit_publish`
12. `publish_result`

Every stage records:

- `observed_state`
- `target_state`
- `transition`
- `success_evidence`
- screenshot path
- DOM snapshot path

Failures should be thrown so the runner owns retry behavior.

## Source Project Reference Boundary

Allowed source references:

- `/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/common/selectors.ts`
  - Stage names, labels, and high-level target/verify concepts.
- `/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/workflow.ts`
  - Workflow orchestration shape only.
- `/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/stage-evidence.ts`
  - Evidence idea only.

Forbidden to port:

- `/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/actions/**`
- `/Users/macmini/Desktop/一键pod/上架程序/packages/client/src/worker/listing/pop-temu/page-parser/**`
- Any source-project selector or click/upload implementation.

Reason: ADR-0004 explicitly requires rewriting Dianxiaomi DOM logic using `listing-automation-builder`.

## Real Testing Baseline

Real tests must target the existing Bit Browser `2-1111` profile:

- Use `bit-browser-client.listProfiles()`.
- Use `bitBrowserClient.openProfile(profile.id)` and `chromium.connectOverCDP(endpoint.http)`.
- Do not create a new profile.
- Do not mock CDP.
- Assertions must hit the real Dianxiaomi DOM.

Guard:

- `REAL_LISTING=1` enables real tests.
- CI/default test run skips real tests.
- `REAL_LISTING_MUTATE=1` enables real upload/SKU mutation.

Known current constraint from the executor task: the two Temu material roots did not contain real video files during executor verification. The workflow must report this honestly; do not create fake video fixtures.

## Verification Notes

2026-05-25 local verification:

- `REAL_LISTING=1 pnpm -F @tengyu-aipod/client test -- src/modules/listing/platforms/dianxiaomi-temu-pop/workflow.real.test.ts`
- Result: passed against Bit Browser `2-1111`.
- Evidence:
  - `.trellis/tasks/05-23-listing-temu-workflow/evidence/real-workflow-state-report.json`
  - `.trellis/tasks/05-23-listing-temu-workflow/evidence/real-workflow-temu-clothing.png`
  - `.trellis/tasks/05-23-listing-temu-workflow/evidence/real-workflow-temu-general.png`
  - Per-stage screenshots/DOM under `evidence/temu-clothing/` and `evidence/temu-general/`.
- Mutation guard was off: workflow verified real DOM state, same-value shop/title/SKU actions, stage evidence, and guarded skip states for image/video/SKU mutation.
- Real image files were found for both templates.
- Real video files found under `/Users/macmini/Desktop`: `0`. Therefore `REAL_LISTING_MUTATE=1` video upload cannot honestly pass until the material roots contain real `.mp4`, `.mov`, or `.webm` files.
