# ComfyUI Instance Manager Notes

Task scope: implement a testable main-process service for Chenyu-backed ComfyUI instance lifecycle and persistence. UI controls can consume this service in later UI tasks.

Required boundaries:

- Reuse `ChenyuCloudClient` for Chenyu API calls.
- Reuse the existing workbench SQLite pattern from `generation-service.ts` / `detection-config.ts`.
- Store a single active row in `comfyui_instances` with `id = 1`.
- Do not implement multi-instance scheduling.
- Do not call `set_idle_close`; Chenyu marks it as unavailable.

Core behaviors:

- `createInstance` accepts selected Pod/GPU and `autoShutdownMinutes`, defaulting to 60 minutes.
- After `createByPod`, immediately call `setShutdownTimer` with a Unix timestamp in seconds.
- Extract ComfyUI URL from `instance.server_map` where `port_type === "http"` and `title` contains `ComfyUI`.
- Persist instance UUID, ComfyUI URL, Pod/GPU IDs, prices, status, auto-shutdown timestamp, creation time, and last-used time.
- `refreshCurrentInstance` calls `getInstanceInfo`, maps Chenyu status codes to `none/starting/running/shutting_down/stopped`, and updates local storage.
- `estimateCost` uses elapsed runtime minutes multiplied by the combined hourly price from Pod and GPU.
- `getBalance` is delegated to Chenyu; UI-level polling every 60 seconds belongs outside this service.

Testing focus:

- Service calls Chenyu methods in the correct order.
- Shutdown timer uses timestamp seconds, not minutes.
- ComfyUI URL extraction works and missing URL is a failure.
- Database row is inserted/updated as a singleton.
- Lifecycle methods update status.

