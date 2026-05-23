# Task: Shared Package Skeleton（切片 0 - 第 2 个）

## 目标

在 `packages/shared` 下建共享 TypeScript 包，提供客户端和服务端**都用到**的类型、zod schemas、错误码、常量。

## 输入

- 参考：`docs/spec/00-overview.md §9`（错误处理基线 + AppError 接口）
- 参考：`docs/CONTEXT.md`（领域术语）

## 验收标准

- [ ] `packages/shared/package.json`（含 `"type": "module"`、`"main": "src/index.ts"`、`"types": "src/index.ts"`）
- [ ] `packages/shared/tsconfig.json`（继承 base）
- [ ] `packages/shared/src/types.ts`：核心领域类型
  - `SkuCode` / `PrintId` / `TaskId`（branded string types）
  - `TaskStatus` / `StepStatus` / `TaskType` 联合类型
  - `RiskLevel`（'pass' | 'review' | 'block'）
  - `GenerationCapability`（'txt2img' | 'img2img' | 'extract' | 'matting'）
  - `Provider` / `Skill` / `ComfyuiWorkflow` / `Customer` / `ActivationCode` / `DeviceActivation` 等接口
- [ ] `packages/shared/src/schemas.ts`：zod schemas（与 types 对应，用于 IPC 和 API 验证）
- [ ] `packages/shared/src/errors.ts`：`ErrorCode` enum + `AppError` 接口（参见 spec/00-overview §9）
- [ ] `packages/shared/src/constants.ts`：常量（默认并发数、API path、版本号等）
- [ ] `packages/shared/src/index.ts`：re-export 所有公开 API
- [ ] `pnpm -F @tengyu-aipod/shared type-check` 通过

## 不做

- 不实现任何运行时逻辑
- 不依赖 Electron / Next.js（必须保持纯 TS）

## 实施提示

包名建议：`@tengyu-aipod/shared`。

`AppError` 接口（必须有这个，所有模块依赖它）：

```ts
export interface AppError {
  code: keyof typeof ErrorCode
  message: string
  details?: Record<string, unknown>
  retryable: boolean
  cause?: unknown
}

export class AppErrorClass extends Error implements AppError {
  constructor(
    public code: keyof typeof ErrorCode,
    public message: string,
    public retryable = false,
    public details?: Record<string, unknown>,
    public cause?: unknown,
  ) { super(message) }
}
```

## 完成后

```bash
git add -A
git commit -m "feat(task-02): shared package with types/schemas/errors"
python3 .trellis/scripts/task.py archive 05-23-shared-package-skeleton
```
