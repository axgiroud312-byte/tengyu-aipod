# Chenyu Cloud API Notes

Task scope: implement a main-process client for Chenyu Cloud's open API. This client manages cloud resources only. Native ComfyUI HTTP transport is handled by `ComfyHttpClient`.

Base contract:

- Base URL: `https://www.chenyu.cn/api/open/v2`
- Auth: `Authorization: Bearer <apiKey>`
- JSON response envelope: `{ code: number, msg?: string, data?: unknown }`
- `code === 0` means success. Any non-zero `code` is a business failure and should be mapped to `AppErrorClass`.

Required endpoints:

- `GET /pod/list`
- `GET /gpu/list`
- `GET /image/market/list`
- `POST /instance/create_by_pod`
- `GET /instance/info`
- `GET /instance/list`
- `POST /instance/startup`
- `POST /instance/shutdown`
- `POST /instance/restart`
- `POST /instance/shutdown_timer`
- `POST /instance/destroy`
- `GET /balance/info`

Instance status enum:

- `1` -> `initializing`
- `2` -> `running`
- `21` -> `shutting_down`
- `22` -> `stopped`

Retry and error handling:

- HTTP 429 must read `Retry-After` when present and retry with backoff, up to a small bounded retry count.
- HTTP 401/403 should be non-retryable `HTTP_4XX`.
- HTTP 429 and 5xx should be retryable.
- Non-zero Chenyu business `code` should throw `AppErrorClass`; keep `code` and `msg` in `details`.

Known ambiguity:

- `shutdown_timer.shutdown_time` is documented inconsistently. For v1, follow `docs/spec/03-generation.md §9.2`: send a Unix timestamp in seconds, computed as `now + autoShutdownMinutes * 60`.
- Do not implement or call `set_idle_close`; the reference marks it as not launched.
- Do not call workflow/run APIs in this task; v1 uses native ComfyUI HTTP plus Tengyu-dispatched workflow JSON.

