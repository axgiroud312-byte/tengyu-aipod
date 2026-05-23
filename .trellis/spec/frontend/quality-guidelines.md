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

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
