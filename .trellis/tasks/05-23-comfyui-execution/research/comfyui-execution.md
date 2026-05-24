# ComfyUI Execution Notes

Task scope: implement the ComfyUI Chenyu execution adapter that runs one workflow at a time through existing Chenyu instance and ComfyUI HTTP clients.

Boundaries:

- Reuse `ComfyHttpClient` for `/upload/image`, `/prompt`, `/history`, and `/view`.
- Reuse `ComfyuiInstanceManager` state for current instance readiness.
- Reuse `GenerateRequest`, `GenerateResponse`, and `ImageGenerationAdapter` from `grsai-adapter.ts`.
- Reuse the existing `artifacts` table shape from `generation-service.ts`; do not redesign generation storage.
- Keep this task to adapter/service execution. UI wiring for img2img/extract/matting happens in later tasks.

Workflow injection:

- Clone `workflow.workflowJson` before modifying it.
- Slot shape in shared types is `nodeId` + `field`; spec docs may call them `node_id` and `workflow_json`, but client shared types already use camelCase.
- Image slots use the first uploaded ComfyUI filename by default.
- String slots use `req.prompt`.
- Number/boolean slots may read `req.options[slot.name]` or `req.options[slot.field]`.

History/output parsing:

- `ComfyHttpClient.getHistory(promptId)` returns the completed history entry.
- Output slots identify a ComfyUI node. Read `history.outputs[slot.nodeId].images[]`.
- Each image object should provide `filename`; optional `subfolder` and `type` may be passed through to future enhancements, but v1 `viewImage(filename)` downloads by filename.

Persistence:

- Save outputs under `02-生图/{capability folder}`.
- Folders: `txt2img -> 01-文生图`, `img2img -> 02-图生图`, `extract -> 03-提取`, `matting -> 04-抠图`.
- Register each output in `artifacts` with `provider = "comfyui-chenyu"` and `model_or_workflow = workflow.id`.
- `source_artifact_ids` should contain any source artifact IDs provided in `req.options.sourceArtifactIds`; otherwise use `[]`.

Tests:

- Instance not running throws `CHENYU_INSTANCE_DOWN`.
- Image upload, workflow injection, queue, history polling, download, file save, and artifact insert all happen in order.
- Output filename missing or no output images fails.

