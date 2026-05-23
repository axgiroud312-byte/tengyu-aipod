# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

### Scenario: Aliyun Bailian Client Adapter

#### 1. Scope / Trigger
- Trigger: client-side vision/LLM calls that use the user's local Aliyun Bailian API key.
- Boundary: keep Bailian API keys and local images in the Electron client. Do not proxy user images or user API keys through the server.

#### 2. Signatures
- Class: `AliyunBailianAdapter`
- Constructor: `{ apiKey: string; region: 'cn' | 'sg' | 'us'; maxRetries?: number; timeoutMs?: number }`
- Methods:
  - `chatCompletion(req: ChatRequest): Promise<ChatResponse>`
  - `visionCompletion(req: VisionRequest): Promise<VisionResponse>`
- Region base URLs:
  - `cn` -> `https://dashscope.aliyuncs.com/compatible-mode/v1`
  - `sg` -> `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
  - `us` -> `https://dashscope-us.aliyuncs.com/compatible-mode/v1`

#### 3. Contracts
- Requests use OpenAI-compatible `chat.completions.create`.
- `response_format: { type: 'json_object' }` must pass through when provided.
- Vision image content must support OpenAI-compatible `image_url` parts, including local data URLs such as `data:image/png;base64,...`.
- Responses expose normalized fields: `text`, `model`, `finishReason`, `usage`, and `raw`.

#### 4. Validation & Error Matrix
- HTTP 401/403 -> `AppErrorClass('HTTP_4XX', retryable=false)`
- HTTP 429 -> `AppErrorClass('HTTP_429', retryable=true)`
- HTTP 402 -> `AppErrorClass('BAILIAN_QUOTA_EXCEEDED', retryable=false)`
- HTTP 5xx -> `AppErrorClass('HTTP_5XX', retryable=true)`
- SDK timeout -> `AppErrorClass('NETWORK_TIMEOUT', retryable=true)`
- SDK connection error -> `AppErrorClass('NETWORK_OFFLINE', retryable=true)`

#### 5. Good/Base/Bad Cases
- Good: `visionCompletion` receives a user message containing an `image_url` data URL and a text instruction.
- Base: `chatCompletion` sends text-only messages and returns `choices[0].message.content` as `text`.
- Bad: server-side proxying of user API keys or user images.

#### 6. Tests Required
- Mock OpenAI-compatible `/chat/completions` with `msw`.
- Assert selected region base URL, Bearer auth, `response_format`, and vision data URL request body.
- Assert 401, 429, and 5xx map to the expected `AppErrorClass` codes and retryability.

#### 7. Wrong vs Correct

Wrong:
```ts
// Server receives the user's API key and uploads local images.
await fetch('/api/proxy-bailian', { body: JSON.stringify({ apiKey, imageBase64 }) })
```

Correct:
```ts
const adapter = new AliyunBailianAdapter({ apiKey, region: 'cn' })
await adapter.visionCompletion({ model, messages })
```

### Scenario: Sharp Preprocess Worker Pool

#### 1. Scope / Trigger
- Trigger: title generation and detection need local images converted before sending to vision models.
- Boundary: preprocessing runs in Electron client worker threads to avoid blocking the main process.

#### 2. Signatures
- Class: `SharpPreprocessPool`
- Constructor: `new SharpPreprocessPool(workerCount = defaultPreprocessWorkerCount())`
- Methods:
  - `process(options: PreprocessOptions): Promise<PreprocessResult>`
  - `processAll(options: PreprocessOptions[]): Promise<PreprocessResult[]>`
  - `close(): Promise<void>`
- Default worker count:
  - User override clamps to 1-8.
  - Low-end machines (`cpu < 4` or `ram < 4GB`) use 1 worker.
  - Otherwise use `min(floor(cpus / 2), 4)`.

#### 3. Contracts
- Input supports either a file path or `Buffer`.
- Pipeline order:
  1. `flatten({ background: '#ffffff' })`
  2. optional `resize({ width, fit: 'inside', withoutEnlargement: true })`
  3. encode as `jpeg({ quality: 85 })` by default or PNG when requested
- Output path must be under `.workbench/tmp/{module}/{taskId}/{hash}_preprocessed.{ext}`.
- Result shape: `{ outputPath, mimeType, sizeBytes, dataUrl }`.

#### 4. Validation & Error Matrix
- Missing path input -> `PreprocessError.kind = 'INPUT_NOT_FOUND'`
- Sharp decode failure -> `PreprocessError.kind = 'SHARP_DECODE_FAILED'`
- Disk full / ENOSPC -> `PreprocessError.kind = 'DISK_FULL'`
- All preprocess errors are non-retryable by default.

#### 5. Good/Base/Bad Cases
- Good: transparent PNG buffer -> white-flattened JPEG data URL for Bailian.
- Base: file path PNG -> PNG output when `format: 'png'`.
- Bad: running sharp transformations directly on the Electron main thread loop.

#### 6. Tests Required
- Generate a transparent PNG with sharp and assert JPEG output metadata, resize limit, path, MIME type, and data URL.
- Test both Buffer input and file path input.
- Test queueing with a worker count of 1.
- Test missing input and decode failure classification.

#### 7. Wrong vs Correct

Wrong:
```ts
// Blocks the Electron main process during large batch preprocessing.
await sharp(inputPath).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toFile(output)
```

Correct:
```ts
const pool = new SharpPreprocessPool()
const result = await pool.process({ module: 'title', taskId, workbenchRoot, input })
```

### Scenario: TempFileManager

#### 1. Scope / Trigger
- Trigger: any Electron client module needs temporary files or intermediate artifacts.
- Boundary: all task-scoped temporary files live under the configured workbench root at `.workbench/tmp/{module}/{taskId}`. User-facing material folders must not receive JSON, JSX, CSV, snapshots, masks, or other intermediate files.

#### 2. Signatures
- Class: `TempFileManager`
- Singleton: `tempFileManager`
- Module names: `collection`, `generation`, `detection`, `photoshop`, `matting`, `title`, `listing`
- Methods:
  - `createTaskDir(module: TempModule, taskId: string): Promise<string>`
  - `getTaskDir(module: TempModule, taskId: string): Promise<string>`
  - `cleanupTask(module: TempModule, taskId: string, options?: { keepIfFailed?: boolean }): Promise<void>`
  - `cleanupOrphans(): Promise<void>`
  - `cleanupSession(): Promise<void>`
  - `cleanupAll(): Promise<void>`
  - `getDiskUsage(): Promise<Record<string, number>>`
  - `clearTimers(): void`
- IPC:
  - `temp-file:get-usage -> Promise<Record<string, number>>`
  - `temp-file:cleanup-all -> Promise<{ ok: true }>`

#### 3. Contracts
- Root path comes from `readAppConfig().workbench_root`; missing workbench root is a setup error.
- `createTaskDir` must create `.workbench/tmp/{module}/{taskId}` recursively and track it as part of the current session.
- `cleanupTask(..., { keepIfFailed: false })` deletes the task directory immediately.
- `cleanupTask(..., { keepIfFailed: true })` keeps the task directory for one hour, then deletes it with `setTimeout`.
- `cleanupOrphans` runs on app startup and removes task directories older than 24 hours, using `mtimeMs` first and `ctimeMs` only as a fallback.
- `before-quit` must best-effort clean current-session temp directories and clear delayed cleanup timers.
- `getDiskUsage` returns bytes grouped by module directory.

#### 4. Validation & Error Matrix
- Missing `workbench_root` -> throw an error before creating or reading temp files.
- Missing root/module/task directory during cleanup -> no-op via forceful deletion or guarded reads.
- App exits before delayed failed cleanup fires -> next startup `cleanupOrphans` is the fallback.
- Non-directory entries under `.workbench/tmp` -> ignored by orphan cleanup and disk usage grouping.

#### 5. Good/Base/Bad Cases
- Good: title generation writes preprocessed images to `.workbench/tmp/title/{taskId}` and calls `cleanupTask` after success.
- Base: a failed detection task calls `cleanupTask('detection', taskId, { keepIfFailed: true })` so retry can reuse artifacts briefly.
- Bad: writing `prompt-snapshot.json`, JSX, DOM snapshots, or masks into `01-` through `05-` material folders.

#### 6. Tests Required
- Unit test task directory creation under `.workbench/tmp/{module}/{taskId}`.
- Unit test immediate cleanup and failed delayed cleanup.
- Unit test orphan cleanup removes only directories older than 24 hours.
- Unit test disk usage reports bytes grouped by module.
- Type-check preload and renderer declarations when adding IPC surface.

#### 7. Wrong vs Correct

Wrong:
```ts
// Pollutes a user-facing material folder with an intermediate file.
await writeFile(join(workbenchRoot, '05-货号成品', 'prompt-snapshot.json'), json)
```

Correct:
```ts
const tempDir = await tempFileManager.createTaskDir('title', taskId)
await writeFile(join(tempDir, 'prompt-snapshot.json'), json)
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
