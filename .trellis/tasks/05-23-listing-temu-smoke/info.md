# listing-temu-smoke verification

## Scope

- Target profile: Bit Browser `2-1111`
- Real pages:
  - Temu clothing: `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515`
  - Temu general: `https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551`
- Material roots:
  - `/Users/macmini/Desktop/服装素材摆放举例` excluding `GzG00010`
  - `/Users/macmini/Desktop/素材文件夹`

## Commands

Default CI/local test run skips the real browser smoke:

```bash
pnpm -F @tengyu-aipod/client e2e --grep "temu smoke"
```

Real read-only smoke:

```bash
REAL_LISTING=1 pnpm -F @tengyu-aipod/client e2e --grep "temu smoke"
```

Real mutating smoke for image upload, SKU generation, and video upload:

```bash
REAL_LISTING=1 REAL_LISTING_MUTATE=1 pnpm -F @tengyu-aipod/client e2e --grep "temu smoke"
```

## Notes

- The smoke uses `bitBrowserClient.listProfiles()` to find `2-1111`, then `openProfile()` + `chromium.connectOverCDP(endpoint.http)`.
- It does not create a new profile and does not mock CDP.
- Evidence is written under `.trellis/tasks/05-23-listing-temu-smoke/evidence/`.
- As of 2026-05-25, the three Slice 8 material roots contain real images but no `.mp4`, `.mov`, or `.webm` files. `REAL_LISTING_MUTATE=1` video upload cannot pass honestly until video files are added.
