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
