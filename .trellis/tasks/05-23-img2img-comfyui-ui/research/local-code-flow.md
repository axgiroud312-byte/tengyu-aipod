# Img2img ComfyUI UI Research

## Scope

- Task: `.trellis/tasks/05-23-img2img-comfyui-ui`.
- Goal: expose ComfyUI img2img in the generation workbench without rewriting existing Grsai generation flows.

## Relevant Existing Code

- `packages/client/src/renderer/src/components/generation-workbench.tsx` already owns generation tabs and has `GrsaiExtractPanel`; ComfyUI img2img is currently a placeholder through `capabilityCopy()`.
- `packages/client/src/preload/index.ts` exposes `window.api.generation` IPC helpers; `packages/client/src/renderer/src/vite-env.d.ts` mirrors those types.
- `packages/client/src/main/lib/generation-service.ts` owns generation IPC, source scanning, Grsai extraction, output writes, and `artifacts` registration.
- `packages/client/src/main/lib/comfyui-chenyu-adapter.ts` already implements `ImageGenerationAdapter` for ComfyUI: instance guard, workflow cache lookup, upload, queue, history, view, output persistence, and artifact registration.
- `packages/client/src/main/lib/skill-cache.ts` is the closest pattern for server-backed list/get cache. No dedicated ComfyUI workflow cache/list/get service was found yet.

## Contracts To Preserve

- Input for img2img must be print artifacts, not raw `01-采集` collection images.
- Accept eligible print images from `02-生图/01-文生图`, `02-生图/03-提取`, and external/manual imports registered in `artifacts`; reject raw collection paths in main-process validation.
- Workflow list must only expose `category=img2img` / `capability=img2img` workflows for this UI.
- Running img2img should call `ComfyuiChenyuAdapter.generate({ capability: "img2img", workflow_id, reference_images: [...] })` and pass `options.sourceArtifactIds` so DB rows record lineage.
- Output should be persisted by the adapter under `02-生图/02-图生图`; the service may need to pass a stable `taskId` and source artifact id.

## Minimal Implementation Plan

1. Add a small ComfyUI workflow cache/list/get helper, modelled after `skill-cache`, using shared `ComfyuiWorkflow` types and server endpoints from `API_PATHS.comfyuiWorkflows`.
2. Extend `generation-service.ts` with `listImg2imgSources`, `listComfyuiWorkflows`, and `runComfyuiImg2img` IPC handlers.
3. Reuse `ComfyuiChenyuAdapter` instead of implementing ComfyUI HTTP logic in the service.
4. Add `ComfyuiImg2imgPanel` to `generation-workbench.tsx`; keep Grsai panels untouched except shared helper reuse.
5. Add focused tests in `generation-service.test.ts` for source filtering, raw collection rejection, img2img workflow category filtering, and artifact lineage handoff to the adapter.
