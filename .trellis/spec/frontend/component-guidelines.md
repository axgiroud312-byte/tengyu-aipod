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
