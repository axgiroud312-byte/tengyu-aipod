# PS module E2E verification

Date: 2026-05-25
Branch: `ps-smart`

## Environment

- OS: Windows local development machine
- Photoshop COM: real local COM via PowerShell bridge, not mock COM
- Observed Photoshop version in prior task evidence: 27.7.0
- `REAL_PS=1`
- `REAL_PS_MUTATE=1` for write-output tests
- `PS_MATERIAL_ROOT=C:\Users\niilo\Desktop\印花素材`
- `PS_OUTPUT_ROOT=C:\Users\niilo\Desktop\新建文件夹`

## Available local fixtures

PSD templates found on Desktop:

- `C:\Users\niilo\Desktop\钥匙扣x.psd`
- `C:\Users\niilo\Desktop\mao 杯子.psd`

Printable image files found under material root:

- `C:\Users\niilo\Desktop\印花素材\00c9d983376c02a38c265f0d12147bda.jpg`
- `C:\Users\niilo\Desktop\印花素材\画板 3.png`
- `C:\Users\niilo\Desktop\印花素材\画板 5.png`

The PRD asks for 3 PSD fixtures and 5 prints. This local machine currently has 2 PSD templates and 3 image materials, so the full manual fixture matrix was not available.

Fixture inventory was rechecked with:

```powershell
Get-ChildItem -LiteralPath 'C:\Users\niilo\Desktop' -File -Include '*.psd'
Get-ChildItem -Recurse -LiteralPath 'C:\Users\niilo\Desktop\印花素材' -File -Include '*.png','*.jpg','*.jpeg','*.webp'
```

## Commands run

```powershell
$env:REAL_PS='1'
$env:REAL_PS_MUTATE='1'
$env:PS_MATERIAL_ROOT='C:\Users\niilo\Desktop\印花素材'
$env:PS_OUTPUT_ROOT='C:\Users\niilo\Desktop\新建文件夹'
pnpm -F @tengyu-aipod/client test -- src/main/photoshop/execution-engine.test.ts src/main/photoshop/multi-batch.test.ts src/main/photoshop/psd-scanner.test.ts
```

Result: passed. The run covered:

- Real PSD scan through Photoshop COM for both configured PSD templates.
- Real path A smart-object replacement and JPG export.
- Real small multi-batch execution using one PSD template and one material image.

Latest output evidence observed:

- `C:\Users\niilo\Desktop\新建文件夹\__codex_real_ps_multi_batch_1779698784339`
- `C:\Users\niilo\Desktop\新建文件夹\__codex_real_ps_execution_engine`

Full task quality gate was also run and passed:

- `pnpm -F @tengyu-aipod/client build`
- `pnpm -F @tengyu-aipod/client test`
- `pnpm -F @tengyu-aipod/client type-check`
- `pnpm -F @tengyu-aipod/client lint`
- `pnpm test`
- `pnpm type-check`
- `pnpm lint`
- `git diff --check`

## Acceptance status

- Prepared local fixture inventory: partial, blocked by available fixture count.
- Manual UI flow with 3 PSD + 5 prints: not fully run because only 2 PSD and 3 prints are present.
- Output batch directory generation: verified by automated real COM tests for a small batch.
- Nested SO UI warning: not verified; no dedicated nested fixture was available.
- Skip completed rerun: unit-tested in `execution-engine.test.ts`; full real rerun matrix not completed due fixture shortage.

## Notes

Photoshop was not automatically quit. Output writes used timestamped evidence directories and did not overwrite known prior evidence directories.
