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

## Error Types

<!-- Custom error classes/types -->

(To be filled by the team)

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
