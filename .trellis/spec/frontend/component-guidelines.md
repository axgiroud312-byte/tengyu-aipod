# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

(To be filled by the team)

---

## Scenario: Client Onboarding Wizard

### 1. Scope / Trigger

- Trigger: first-run onboarding, renderer wizard UI, Electron preload API, onboarding IPC handlers, or local onboarding config.
- Applies to: `packages/client/src/renderer/src/App.tsx`, `packages/client/src/preload/index.ts`, and `packages/client/src/main/onboarding.ts`.

### 2. Contracts

- First-run state is read from `app.getPath('userData')/activation-state.json`.
- Onboarding has four steps: activation, workbench root, optional API keys, completion.
- Activation goes through `window.api.activation.activate({ code, device_name })`.
- Main process generates the device fingerprint and posts to `${TENGYU_SERVER_URL ?? 'http://localhost:3000'}/api/activate`.
- Workbench root setup creates `01-采集`, `02-生图`, `03-检测`, `04-待套版印花`, `05-货号成品`, and `.workbench`.
- Task 12 stores activation token and entered API keys in local config only as a temporary placeholder. Task 13 must replace those secret values with OS keychain storage.
- After Task 13, activation tokens and API keys must be stored through `packages/client/src/main/lib/keychain.ts`, not `app-config.json`.
- Renderer code may call `window.api.keychain.has(key)`, but must not receive secret plaintext through IPC.

### 3. Validation & Error Matrix

- Activation errors from the server must be translated to Chinese-friendly renderer messages.
- Cancelled directory selection returns `{ ok: false, error: { code: 'CANCELLED' } }`.
- Completing onboarding writes `activation-state.json` and routes to the main workbench screen.

### 4. Tests Required

- `pnpm -F @tengyu-aipod/client lint`
- `pnpm -F @tengyu-aipod/client type-check`
- `pnpm -F @tengyu-aipod/client build`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`

---

## Scenario: Client Keychain Storage

### 1. Scope / Trigger

- Trigger: activation token storage, API key storage, secret existence checks, or Electron safeStorage changes.
- Applies to: `packages/client/src/main/lib/keychain.ts`, `packages/client/src/main/onboarding.ts`, and preload API types.

### 2. Contracts

- `setSecret`, `getSecret`, `deleteSecret`, and `hasSecret` live in the main process only.
- Secrets are persisted in `app.getPath('userData')/secrets.json`.
- Encrypted values are base64 encoded and prefixed with `safe:`.
- If `safeStorage.isEncryptionAvailable()` is false, plain base64 fallback is allowed only outside production and must warn.
- Production must throw if safeStorage encryption is unavailable.
- Renderer may set secrets indirectly via business IPC such as onboarding save, and may check existence through `keychain:has`.
- Renderer must never have a `keychain:get` IPC or any API returning plaintext secrets.

### 3. Tests Required

- `pnpm -F @tengyu-aipod/client test`
- `pnpm -F @tengyu-aipod/client lint`
- `pnpm -F @tengyu-aipod/client type-check`
- `pnpm -F @tengyu-aipod/client build`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`

---

## Scenario: Client Activation Status Badge

### 1. Scope / Trigger

- Trigger: activation badge UI, `/api/status` polling, local activation cache, offline grace, clock rollback checks, or renderer activation status store.
- Applies to: `packages/client/src/main/lib/activation-state.ts`, `packages/client/src/main/lib/activation-poller.ts`, `packages/client/src/preload/index.ts`, and renderer activation UI/store.

### 2. Signatures

- `window.api.activation.getStatus(): Promise<ActivationBadgeState>`
- `window.api.activation.syncStatus(): Promise<ActivationBadgeState>`
- `window.api.activation.onStatusChanged(callback): () => void`
- `activationPoller.poll(): Promise<ActivationBadgeState>`
- `requireActiveAndRecent(): Promise<{ ok: boolean; status: ActivationBadgeState }>`

### 3. Contracts

- `activation_token` remains in keychain; renderer never receives token plaintext.
- `app.getPath('userData')/activation-state.json` stores onboarding completion plus non-secret activation cache:
  - `completed_at`
  - `activation.cached_status_json`
  - `activation.last_server_check`
  - `activation.token_code_suffix`
  - optional local block reason/message
- Main process polls `${TENGYU_SERVER_URL ?? 'http://localhost:3000'}/api/status` every 30 minutes and broadcasts `activation:status-changed`.
- Renderer badge state must flow through Zustand and preload IPC only.
- Badge must be visible in the main workbench and onboarding surfaces without covering primary content.
- Future critical operations must call `requireActiveAndRecent()` before running.

### 4. Validation & Error Matrix

- `401` from `/api/status` -> block locally with `unauthorized` and show "激活已失效，请重新激活".
- Network failure or 5xx -> keep cached status and do not update `last_server_check`.
- Local time earlier than `last_server_check` -> block with `clock-rolled-back`.
- `now - last_server_check > 7 days` -> block with `offline-too-long`.
- Cached status `expired` or `days_remaining <= 0` -> red expired badge.
- Cached status `banned` -> red banned badge.
- Active customer code with `days_remaining < 7` -> yellow expiring badge.
- Active anonymous code (`customer === null`) -> green trial badge.

### 5. Good/Base/Bad Cases

- Good: successful status poll updates cached JSON, `last_server_check`, badge label, and renderer store.
- Base: startup without network uses existing cache while within the 7-day window.
- Bad: renderer exposes `activation_token`, calls `/api/status` directly, or computes security block decisions by itself.

### 6. Tests Required

- Unit test badge state derivation for active, expiring, unauthorized, clock rollback, offline-too-long, and token suffix parsing.
- `pnpm -F @tengyu-aipod/client test`
- `pnpm -F @tengyu-aipod/client lint`
- `pnpm -F @tengyu-aipod/client type-check`
- `pnpm -F @tengyu-aipod/client build`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`

### 7. Wrong vs Correct

#### Wrong

```ts
const token = await window.api.keychain.get('activation_token')
await fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } })
```

#### Correct

```ts
const status = await window.api.activation.syncStatus()
useActivationStore.getState().setStatus(status)
```

---

## Scenario: Client Grsai Extract UI

### 1. Scope / Trigger

- Trigger: generation extract tab, Grsai extract IPC, source image selection from the workbench, or artifact writes for extract outputs.
- Applies to: `packages/client/src/main/lib/generation-service.ts`, `packages/client/src/preload/index.ts`, `packages/client/src/renderer/src/components/generation-workbench.tsx`, and renderer preload types.

### 2. Signatures

- `window.api.generation.listExtractSources(): Promise<{ folder: string; images: GenerationImageSource[] }>`
- `window.api.generation.runExtract(input: ExtractRunInput): Promise<string>`
- `ExtractRunInput.sourceImagePaths: string[]`
- `ExtractRunInput.skillId: string`
- `ExtractRunInput.promptCount: number`
- `ExtractRunInput.variables?: Record<string, unknown>`
- `GenerationProgress.capability` includes `'extract'`.

### 3. Contracts

- Extract sources must be read from `{workbench_root}/01-采集` only.
- Renderer must list only `module=generation&category=extract` skills for the extract tab.
- The main process passes the selected source image to `prompt-generator-service` as a vision reference image.
- Each generated prompt is sent to `GrsaiAdapter.generate({ capability: 'extract', reference_images: [...] })`.
- Successful outputs are written to `{workbench_root}/02-生图/03-提取/{printId}.png`.
- `artifacts` rows for extract outputs must set `step='extract'`, `provider='grsai'`, `source_artifact_ids` to a JSON array containing the source artifact id, and `prompt_snapshot` to the prompt sent to Grsai.

### 4. Validation & Error Matrix

- Missing `workbench_root` -> Chinese renderer-safe setup error.
- Empty `sourceImagePaths` -> "please select source image" error before launching work.
- Source image outside `01-采集` -> reject in the main process, not only in the UI.
- Missing `skillId` -> reject before prompt generation.
- Missing Grsai key -> reject before prompt generation or image generation.
- Grsai failed/empty result -> record a failed prompt and continue other prompts.

### 5. Good/Base/Bad Cases

- Good: one source image generates one prompt, calls Grsai with the source as `reference_images`, saves a PNG, and writes source plus extract artifact rows.
- Base: no collection images returns an empty list and the UI keeps the extract action disabled by validation.
- Bad: accepting arbitrary local image paths from renderer or writing extract outputs without `source_artifact_ids`.

### 6. Tests Required

- Unit test source scanning with nested `01-采集` image folders.
- Unit test extract orchestration with fake DB, fake prompt generator, fake Grsai adapter, and real filesystem output.
- Run `pnpm -F @tengyu-aipod/client test`, `type-check`, `lint`, and `build`, plus root `pnpm test`, `type-check`, and `lint`.

### 7. Wrong vs Correct

#### Wrong

```ts
await window.api.generation.runExtract({ sourceImagePaths: ['/tmp/random.png'], skillId })
```

#### Correct

```ts
const sources = await window.api.generation.listExtractSources()
await window.api.generation.runExtract({
  sourceImagePaths: sources.images.filter((image) => selected.has(image.path)).map((image) => image.path),
  skillId,
  promptCount: 1,
})
```

## Scenario: Client ComfyUI Txt2img UI

### 1. Scope / Trigger

- Trigger: generation txt2img tab, ComfyUI txt2img workflow selection, renderer IPC types, or text-to-image artifact writes.
- Applies to: `packages/client/src/main/lib/generation-service.ts`, `packages/client/src/preload/index.ts`, `packages/client/src/renderer/src/components/generation-workbench.tsx`, renderer preload types, and ComfyUI workflow cache usage.

### 2. Signatures

- `window.api.generation.listComfyuiTxt2imgWorkflows(): Promise<ComfyuiWorkflowSummary[]>`
- `window.api.generation.runComfyuiTxt2img(input: ComfyuiTxt2imgRunInput): Promise<string>`
- `ComfyuiTxt2imgRunInput.prompts: string[]`
- `ComfyuiTxt2imgRunInput.workflowId: string`
- `ComfyuiTxt2imgRunInput.workflowVersion?: string`
- `ComfyuiTxt2imgRunInput.width?: number`
- `ComfyuiTxt2imgRunInput.height?: number`
- `ComfyuiTxt2imgRunInput.concurrency?: number`
- `GenerationProgress.capability` is `txt2img`.

### 3. Contracts

- Txt2img ComfyUI workflows are loaded from workflow cache category `txt2img` and filtered to `capability === 'txt2img'`.
- Renderer must parse manual prompt text before launching and must not send reference images for txt2img.
- Main process validates non-empty prompts, workflow id, Chenyu API key, and running ComfyUI instance before execution.
- Workflow execution calls `ComfyuiChenyuAdapter.generate({ capability: 'txt2img', prompt, workflow_id, output.size_px, options })`.
- Successful outputs are written under `{workbench_root}/02-生图/01-文生图/`.
- `artifacts` rows for txt2img ComfyUI outputs must set `step='txt2img'`, `provider='comfyui-chenyu'`, and `model_or_workflow` to the workflow id.
- Width and height are clamped to 256-4096 px; concurrency is clamped to 1-10.

### 4. Validation & Error Matrix

- Empty prompt list -> Chinese renderer-safe "prepare at least one prompt" error.
- Missing workflow id -> "select ComfyUI txt2img workflow" error before queueing work.
- Missing Chenyu key -> `HTTP_4XX`, non-retryable, provider `comfyui-chenyu`.
- No running ComfyUI instance -> `CHENYU_INSTANCE_DOWN`, non-retryable.
- ComfyUI transport failure -> propagated from `ComfyHttpClient` / `ComfyuiChenyuAdapter`.
- Per-prompt generation failure -> record a failed prompt and continue other prompts.

### 5. Good/Base/Bad Cases

- Good: two manual prompts select one txt2img workflow, queue two ComfyUI runs, save PNG files to `01-文生图`, emit progress, and register artifacts.
- Base: no txt2img workflows returns an empty list and the UI keeps execution blocked by workflow validation.
- Bad: sending arbitrary reference images to txt2img, accepting an unfiltered non-txt2img workflow, or writing outputs without artifact registration.

### 6. Tests Required

- Unit test workflow listing filters category/capability to txt2img only.
- Unit test `runComfyuiTxt2imgBatch` with fake workflow cache, fake adapter, fake DB, and real filesystem output.
- Assert no reference images are uploaded for txt2img.
- Assert outputs land under `02-生图/01-文生图` and artifacts use provider `comfyui-chenyu`.
- Run `pnpm -F @tengyu-aipod/client test`, `type-check`, and `lint`.

### 7. Wrong vs Correct

#### Wrong

```ts
await window.api.generation.runComfyuiTxt2img({
  prompts,
  workflowId: img2imgWorkflow.id,
})
```

#### Correct

```ts
const workflows = await window.api.generation.listComfyuiTxt2imgWorkflows()
const workflow = workflows.find((item) => item.id === selectedWorkflowId)
await window.api.generation.runComfyuiTxt2img({
  prompts,
  workflowId: workflow.id,
  workflowVersion: workflow.version,
  width: 1024,
  height: 1024,
  concurrency: 1,
})
```
