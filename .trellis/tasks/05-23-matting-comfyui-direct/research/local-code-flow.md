# Matting ComfyUI Direct Research

## Scope

- Task: `.trellis/tasks/05-23-matting-comfyui-direct`.
- Goal: expose direct ComfyUI matting in the generation workbench without implementing the later mixed mask path.

## Relevant Existing Code

- `packages/client/src/renderer/src/components/generation-workbench.tsx` already has ComfyUI panels for img2img and extract that provide source selection, workflow selection, execution, and progress.
- `packages/client/src/main/lib/generation-service.ts` already lists eligible print sources for img2img from `02-生图` and registered external/manual imports.
- `packages/client/src/main/lib/comfyui-chenyu-adapter.ts` already maps `capability='matting'` to `02-生图/04-抠图`.
- `packages/client/src/main/lib/comfyui-workflow-cache.ts` already lists and gets cached ComfyUI workflows by category.

## Contracts To Preserve

- Matting input is a print image from `02-生图` or an external/manual imported artifact, not a raw `01-采集` image.
- Workflow list must only expose `capability/category=matting`.
- Direct matting runs one selected print through the selected ComfyUI workflow and outputs a transparent PNG.
- Output should land at `02-生图/04-抠图/{印花ID}.png`.
- DB artifact rows must use `step='matting'`, `provider='comfyui-chenyu'`, and source lineage.
- Progress is by selected image count.

## Minimal Implementation Plan

1. Extend `generation-service.ts` with `listComfyuiMattingWorkflows`, `runComfyuiMatting`, and `runComfyuiMattingBatch`.
2. Reuse `listImg2imgSources` / artifact-based source validation for matting inputs.
3. Adjust `ComfyuiChenyuAdapter` to allow matting output file names based on `printId` without `_v` suffix.
4. Add `ComfyuiMattingPanel` to the matting tab.
5. Add preload/global types and focused unit tests for workflow filtering, source validation, output naming, and missing instance error.
