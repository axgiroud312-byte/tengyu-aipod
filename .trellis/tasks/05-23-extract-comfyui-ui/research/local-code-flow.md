# Extract ComfyUI UI Research

## Scope

- Task: `.trellis/tasks/05-23-extract-comfyui-ui`.
- Goal: expose the ComfyUI provider in the existing Extract tab without rewriting the Grsai extract path.

## Relevant Existing Code

- `packages/client/src/renderer/src/components/generation-workbench.tsx` already has `GrsaiExtractPanel` and `ComfyuiImg2imgPanel`; extract ComfyUI should mirror those UI patterns.
- `packages/client/src/main/lib/generation-service.ts` already lists extract sources from `01-采集` and has ComfyUI img2img orchestration using `ComfyuiChenyuAdapter`.
- `packages/client/src/main/lib/comfyui-chenyu-adapter.ts` already persists `capability='extract'` outputs to `02-生图/03-提取` and writes `source_artifact_ids`.
- `packages/client/src/main/lib/comfyui-workflow-cache.ts` already lists and gets cached ComfyUI workflows by category.

## Contracts To Preserve

- Extract input source must be from `01-采集`, and the main process must enforce this even if the renderer passes arbitrary paths.
- Workflow list must show only `capability/category=extract`.
- Each selected source image runs the selected ComfyUI workflow once.
- Output is persisted under `02-生图/03-提取` by the existing adapter.
- Source collection images should be registered as artifacts so extract outputs can record `source_artifact_ids`.
- If no ComfyUI instance is ready, the service should return a renderer-safe setup error.

## Minimal Implementation Plan

1. Extend `generation-service.ts` with `listComfyuiExtractWorkflows`, `runComfyuiExtract`, and `runComfyuiExtractBatch`.
2. Reuse `listExtractSources` for source UI and `ComfyuiChenyuAdapter` for execution.
3. Add `ComfyuiExtractPanel` to `generation-workbench.tsx`, reusing the existing source-grid/progress pattern.
4. Add preload and renderer global types for the new IPC methods.
5. Add focused tests for extract workflow filtering, `01-采集` path enforcement, source artifact lineage, and missing instance error.
