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

### Scenario: Electron Vite Workspace Dependency Bundling

#### 1. Scope / Trigger
- Trigger: Electron main or preload imports a workspace package that ships source files instead of compiled output.
- Boundary: runtime workspace packages used by main/preload must be bundled into the Electron output, not left for Node to resolve from source.

#### 2. Signatures
- `packages/client/electron.vite.config.ts`
  - `main.plugins = [externalizeDepsPlugin({ exclude: ['@tengyu-aipod/shared'] })]`
  - `preload.plugins = [externalizeDepsPlugin({ exclude: ['@tengyu-aipod/shared'] })]`

#### 3. Contracts
- `@tengyu-aipod/shared` is source-first (`packages/shared/src/index.ts`) and uses extensionless re-exports.
- If it is externalized, Electron/Node may resolve it directly from source and fail on runtime ESM resolution.
- Excluding it from externalization ensures main and preload bundles inline the shared code.
- Third-party `node_modules` dependencies should still be externalized normally.

#### 4. Validation & Error Matrix
- Shared package externalized in main/preload -> Electron dev can fail with `ERR_MODULE_NOT_FOUND` for `packages/shared/src/*`.
- Shared package excluded from externalization -> `pnpm -F @tengyu-aipod/client dev` and `build` can load the main process bundle.
- Do not disable dependency externalization globally just to fix this one workspace package.

#### 5. Good/Base/Bad Cases
- Good: shared runtime types and helpers are bundled, and the Electron app boots cleanly.
- Base: renderer-only code still uses Vite aliases and normal bundle splitting.
- Bad: letting Node resolve a source-only workspace package at runtime while keeping it externalized.

#### 6. Tests Required
- `pnpm -F @tengyu-aipod/client type-check`
- `pnpm -F @tengyu-aipod/client lint`
- `pnpm -F @tengyu-aipod/client test`
- `pnpm -F @tengyu-aipod/client build`
- `pnpm -F @tengyu-aipod/client dev` smoke check should reach window creation without `ERR_MODULE_NOT_FOUND`.

#### 7. Wrong vs Correct

Wrong:
```ts
main: {
  plugins: [externalizeDepsPlugin()]
}
```

Correct:
```ts
main: {
  plugins: [externalizeDepsPlugin({ exclude: ['@tengyu-aipod/shared'] })]
}
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

### Scenario: Title Module Service

#### 1. Scope / Trigger
- Trigger: Electron client title generation needs to scan a finished SKU batch, call vision LLMs, write `titles.xlsx`, and persist SKU title metadata.
- Boundary: this is main-process orchestration only. Renderer UI calls it through IPC; renderer must not read folders, hold API keys, call Bailian, or write Excel files directly.

#### 2. Signatures
- Class: `TitleService`
- Singleton: `titleService`
- Config:
  - `TitleBatchConfig.batchDir: string`
  - `platform: string`
  - `language: string`
  - `model: string`
  - `imageIndex?: number`
  - `extraRequirement?: string`
  - `existingStrategy?: 'skip' | 'regenerate'`
  - `maxRetries?: number`
  - `concurrency?: number`
  - `preprocess?: { maxSize?: number; compression?: boolean; format?: 'jpg' | 'png'; quality?: number }`
- Methods:
  - `scanBatchDir(batchDir): Promise<{ skuCount: number; existingTitles: Record<string, string> }>`
  - `runTitleBatch(config): Promise<TitleBatchResult>`
  - `startBatch(config): string`
  - `retryFailed(taskId): string`
  - `getResult({ sku_code, batch_dir }): Promise<TitleResult | null>`
- IPC:
  - `title:list-platforms -> Array<{ key; label }>`
  - `title:list-languages -> Array<{ key; label }>`
  - `title:list-models -> Array<{ key; label }>`
  - `title:scan-batch-dir({ batchDir }) -> { skuCount, existingTitles }`
  - `title:run(TitleBatchConfig) -> taskId`
  - `title:retry-failed({ task_id }) -> taskId`
  - `title:get-result({ sku_code, batch_dir }) -> TitleResult | null`
  - Event: `title:progress -> { task_id, processed, total, succeeded, failed, skipped }`

#### 3. Contracts
- Scan only first-level directories under `batchDir`; directory names are SKU codes and sort with natural ordering.
- Pick images by natural sort over `jpg`, `jpeg`, `png`, and `webp`. `imageIndex` is 1-indexed; invalid low values normalize to 1; too-large values use the last image and produce a warning.
- Read existing `titles.xlsx` from `{batchDir}/titles.xlsx`; header may be Chinese `货号/标题` or English `sku/title`.
- `skip` mode skips SKUs that already have titles; if every SKU is skipped, do not require a title Skill or Bailian API key.
- `regenerate` mode overwrites existing rows with new generated titles.
- Fetch title Skill through `skillCacheManager` with `{ module: 'title', platform, language }`, then call `AliyunBailianAdapter.visionCompletion`.
- Preprocess images with `SharpPreprocessPool` into `.workbench/tmp/title/{taskId}`, delete each preprocessed file after the LLM call, and clean the task temp directory in `finally`.
- Parse model output as one title string: strip common prefixes, markdown fences, bullets, wrapping quotes, and truncate by platform fallback limit.
- Write `titles.xlsx` with exactly A `货号` and B `标题`; generated titles override existing titles.
- Persist generated titles into `.workbench/workbench.db` `skus` fields: title, language, platform, title skill id/version, model, and generated timestamp.

#### 4. Validation & Error Matrix
- Missing `workbench_root` -> throw before running title generation.
- Non-directory `batchDir` -> throw before processing SKUs.
- SKU folder has no images -> SKU result `failed` with `NO_IMAGE`; batch continues.
- LLM returns empty title -> retry while retries remain; still empty after retry -> SKU failed.
- Bailian retryable errors -> retry up to `maxRetries`; non-retryable errors fail that SKU.
- `titles.xlsx` locked (`EBUSY`, `EPERM`, `EACCES`) -> `AppErrorClass('XLSX_LOCKED', retryable=false)`.
- Early setup failure after temp dir creation -> close owned preprocess pool and cleanup title temp dir in `finally`.

#### 5. Good/Base/Bad Cases
- Good: UI calls `title:run`, listens to `title:progress`, and reads per-SKU result through `title:get-result`.
- Base: user selects "skip", existing title rows stay unchanged, only missing SKUs are generated.
- Bad: renderer reads local image files, sends API keys to a server, or writes `titles.xlsx` itself.

#### 6. Tests Required
- Unit test natural folder/image sorting and nth-image fallback.
- Unit test `parseTitle` stripping prefixes/quotes and truncating by platform.
- Unit test xlsx read/write merge behavior and `XLSX_LOCKED` mapping.
- Unit test run orchestration with skip mode, retry after empty LLM output, progress emission, xlsx write, and `skus` registration.
- Unit test all-skipped batch does not fetch Skill or require Bailian API key.
- Type-check preload and renderer declarations when changing title IPC.

#### 7. Wrong vs Correct

Wrong:
```ts
// Renderer owns privileged work and leaks local/API details across layers.
await fetch('/api/title-proxy', { body: JSON.stringify({ apiKey, imagePath }) })
```

Correct:
```ts
const taskId = await window.api.title.run({
  batchDir,
  platform,
  language,
  model,
  existingStrategy: 'skip',
})
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
