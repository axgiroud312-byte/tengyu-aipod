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
