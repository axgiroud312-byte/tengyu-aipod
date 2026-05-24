# ComfyUI HTTP API Notes

Task scope: implement a thin HTTP client for the native ComfyUI server API. The ComfyUI URL comes from the Chenyu `server_map` entry selected by later tasks.

Authoritative routes for v1:

- `POST /upload/image`
  - Multipart form upload.
  - The file field is named `image`.
  - Returns the filename ComfyUI will use inside workflow nodes.
- `POST /prompt`
  - JSON body contains the full workflow under `prompt`.
  - Successful responses include `prompt_id`.
- `GET /history/{prompt_id}`
  - Poll until the prompt history entry reports `status.completed === true`.
  - The completed entry contains workflow output file metadata used by higher-level execution.
- `GET /view?filename=...`
  - Downloads a generated image as binary data.

Project-specific notes:

- Follow the existing main-process adapter style in `packages/client/src/main/lib/grsai-adapter.ts`.
- Throw `AppErrorClass` for transport failures so `GenerationConcurrencyController` can classify retryable failures.
- Keep this client focused on ComfyUI transport only. Workflow input injection, output file persistence, and Chenyu instance lifecycle belong to later tasks.
- Use MSW tests, matching the existing adapter tests.

