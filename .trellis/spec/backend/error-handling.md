# Error Handling

> How errors are handled in this project.

---

## Scenario: Admin Login and JWT Protection

### 1. Scope / Trigger

- Trigger: admin login, logout, JWT signing/verification, or `/admin/*` middleware changes.
- Applies to: `packages/server/src/app/admin/**`, `packages/server/src/lib/jwt.ts`, and `packages/server/src/middleware.ts`.

### 2. Signatures

- `POST /admin/api/login`
  - Request: `{ email: string; password: string }`
  - Success: `{ ok: true, admin: { name: string; role: string } }`
  - Cookie: `admin_token`, `httpOnly`, `sameSite=lax`, `path=/`, max age 7 days
- `POST /admin/api/logout`
  - Success: `{ ok: true }`
  - Clears `admin_token`
- `signAdminJwt(payload: { sub: string; role: string }): Promise<string>`
- `verifyAdminJwt(token: string | null | undefined): Promise<AdminJwtPayload | null>`
- `packages/server/prisma/seed.ts`
  - Env: `ADMIN_INITIAL_EMAIL`, `ADMIN_INITIAL_PASSWORD`

### 3. Contracts

- Admin JWT payload must include `sub`, `role`, `iss`, `iat`, and `exp`.
- `iss` must be `tengyu-pod-admin`.
- `JWT_SECRET_ADMIN` is required for signing and verifying.
- Password hashes use bcrypt cost 12.
- Login errors must not reveal whether email or password was wrong.
- `/admin/login`, `/admin/api/login`, and `/admin/api/logout` are public admin paths; all other `/admin/*` paths require a valid `admin_token`.

### 4. Validation & Error Matrix

- Invalid JSON or bad email/password shape -> HTTP 400 with `INVALID_LOGIN_INPUT`.
- Missing admin, inactive admin, or bad password -> HTTP 401 with `INVALID_CREDENTIALS`.
- Missing/invalid/expired admin cookie on protected admin route -> redirect to `/admin/login`.
- Missing `JWT_SECRET_ADMIN` -> fail fast; do not sign unverifiable tokens.
- Missing seed env vars -> seed exits non-zero before writing an admin row.

### 5. Good/Base/Bad Cases

- Good: seed an initial admin with env vars, login through `/admin/api/login`, then access `/admin` with the returned cookie.
- Base: direct `/admin` request without cookie redirects to `/admin/login`.
- Bad: requiring a valid admin cookie for logout; this prevents clearing a bad or expired local cookie.

### 6. Tests Required

- `pnpm -F @tengyu-aipod/server type-check`
- `pnpm -F @tengyu-aipod/server lint`
- `pnpm -F @tengyu-aipod/server build`
- Manual route checks:
  - `GET /admin` without cookie returns a redirect.
  - `GET /admin/login` returns 200.
  - `POST /admin/api/login` with seeded credentials returns `{ ok: true }` and sets `admin_token`.
  - `GET /admin` with the cookie returns 200.
  - `POST /admin/api/logout` clears `admin_token`.

### 7. Wrong vs Correct

#### Wrong

```ts
const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/admin/api/login'])
```

#### Correct

```ts
const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/admin/api/login', '/admin/api/logout'])
```

---

## Scenario: Admin Activation Code Management

### 1. Scope / Trigger

- Trigger: `/admin/codes` UI, activation-code admin APIs, code generation, device unbinding, or customer linking.
- Applies to: `packages/server/src/app/admin/api/codes/**`, `packages/server/src/app/admin/codes/**`, and `packages/server/src/lib/codes.ts`.

### 2. Signatures

- `generateCode(): string`
  - Format: `POD-XXXX-YYYY-ZZZZ`
  - Character set: uppercase letters and digits excluding ambiguous characters (`O`, `0`, `1`, `l`).
- `generateUniqueCode(): Promise<string>`
  - Checks `activation_codes.code` before returning.
- `GET /admin/api/codes`
  - Query: `search?`, `status?`, `batch?`, `sort?`, `page?`, `page_size?`
  - Default page size: 50
  - Response: `{ ok: true, data: { items, pagination, batches, server_time } }`
- `POST /admin/api/codes`
  - Modes: `single`, `batch_anonymous`, `batch_customers`
  - Success: `{ ok: true, data: { batch_id, codes, csv } }`
- `PATCH /admin/api/codes/:code`
  - Body: `{ add_days?, max_devices?, is_active? }`
- `POST /admin/api/codes/:code/unbind-device`
  - Body: `{ device_id }`
- `POST /admin/api/codes/:code/link-customer`
  - Body: `{ customer_id }` or `{ customer: { name, phone, email?, wechat?, notes? } }`

### 3. Contracts

- Single-code creation may reuse an existing customer by phone.
- Batch anonymous creation must write a UUID `batch_id`.
- Batch customer creation upserts customers by phone and returns CSV content for download.
- Nullable Prisma fields must receive `null`, not `undefined`, because TypeScript uses `exactOptionalPropertyTypes`.
- Device count cannot be reduced below current activated device count; callers must unbind devices first.
- Banned codes are represented by `ActivationCode.is_active = false`.
- Remaining days are derived from `expires_at`; unactivated codes may have `remaining_days = null`.

### 4. Validation & Error Matrix

- Invalid create payload -> HTTP 400 with `INVALID_CODE_INPUT`.
- Invalid patch payload -> HTTP 400 with `INVALID_CODE_UPDATE`.
- Unknown activation code -> HTTP 404 with `CODE_NOT_FOUND`.
- New max device count below active device count -> HTTP 400 with `DEVICE_LIMIT_BELOW_ACTIVE_DEVICES`.
- Invalid unbind payload -> HTTP 400 with `INVALID_DEVICE_UNBIND`.
- Unknown device -> HTTP 404 with `DEVICE_NOT_FOUND`.
- Invalid customer link payload -> HTTP 400 with `INVALID_CUSTOMER_LINK`.
- Unknown existing customer id -> HTTP 404 with `CUSTOMER_NOT_FOUND`.

### 5. Good/Base/Bad Cases

- Good: create a single bound code, list by customer phone, add days, then verify the response reflects `remaining_days`.
- Good: create a batch anonymous set and confirm all rows share one `batch_id`.
- Good: create a batch customer set from parsed CSV rows and download the returned CSV.
- Base: `/admin/codes` loads with no records and still shows filters, create controls, and pagination.
- Bad: silently lowering `max_devices` below `used_devices`; the UI must force device unbinding first.

### 6. Tests Required

- `pnpm -F @tengyu-aipod/server build`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`
- Manual route checks with an admin cookie:
  - `POST /admin/api/codes` for `single`, `batch_anonymous`, and `batch_customers`.
  - `GET /admin/api/codes` with search, status filter, batch filter, sort, and pagination.
  - `PATCH /admin/api/codes/:code` for day extension, device count, and ban.
  - `POST /admin/api/codes/:code/link-customer` for anonymous code linking.
  - `POST /admin/api/codes/:code/unbind-device` after creating a test `DeviceActivation`.

### 7. Wrong vs Correct

#### Wrong

```ts
data: { email: input.email, notes: input.notes }
```

#### Correct

```ts
data: {
  email: input.email?.trim() || null,
  notes: input.notes?.trim() || null,
}
```

---

## Scenario: Admin Customer Management

### 1. Scope / Trigger

- Trigger: `/admin/customers` UI, `/admin/customers/:id` UI, customer admin APIs, customer editing, or customer banning.
- Applies to: `packages/server/src/app/admin/api/customers/**`, `packages/server/src/app/admin/customers/**`, and `packages/server/src/lib/customers.ts`.

### 2. Signatures

- `GET /admin/api/customers`
  - Query: `search?`, `sort?`
  - Response: `{ ok: true, data: { items, server_time } }`
- `GET /admin/api/customers/:id`
  - Response: `{ ok: true, data: { customer, server_time } }`
- `PATCH /admin/api/customers/:id`
  - Body: `{ name?, phone?, email?, wechat?, notes? }`
- `POST /admin/api/customers/:id/ban`
  - Success: `{ ok: true, data: { customer_id, affected_codes } }`

### 3. Contracts

- Customer list search matches `name`, `phone`, and `wechat`.
- Customer list summaries include code count, max remaining days, current devices / total slots, latest device activity, active/banned status, and created time.
- Customer detail includes the same summary plus all activation codes and all devices under those codes.
- Customer banning must set `Customer.is_active = false` and set all of that customer's `ActivationCode.is_active = false`.
- Nullable customer fields must receive `null`, not `undefined`, because TypeScript uses `exactOptionalPropertyTypes`.
- `/admin/codes/new` is a compatibility redirect to `/admin/codes` with prefilled single-customer query parameters.

### 4. Validation & Error Matrix

- Invalid customer update payload -> HTTP 400 with `INVALID_CUSTOMER_UPDATE`.
- Unknown customer -> HTTP 404 with `CUSTOMER_NOT_FOUND`.
- Updating phone to an existing customer's phone -> HTTP 409 with `CUSTOMER_PHONE_TAKEN`.

### 5. Good/Base/Bad Cases

- Good: create a customer-bound activation code, then find that customer through `/admin/api/customers?search=<phone>`.
- Good: customer detail returns the customer's codes and devices, and device unbind through the code API is reflected in the customer detail response.
- Good: customer ban returns `affected_codes` and all customer codes become banned.
- Base: customer with no devices has `recent_active_at = null` and displays `-`.
- Bad: banning only the customer row while leaving their activation codes usable.

### 6. Tests Required

- `pnpm -F @tengyu-aipod/server lint`
- `pnpm -F @tengyu-aipod/server type-check`
- `pnpm -F @tengyu-aipod/server build`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`
- Manual route checks with an admin cookie:
  - `GET /admin/api/customers` with search and sort.
  - `GET /admin/api/customers/:id`.
  - `PATCH /admin/api/customers/:id`.
  - `POST /admin/api/customers/:id/ban`.
  - `POST /admin/api/codes/:code/unbind-device` and confirm customer detail updates.

### 7. Wrong vs Correct

#### Wrong

```ts
await db.customer.update({
  where: { id },
  data: { is_active: false },
})
```

#### Correct

```ts
await db.$transaction(async (tx) => {
  await tx.customer.update({ where: { id }, data: { is_active: false } })
  await tx.activationCode.updateMany({
    where: { customer_id: id },
    data: { is_active: false },
  })
})
```

---

## Scenario: Client Activation API

### 1. Scope / Trigger

- Trigger: `/api/activate`, client JWT signing/verification, activation-code expiry checks, or device binding rules.
- Applies to: `packages/server/src/app/api/activate/**`, `packages/server/src/lib/activate.ts`, and `packages/server/src/lib/jwt.ts`.

### 2. Signatures

- `POST /api/activate`
  - Body: `{ code: string, device_fingerprint: string, device_name?: string }`
  - Success: `{ ok: true, data: { activation_token, expires_at, max_devices, used_devices, device_name } }`
- `signClientJwt(payload: { sub, code, device_fp, exp }): Promise<string>`
- `verifyClientJwt(token): Promise<ClientJwtPayload | null>`

### 3. Contracts

- Activation code format is `POD-XXXX-YYYY-ZZZZ`.
- Device fingerprints are 64-character strings.
- First activation sets `ActivationCode.activated_at` and `ActivationCode.expires_at`.
- Existing same-code devices may re-activate and update `device_name` plus `last_active_at`.
- A device fingerprint already bound to another code must be rejected.
- New devices cannot exceed `ActivationCode.max_devices`.
- Client JWT payload must include `sub`, `code`, `device_fp`, `iss`, `iat`, and `exp`.
- Client JWT issuer is `tengyu-pod-server`, signed with `JWT_SECRET_CLIENT`.
- `/api/activate` rate limits by request IP at 10 attempts per minute.

### 4. Validation & Error Matrix

- Invalid JSON or payload shape -> HTTP 400 with `INVALID_INPUT`.
- Unknown code -> HTTP 404 with `INVALID_CODE`.
- Banned code -> HTTP 403 with `CODE_BANNED`.
- Banned customer -> HTTP 403 with `CUSTOMER_BANNED`.
- Expired activated code -> HTTP 403 with `CODE_EXPIRED`.
- Device fingerprint already bound to another code -> HTTP 403 with `ALREADY_ACTIVATED_BY_OTHER`.
- Device count exceeded -> HTTP 403 with `DEVICE_LIMIT_REACHED`.
- Rate limit exceeded -> HTTP 429 with `RATE_LIMITED`.
- Unexpected database/runtime error -> HTTP 500 with `INTERNAL_ERROR`; do not expose internals.

### 5. Good/Base/Bad Cases

- Good: first activation creates a `DeviceActivation`, sets code dates, and returns a client JWT.
- Good: reactivating the same device/code returns success and does not consume another device slot.
- Good: adding a second device succeeds when `used_devices < max_devices`.
- Bad: accepting a valid-looking code for an inactive customer.
- Bad: signing client tokens with the admin JWT issuer or secret.

### 6. Tests Required

- `pnpm -F @tengyu-aipod/server test`
- `pnpm -F @tengyu-aipod/server lint`
- `pnpm -F @tengyu-aipod/server type-check`
- `pnpm -F @tengyu-aipod/server build`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`
- Manual HTTP checks against local Docker Postgres:
  - Successful first activation.
  - Same-device reactivation.
  - Second-device activation within limit.
  - `DEVICE_LIMIT_REACHED`.
  - `ALREADY_ACTIVATED_BY_OTHER`.
  - `INVALID_CODE`, `CODE_BANNED`, `CUSTOMER_BANNED`, `CODE_EXPIRED`.

### 7. Wrong vs Correct

#### Wrong

```ts
await signAdminJwt({ sub: device.id, role: 'client' })
```

#### Correct

```ts
await signClientJwt({
  sub: device.id,
  code: activationCode.code,
  device_fp: input.device_fingerprint,
  exp,
})
```

---

## Scenario: Client Status API

### 1. Scope / Trigger

- Trigger: `/api/status`, client JWT verification, device unbind checks, or active/expired/banned status calculation.
- Applies to: `packages/server/src/app/api/status/**`, `packages/server/src/lib/status.ts`, and `packages/server/src/lib/jwt.ts`.

### 2. Signatures

- `GET /api/status`
  - Header: `Authorization: Bearer <activation_token>`
  - Success: `{ ok: true, data: { status, days_remaining, max_devices, used_devices, device_name, customer } }`
- `getActivationStatus(authorization: string | null): Promise<StatusResult>`

### 3. Contracts

- Missing Bearer token returns `UNAUTHORIZED`.
- Invalid/expired JWT returns `INVALID_TOKEN`.
- Missing `DeviceActivation`, code mismatch, or device fingerprint mismatch returns `DEVICE_UNBOUND`.
- Banned code or banned customer returns success with `status = 'banned'`, not a 401.
- Expired code returns success with `status = 'expired'`.
- Successful status checks update `DeviceActivation.last_active_at`.
- Customer payload may include customer name and `has_contact`, but must not expose phone, email, or wechat.
- `/api/status` rate limits by activation token at 60 requests per minute.

### 4. Validation & Error Matrix

- Missing bearer token -> HTTP 401 with `UNAUTHORIZED`.
- Invalid token -> HTTP 401 with `INVALID_TOKEN`.
- Unbound/tampered device token -> HTTP 401 with `DEVICE_UNBOUND`.
- Rate limit exceeded -> HTTP 429 with `RATE_LIMITED`.
- Unexpected database/runtime error -> HTTP 500 with `INTERNAL_ERROR`.

### 5. Good/Base/Bad Cases

- Good: active device returns `status = active`, current device count, and masked customer contact state.
- Good: deleting the device row after token issuance makes the same token return `DEVICE_UNBOUND`.
- Good: banning an activation code after token issuance makes status return `banned`.
- Good: an expired code with an existing device row returns `expired`.
- Bad: returning full customer phone/email/wechat to the client status endpoint.

### 6. Tests Required

- `pnpm -F @tengyu-aipod/server test`
- `pnpm -F @tengyu-aipod/server lint`
- `pnpm -F @tengyu-aipod/server type-check`
- `pnpm -F @tengyu-aipod/server build`
- `pnpm lint`
- `pnpm type-check`
- `pnpm test`
- Manual HTTP checks against local Docker Postgres:
  - Active status with a token from `/api/activate`.
  - Missing token -> `UNAUTHORIZED`.
  - Deleted device -> `DEVICE_UNBOUND`.
  - Banned code/customer -> `status = banned`.
  - Expired code -> `status = expired`.

### 7. Wrong vs Correct

#### Wrong

```ts
customer: device.code.customer
```

#### Correct

```ts
customer: device.code.customer
  ? { name: device.code.customer.name, has_contact: Boolean(...) }
  : null
```

---

## Scenario: Client Provider Registry API

### 1. Scope / Trigger

- Trigger: `/api/providers`, provider registry dispatch, paid generation provider metadata, vision LLM provider metadata, or ComfyUI cloud provider metadata.
- Applies to: `packages/server/src/app/api/providers/**` and `packages/server/src/lib/providers.ts`.

### 2. Signatures

- `GET /api/providers`
  - Header: `Authorization: Bearer <activation_token>`
  - Query: `type?: 'paid-generation' | 'vision-llm' | 'comfyui-cloud'`
  - Success: `{ ok: true, data: ProviderRegistryItem[] }`
- `ProviderRegistryItem` includes `id`, `name`, `type`, `base_url`, `fallback_url`, `api_style`, `endpoints`, `model_options`, `default_params`, `capabilities`, and `enabled`.

### 3. Contracts

- Client auth is required with the same development bypass behavior as `/api/skills`.
- Only `enabled = true` providers are returned.
- Query `type` filters by `Provider.type`; omitted `type` returns all enabled providers.
- Results are ordered by `sort_order ASC`, then `id ASC`.
- `endpoints_json` and `default_params_json` are parsed into objects; malformed or non-object JSON returns `{}`.
- `model_options_json` is parsed into `string[]`; malformed or non-array JSON returns `[]`.
- The response must never contain user API keys, server API keys, or keychain identifiers.

### 4. Validation & Error Matrix

- Missing/invalid bearer token -> HTTP 401 with the `ClientAuthError.code`.
- Invalid `type` query -> HTTP 400 with `INVALID_PROVIDER_QUERY`.
- Unexpected database/runtime error -> HTTP 500 with `INTERNAL_ERROR`.

### 5. Good/Base/Bad Cases

- Good: `GET /api/providers?type=paid-generation` returns enabled Grsai metadata sorted by `sort_order`.
- Base: a valid type with no enabled providers returns an empty array.
- Bad: returning disabled providers, raw JSON strings, or any API key field.

### 6. Tests Required

- Unit test serialization: JSON fields parse, malformed JSON falls back, and no secret fields are emitted.
- Unit test query shape: enabled/type filters and `sort_order` ordering are passed to Prisma.
- Route test: auth is required, valid `type` is forwarded, invalid `type` returns `INVALID_PROVIDER_QUERY`.
- Run `pnpm -F @tengyu-aipod/server test`, `type-check`, and `lint`, plus root `pnpm test`, `type-check`, and `lint`.

### 7. Wrong vs Correct

#### Wrong

```ts
return { ...provider, api_key: process.env.GRSAI_API_KEY }
```

#### Correct

```ts
return {
  id: provider.id,
  base_url: provider.base_url,
  endpoints: JSON.parse(provider.endpoints_json),
}
```

---

## Error Types

### Scenario: Client ComfyUI HTTP Adapter

#### 1. Scope / Trigger

- Trigger: native ComfyUI HTTP calls from the Electron main process.
- Applies to: `packages/client/src/main/lib/*comfy*` transport adapters.

#### 2. Signatures

- `new ComfyHttpClient(baseUrl, options?)`
- `uploadImage(buffer: Buffer, filename: string): Promise<string>`
- `queuePrompt(workflow: unknown): Promise<string>`
- `getHistory(promptId: string): Promise<ComfyHistoryEntry>`
- `viewImage(filename: string): Promise<Buffer>`

#### 3. Contracts

- `baseUrl` is the ComfyUI URL selected from Chenyu `server_map`.
- `POST /upload/image` uses multipart field `image` and returns the ComfyUI filename.
- `POST /prompt` sends `{ prompt: workflow }` and returns `prompt_id`.
- `GET /history/{prompt_id}` polls until `status.completed === true`.
- `GET /view?filename=...` returns image bytes as a Node `Buffer`.
- This adapter is transport-only. Workflow input injection, persistence, and Chenyu lifecycle stay in higher-level services.

#### 4. Validation & Error Matrix

- Request abort/timeout -> `NETWORK_TIMEOUT`, retryable, `details.kind = 'network'`.
- Network connection failure -> `NETWORK_OFFLINE`, retryable, `details.kind = 'network'`.
- HTTP 429 or queue-full/busy response -> `HTTP_429`, retryable.
- HTTP 5xx -> `HTTP_5XX`, retryable.
- Other HTTP 4xx -> `HTTP_4XX`, non-retryable.
- Missing `name` or `prompt_id`, empty JSON, or invalid JSON -> `HTTP_5XX`, retryable protocol failure.

#### 5. Good/Base/Bad Cases

- Good: upload source image, queue workflow, poll history, then download output bytes.
- Base: unfinished history keeps polling until the configured timeout.
- Bad: returning raw `ArrayBuffer` from `viewImage`, or throwing generic `Error` that cannot be classified by `GenerationConcurrencyController`.

#### 6. Tests Required

- Unit tests with MSW for upload, queue, history polling, view download, queue-full/429, 5xx, and history timeout.
- Run `pnpm -F @tengyu-aipod/client test`, `pnpm -F @tengyu-aipod/client type-check`, and `pnpm -F @tengyu-aipod/client lint`.

#### 7. Wrong vs Correct

##### Wrong

```ts
throw new Error('ComfyUI failed')
```

##### Correct

```ts
throw new AppErrorClass('HTTP_5XX', 'ComfyUI 服务暂时不可用', true, {
  kind: 'network',
  provider: 'comfyui-chenyu',
})
```

### Scenario: Client Chenyu Cloud Adapter

#### 1. Scope / Trigger

- Trigger: Chenyu Cloud open API calls from the Electron main process.
- Applies to: `packages/client/src/main/lib/*chenyu*` cloud resource adapters.

#### 2. Signatures

- `new ChenyuCloudClient(apiKey, options?)`
- `listPods(params?)`, `listGpus(params?)`, `listImages(params?)`
- `createByPod(input)`, `getInstanceInfo(instance_uuid)`, `listInstances(params?)`
- `startup(input)`, `shutdown(instance_uuid)`, `restart(instance_uuid)`, `destroy(instance_uuid)`
- `setShutdownTimer({ instance_uuid, enable, shutdown_time })`
- `getBalance()`

#### 3. Contracts

- Base URL defaults to `https://www.chenyu.cn/api/open/v2`.
- Every request sends `Authorization: Bearer <apiKey>`.
- JSON responses use the Chenyu envelope `{ code, msg, data }`.
- `code === 0` is success. Any non-zero business `code` throws `AppErrorClass`.
- Instance status values are stable: `1=initializing`, `2=running`, `21=shutting_down`, `22=stopped`.
- `shutdown_timer.shutdown_time` must be a Unix timestamp in seconds, matching `docs/spec/03-generation.md §9.2`.
- Do not call `set_idle_close` or Chenyu workflow/run APIs in v1.

#### 4. Validation & Error Matrix

- Request abort/timeout -> `NETWORK_TIMEOUT`, retryable, `details.kind = 'network'`.
- Network connection failure -> `NETWORK_OFFLINE`, retryable.
- HTTP 401/403 -> `HTTP_4XX`, non-retryable, user must update Chenyu API key.
- HTTP 429 -> `HTTP_429`, retryable; honor `Retry-After` when present.
- HTTP 5xx -> `HTTP_5XX`, retryable.
- Other HTTP 4xx -> `HTTP_4XX`, non-retryable.
- Non-zero Chenyu envelope code -> `HTTP_4XX` by default, with `details.chenyuCode` and `details.message`.

#### 5. Good/Base/Bad Cases

- Good: list Pod/GPU options, create an instance, set shutdown timer immediately, poll instance info until status `2`.
- Base: list endpoints return empty arrays when Chenyu omits list fields.
- Bad: treating HTTP 200 with `code !== 0` as success, or sending shutdown timer minutes instead of a timestamp.

#### 6. Tests Required

- Unit tests with MSW for auth/query params, resource lists, create/lifecycle methods, balance, non-zero envelope code, HTTP 429 retry, HTTP 401, HTTP 5xx, and status mapping.
- Run root `pnpm test`, `pnpm type-check`, and `pnpm lint`.

#### 7. Wrong vs Correct

##### Wrong

```ts
await chenyu.setShutdownTimer({ instance_uuid, enable: true, shutdown_time: 60 })
```

##### Correct

```ts
await chenyu.setShutdownTimer({
  instance_uuid,
  enable: true,
  shutdown_time: Math.floor(Date.now() / 1000) + autoShutdownMinutes * 60,
})
```

### Scenario: Client ComfyUI Instance Manager

#### 1. Scope / Trigger

- Trigger: ComfyUI instance lifecycle services in the Electron main process.
- Applies to: `packages/client/src/main/lib/*instance-manager*`.

#### 2. Signatures

- `new ComfyuiInstanceManager({ chenyu, ...dependencies })`
- `createInstance({ pod, gpu, podTag?, gpuNums?, autoShutdownMinutes? })`
- `getCurrentInstance()`, `refreshCurrentInstance()`
- `shutdownCurrentInstance()`, `restartCurrentInstance()`, `destroyCurrentInstance()`
- `extendShutdown(minutesFromNow)`
- `getBalance()`

#### 3. Contracts

- The manager stores one active row in `comfyui_instances` with `id = 1`.
- State names are `none`, `starting`, `running`, `shutting_down`, and `stopped`.
- `createInstance` calls Chenyu `createByPod`, then immediately calls `setShutdownTimer`.
- Default auto-shutdown is 60 minutes.
- `setShutdownTimer.shutdown_time` is always a Unix timestamp in seconds.
- ComfyUI URL is extracted from `server_map` where `port_type === "http"` and title contains `ComfyUI`.
- Cost estimate is elapsed runtime minutes multiplied by `(pod_price_hour + gpu_price_hour) / 60`.
- UI polling such as "balance every 60 seconds" stays outside the service; the service exposes `getBalance()`.

#### 4. Validation & Error Matrix

- Missing workbench root -> `HTTP_4XX`, non-retryable.
- No current instance when lifecycle action is requested -> `CHENYU_INSTANCE_DOWN`, non-retryable.
- Missing ComfyUI URL after instance creation -> `HTTP_5XX`, retryable.
- Chenyu API errors must propagate as `AppErrorClass` from `ChenyuCloudClient`; do not swallow or remap them to generic `Error`.

#### 5. Good/Base/Bad Cases

- Good: user selects Pod/GPU, manager creates the instance, sets shutdown timer, stores the row, and later refreshes status from Chenyu.
- Base: no stored row returns `null` from `getCurrentInstance`.
- Bad: allowing multiple active rows, or deleting the row before Chenyu destroy succeeds.

#### 6. Tests Required

- Unit tests for create order, shutdown timer timestamp, ComfyUI URL extraction, singleton row persistence, refresh/status mapping, lifecycle updates, balance delegation, and cost estimation.
- Run root `pnpm test`, `pnpm type-check`, and `pnpm lint`.

#### 7. Wrong vs Correct

##### Wrong

```ts
await chenyu.createByPod(input)
saveLocalState({ status: 'running' })
```

##### Correct

```ts
const instance = await chenyu.createByPod(input)
await chenyu.setShutdownTimer({ instance_uuid: instance.instance_uuid, enable: true, shutdown_time })
const latest = await chenyu.getInstanceInfo(instance.instance_uuid)
saveLocalState({ status: stateFromChenyuStatus(latest.status) })
```

### Scenario: Client ComfyUI Chenyu Execution Adapter

#### 1. Scope / Trigger

- Trigger: running Tengyu-dispatched ComfyUI workflows through a Chenyu-hosted ComfyUI instance.
- Applies to: `packages/client/src/main/lib/*comfyui-chenyu*` execution adapters.

#### 2. Signatures

- `new ComfyuiChenyuAdapter({ instanceManager, comfyHttp, workflowCache, workbenchRoot, openDatabase })`
- `generate(req: GenerateRequest): Promise<GenerateResponse>`
- `injectComfyuiInputs(workflowJson, slots, req, { uploadedImages })`
- `outputsFromHistory(history, outputSlots)`

#### 3. Contracts

- The adapter implements the existing `ImageGenerationAdapter` interface.
- Instance status must be `running` before workflow execution.
- Workflows are loaded by `(workflow_id, capability)` from a workflow cache.
- Reference images are uploaded through `ComfyHttpClient.uploadImage`.
- Workflow JSON is cloned before slot injection.
- Image slots use the uploaded ComfyUI filename; string slots use `req.prompt`; option values may override by slot name or field.
- Completed history outputs are read from `history.outputs[slot.nodeId].images[]`.
- Outputs are saved under `02-生图/{capability folder}` and registered in `artifacts` with `provider = "comfyui-chenyu"` and `model_or_workflow = workflow.id`.

#### 4. Validation & Error Matrix

- No running instance -> `CHENYU_INSTANCE_DOWN`, non-retryable.
- Missing `workflow_id` -> `HTTP_4XX`, non-retryable.
- Missing workflow input node -> `HTTP_4XX`, non-retryable.
- Required image slot without an uploaded reference image -> `HTTP_4XX`, non-retryable.
- Missing output images or missing output filename -> `HTTP_5XX`, retryable.
- ComfyUI transport errors propagate from `ComfyHttpClient`.

#### 5. Good/Base/Bad Cases

- Good: upload source, inject workflow slots, queue prompt, poll history, download outputs, save files, and insert artifacts.
- Base: option values override non-image slot values for workflow tuning.
- Bad: mutating cached workflow JSON directly, or returning generated files without artifact lineage.

#### 6. Tests Required

- Unit tests for instance guard, upload/injection/queue/history/download/artifact flow, option slot injection, and missing output validation.
- Run root `pnpm test`, `pnpm type-check`, and `pnpm lint`.

#### 7. Wrong vs Correct

##### Wrong

```ts
workflow[slot.nodeId].inputs[slot.field] = req.prompt
```

##### Correct

```ts
const cloned = structuredClone(workflow.workflowJson)
cloned[slot.nodeId].inputs[slot.field] = uploadedFilename
```

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

(To be filled by the team)

---

## API Error Responses

Use stable machine-readable `error.code` values and user-friendly Chinese `error.message` strings. Authentication failures should avoid leaking which credential field failed.

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

(To be filled by the team)
