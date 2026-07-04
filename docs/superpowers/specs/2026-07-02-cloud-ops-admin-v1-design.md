# Cloud Ops Admin v1 Design

## Goal

Build the first practical cloud operations Admin for Tengyu aipod. It should help the operator manage customer authorization and remotely control lightweight client configuration without turning the Server into a business-data or provider proxy.

## Scope

Included:

- Customer expiration center.
- Bulk customer authorization, renewal, disable, and enable.
- Announcement management.
- Client version management, including forced upgrades.
- Skill rollout by PHP uid allowlist.

Not included:

- Payment, plans, packages, or self-service renewal.
- Excel import.
- Customer groups.
- Percentage rollout.
- Module-level customer permissions.
- Any image, API Key, provider, task, SKU, or Workbench business-data storage.

## Current Context

The Server already has these foundations:

- `CustomerAccount` stores PHP uid authorization, status, expiration, notes, and login metadata.
- `Skill` stores versioned system prompts.
- `Announcement` and `ClientVersion` models exist but are not yet exposed through Admin pages and public client routes.
- Admin pages exist for administrators, customers, and Skill management.

The new work should stay within the Server boundary from ADR-0003 and spec/08: customer authorization, Skill, announcements, versions, health, and lightweight telemetry only.

## Module 1: Customer Expiration Center

### Page Behavior

Enhance `/admin` and `/admin/customers`.

Admin home should show cards for:

- Pending customers.
- Expired customers.
- Customers expiring today.
- Customers expiring within 7 days.
- Customers expiring within 30 days.
- Disabled customers.

The customer list should support filters:

- `all`
- `pending`
- `active`
- `expires_today`
- `expires_7d`
- `expires_30d`
- `expired`
- `disabled`

Default customer ordering should put urgent accounts first:

1. Expired.
2. Expires today.
3. Expires within 7 days.
4. Expires within 30 days.
5. Pending.
6. Other active accounts.
7. Disabled accounts.

### Customer Row Actions

Each customer row keeps existing single-customer actions:

- Approve pending customer.
- Set custom expiration date.
- Update notes.
- Disable.
- Enable.

Expiration date remains custom-date first. No package shortcut is required in v1.

## Module 2: Bulk Customer Operations

### Selection

`/admin/customers` should support row selection with a header select-all checkbox for currently loaded rows.

### Bulk Actions

Supported bulk actions:

- Approve selected pending customers with one custom expiration date and optional note append.
- Set expiration date for selected active or expired customers.
- Append the same note to selected customers.
- Disable selected customers.
- Enable selected disabled customers with one custom expiration date.

### API Design

Add an Admin-only endpoint:

```http
POST /admin/api/customer-accounts/bulk
```

Request:

```json
{
  "ids": ["cus_1", "cus_2"],
  "action": "approve",
  "expires_at": "2026-12-31T23:59:59.999Z",
  "note": "Renewed after WeChat confirmation"
}
```

Actions:

- `approve`
- `set_expires_at`
- `append_note`
- `disable`
- `enable`

Response:

```json
{
  "ok": true,
  "data": {
    "updated_count": 2,
    "skipped": []
  }
}
```

If some rows cannot be updated because of status or missing expiration date, return them in `skipped` with actionable reasons. Do not silently ignore failures.

## Module 3: Announcement Management

### Admin Page

Add `/admin/announcements`.

Fields:

- Title.
- Content.
- Level: `info`, `important`, `warning`.
- Start time.
- End time, optional.
- Target scope: `all` or `php_uid_list`.
- PHP uid allowlist, only used when target scope is `php_uid_list`.
- Enabled state.

### Public Client Route

Add:

```http
GET /api/announcements/active?uid=123
```

The route returns enabled announcements that are currently active and match the customer uid.

This route should not return disabled, future, expired, or non-matching allowlist announcements.

## Module 4: Client Version Management

### Admin Page

Add `/admin/versions`.

Fields:

- Version.
- Platform: `windows`, `macos`.
- Channel: `stable`, `beta`.
- Download URL.
- Changelog.
- Force upgrade.
- Target scope: `all` or `php_uid_list`.
- PHP uid allowlist, only used when target scope is `php_uid_list`.
- Published at.
- Enabled state.

### Public Client Route

Add:

```http
GET /api/client-version/check?current=1.0.0&platform=windows&uid=123&channel=stable
```

The route returns the latest enabled matching version for the platform, channel, and customer uid.

If `force_upgrade` is true and the client version is older than the returned version, the client should block entering Workbench until the user upgrades.

## Module 5: Skill Allowlist Rollout

### Data Model

Extend Skill with rollout targeting:

- `target_scope`: `all` or `php_uid_list`.
- `target_php_uids_json`: JSON array of PHP uid numbers.

Default: `target_scope = all`.

### Admin Page

Extend `/admin/skills` with:

- Target scope selector.
- PHP uid allowlist input when scope is `php_uid_list`.

### Public Client Routes

The client should include `uid` when requesting Skill list and details:

```http
GET /api/skills?module=generation&category=txt2img-local-print&uid=123
GET /api/skills/:id?version=1.0.0&uid=123
```

The Server returns only enabled Skill versions whose target scope matches the uid.

## Shared Target Matching Rule

Announcements, client versions, and Skill use the same targeting rule:

- `all`: visible to every authorized customer.
- `php_uid_list`: visible only when the requesting PHP uid is included in the allowlist.

The matching rule should live in one shared Server helper to keep behavior consistent.

## Authorization and Safety

Admin APIs remain protected by Admin JWT.

Public client configuration APIs should not leak targeted records to non-matching customers. When a uid is required for targeting, invalid or missing uid should only receive globally targeted records.

This design does not introduce client JWT yet. A follow-up hardening task should protect Skill and config routes with active customer authorization, because current public Skill routes rely mostly on client-side calling discipline.

## Testing

Add focused tests for:

- Customer expiration bucket calculation.
- Customer list filtering and urgent ordering.
- Bulk operation success and skipped-row reasons.
- Announcement target matching.
- Version target matching and latest-version selection.
- Skill target matching.
- Admin route validation for missing expiration date and malformed uid allowlists.

Run:

```bash
pnpm -F @tengyu-aipod/server test
pnpm -F @tengyu-aipod/server type-check
pnpm -F @tengyu-aipod/server lint
```

If the existing Biome CRLF/LF issue remains, report it separately from feature test results.

## Implementation Order

1. Customer expiration helpers and customer list filters.
2. Bulk customer operation endpoint and UI.
3. Announcement Admin page and active client route.
4. Version Admin page and check route.
5. Shared target matching helper.
6. Skill allowlist rollout.

This order delivers daily operational value first, then remote client control, then Skill gray release.
