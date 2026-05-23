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

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
