# P3 Client Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start P3 without scope drift by splitting the client refactor into isolated tracks: route shell, complete-task page, settings page, IPC API typing, theme tokens, and ADR-first update/selector dispatch.

**Architecture:** Keep v1 fixed complete-task semantics from ADR-0012/0013/0015 unchanged. Move behavior behind pure functions, hooks, and small components first; only after behavior-preserving splits are green should visual or feature work proceed. Auto update and selector hotfix dispatch start with ADRs because they touch ADR-0003 and ADR-0014 boundaries.

**Tech Stack:** Electron 42, React 19, React Router 7, TypeScript strict mode, shadcn/Tailwind CSS tokens, Vitest, Playwright E2E, Electron preload IPC, zod handlers, `@tengyu-aipod/shared`.

---

## Current Findings

- `packages/client/src/renderer/src/App.tsx` is 1782 lines and mixes auth gate, onboarding route, workbench shell, collection controller state, title controller state, and module mounting.
- `packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx` is 3744 lines and mixes form draft state, option loading, validation, config building, run control, result panels, history, and item status.
- `packages/client/src/renderer/src/features/settings/SettingsPage.tsx` is 2017 lines and mixes workspace, logs, local generation settings, bit-browser, Skill sync, workflow import, and Chenyu instance management.
- `packages/client/src/preload/index.ts` and `packages/client/src/renderer/src/vite-env.d.ts` duplicate the shape of `window.api`.
- Listing selectors already use `SelectorRecord` from ADR-0014, but ADR-0014 explicitly says selector records are still local code and not HTTP-dispatched.
- `index.css`, `Header.tsx`, `Sidebar.tsx`, and base UI primitives still contain gradient backgrounds, glow shadows, and partial `[data-theme="dark"]` tokens.

## Scope Boundaries

- Do not implement a generic orchestrator, pause/resume, automatic recovery, listing-in-pipeline, or free workflow editing in P3 route/page cleanup.
- Do not change `PipelineProgress`, `pipeline_runs`, `pipeline_steps`, `pipeline_items`, or main-process pipeline service behavior for the page split.
- Do not add selector cloud dispatch or auto update code before the ADR task is accepted.
- Do not move client-main implementation types into `shared` by importing from `packages/client`; shared must stay lower-level than client.
- Do not rework Settings/Onboarding product UX beyond extraction unless a separate PRD says so.

## File Structure Map

### Track A: Route Shell

- Create `packages/client/src/renderer/src/app/CustomerAuthGate.tsx`: owns customer auth verification and polling.
- Create `packages/client/src/renderer/src/app/WorkbenchRoute.tsx`: owns onboarding gate and stored workbench route redirect.
- Create `packages/client/src/renderer/src/app/OnboardingRoute.tsx`: owns `/onboarding/:step` route wrapper around `OnboardingPage`.
- Create `packages/client/src/renderer/src/app/MainWorkbench.tsx`: initially moves the existing `MainWorkbench` body unchanged.
- Modify `packages/client/src/renderer/src/App.tsx`: leaves only `HashRouter`, `CustomerAuthGate`, and route declarations.

### Track B: Complete Task Page

- Create `packages/client/src/renderer/src/features/pipeline/types.ts`: renderer-only page state types currently declared in `FullTaskPage.tsx`.
- Create `packages/client/src/renderer/src/features/pipeline/pipeline-validation.ts`: pure validation with stage-aware issues.
- Create `packages/client/src/renderer/src/features/pipeline/pipeline-progress-view-model.ts`: pure mapping from `PipelineProgress | PipelineRunDetail` to rail/run-theater view state.
- Create `packages/client/src/renderer/src/features/pipeline/components/PipelineRail.tsx`: controlled display component.
- Create `packages/client/src/renderer/src/features/pipeline/components/RunTheater.tsx`: rail + log tail + existing result panels.
- Create `packages/client/src/renderer/src/features/pipeline/components/PipelineResultPanels.tsx`: moves existing result/history/items panels unchanged.
- Modify `packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx`: becomes container and keeps session state until a later store task.
- Test `packages/client/src/renderer/src/features/pipeline/pipeline-validation.test.ts`.
- Test `packages/client/src/renderer/src/features/pipeline/pipeline-progress-view-model.test.ts`.

### Track C: Settings Page

- Create `packages/client/src/renderer/src/features/settings/types.ts`: `ChenyuConfig`, `GenerationConfig`, `ConnectionStatus`, and derived settings props.
- Create `packages/client/src/renderer/src/features/settings/useSettingsPageModel.ts`: current load/save/action functions and page state.
- Create `packages/client/src/renderer/src/features/settings/components/WorkspaceSettingsCard.tsx`.
- Create `packages/client/src/renderer/src/features/settings/components/LogsSettingsCard.tsx`.
- Move existing card components to `packages/client/src/renderer/src/features/settings/components/`.
- Modify `packages/client/src/renderer/src/features/settings/SettingsPage.tsx`: renders tabs and passes model props to cards.

### Track D: IPC API Typing

- Create `packages/shared/src/client-api.ts`: shared contracts for `window.api` modules that already depend only on shared types.
- Create `packages/client/src/preload/api.ts`: exports `api satisfies ClientApi`.
- Modify `packages/client/src/preload/index.ts`: only exposes the imported `api`.
- Modify `packages/client/src/renderer/src/vite-env.d.ts`: imports `ClientApi` for `Window.api`.
- Follow-up commits move stable client-main DTO types to `packages/shared/src` one module at a time before adding them to `ClientApi`.

### Track E: Theme Tokens And Visual Cleanup

- Modify `packages/client/src/renderer/src/index.css`: flatten shell background, remove decorative workbench image/grid overlays, define light and dark tokens in one place.
- Modify `packages/client/src/renderer/src/layout/Header.tsx`: replace image hero header with compact text header.
- Modify `packages/client/src/renderer/src/layout/Sidebar.tsx`: replace gradient active states with token-based active states.
- Modify base primitives in `packages/client/src/renderer/src/components/ui/`: remove glow shadows and hard-coded white surfaces where they break dark tokens.
- Modify `packages/client/scripts/assert-theme-css.mjs` only if token names change.

### Track F: ADR-First Update And Selector Dispatch

- Create `docs/adr/0017-client-update-and-selector-dispatch-boundary.md`: defines what may be server-dispatched and what must remain local.
- Update `docs/spec/07-listing.md`: point selector hotfix to the ADR and keep four-layer listing rule.
- Update `docs/spec/09-cross-cutting.md`: align auto-update behavior with the ADR.
- No runtime code in this task.

---

## Task 1: Save The P3 Boundary ADR

**Files:**
- Create: `docs/adr/0017-client-update-and-selector-dispatch-boundary.md`
- Modify: `docs/spec/07-listing.md`
- Modify: `docs/spec/09-cross-cutting.md`

- [ ] **Step 1: Add ADR skeleton with explicit accepted/proposed status**

```markdown
# ADR-0017 — 客户端更新与选择器热修边界

**状态**：Proposed
**日期**：2026-07-06

## 背景

P3 计划处理两个容易越界的能力：客户端自动更新，以及店小秘 selector 热修。二者都涉及云端派发内容，必须受 ADR-0003 的“云端轻配置，本地运行”边界约束。

## 决策

- 自动更新只分发版本元数据和安装包下载地址；云端不接触用户图片、API Key、任务数据、店铺数据或本地 SQLite。
- selector 热修只允许分发 JSON selector records，不允许分发可执行 JS/TS、Playwright action、workflow 代码或任意脚本。
- selector record 必须符合 ADR-0014 的 `SelectorRecord` 结构，并按平台、版本和创建时间标识。
- 客户端必须把远端 selector records 缓存在 `.workbench/cache/listing-selectors/`，并保留内置 selector 作为回退。
- 用户必须可以在设置页查看当前 selector 来源：内置 / 缓存 / 本地导入。

## 明确禁止

- 云端代理店小秘页面操作。
- 云端接收 SKU、标题、图片路径、店铺名、商品 URL 或运行证据。
- 远端 selector 包携带函数、表达式、动态 import、eval 字符串或二进制插件。
- selector 热修绕过 ADR-0004 的 selectors / page-parser / action-executor / workflow 四层结构。

## 验证

- selector 包 schema 用 zod 校验。
- 未命中远端缓存时使用内置 selector。
- 远端 selector 损坏时展示中文错误并继续使用内置 selector。
```

- [ ] **Step 2: Link listing spec section 12 to ADR-0017**

In `docs/spec/07-listing.md`, append this paragraph under `## 12. 选择器本地版本化（v1.5+）`:

```markdown
P3 若启动 selector 热修，必须先按 ADR-0017 执行：远端只能派发 JSON selector records，不能派发可执行动作代码；平台仍按 selectors / page-parser / action-executor / workflow 四层运行，远端 record 只替换 selectors 数据源。
```

- [ ] **Step 3: Link cross-cutting update section to ADR-0017**

In `docs/spec/09-cross-cutting.md`, append this paragraph under `## 7. 自动更新`:

```markdown
P3 自动更新能力以 ADR-0017 为边界：版本检查只读取版本元数据和下载地址，不上传本地业务数据；强制更新只能阻断客户端继续使用，不能改变本地工作区内容。
```

- [ ] **Step 4: Validate docs diff**

Run:

```powershell
git diff --check -- 'docs/adr/0017-client-update-and-selector-dispatch-boundary.md' 'docs/spec/07-listing.md' 'docs/spec/09-cross-cutting.md'
```

Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add -- 'docs/adr/0017-client-update-and-selector-dispatch-boundary.md' 'docs/spec/07-listing.md' 'docs/spec/09-cross-cutting.md'
git commit -m "docs(client): define p3 update dispatch boundary"
```

---

## Task 2: Extract App Route Shell Without Behavior Changes

**Files:**
- Create: `packages/client/src/renderer/src/app/CustomerAuthGate.tsx`
- Create: `packages/client/src/renderer/src/app/WorkbenchRoute.tsx`
- Create: `packages/client/src/renderer/src/app/OnboardingRoute.tsx`
- Create: `packages/client/src/renderer/src/app/MainWorkbench.tsx`
- Modify: `packages/client/src/renderer/src/App.tsx`
- Test through: `packages/client/e2e/workspace-settings.spec.ts`, `packages/client/e2e/tutorial.spec.ts`

- [ ] **Step 1: Move constants and helpers used only by auth/onboarding**

Move these unchanged from `App.tsx` to the new app files:

```ts
const CUSTOMER_AUTH_RECHECK_MS = 5 * 60 * 1000
const CUSTOMER_AUTH_PENDING_RECHECK_MS = 3 * 1000

const anonymousCustomerAuthState: CustomerAuthState = {
  customer: null,
  message: null,
  status: 'anonymous',
}

function onboardingPath(step: OnboardingStep) {
  return `/onboarding/${step}`
}
```

- [ ] **Step 2: Move `CustomerAuthGate` unchanged**

Create `CustomerAuthGate.tsx` and move the existing component body. Keep imports local to the file:

```ts
import { CustomerLoginPage } from '@/features/customer-auth/CustomerLoginPage'
import { formatIpcError } from '@tengyu-aipod/shared'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { CustomerAuthState } from '../../main/lib/customer-auth'
```

Expected behavior remains:
- initial `customerAuth:getState`
- strong `customerAuth:verify`
- 5 minute active recheck
- 3 second pending recheck
- `CustomerLoginPage` for non-active states

- [ ] **Step 3: Move `WorkbenchRoute` unchanged**

Create `WorkbenchRoute.tsx`. Keep it responsible only for:
- `window.api.onboarding.getState()`
- redirect to `/onboarding/1`
- redirect invalid workbench paths to `getStoredWorkbenchRoute()`
- render `MainWorkbench`

- [ ] **Step 4: Move onboarding route wrapper unchanged**

Create `OnboardingRoute.tsx` and move current `Onboarding` function. Keep `OnboardingPage` props identical.

- [ ] **Step 5: Move `MainWorkbench` unchanged**

Create `MainWorkbench.tsx` and move current `MainWorkbench`, plus collection/title helpers it directly uses. Do not change collection/title state shape in this task.

- [ ] **Step 6: Reduce `App.tsx` to router composition**

After extraction, `App.tsx` should have this shape:

```tsx
import { CustomerAuthGate } from '@/app/CustomerAuthGate'
import { OnboardingRoute } from '@/app/OnboardingRoute'
import { WorkbenchRoute } from '@/app/WorkbenchRoute'
import { getStoredWorkbenchRoute } from '@/layout/navigation'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Navigate replace to={getStoredWorkbenchRoute()} />} path="/" />
      <Route element={<OnboardingRoute />} path="/onboarding/:step" />
      <Route element={<WorkbenchRoute />} path="/*" />
      <Route element={<Navigate replace to={getStoredWorkbenchRoute()} />} path="*" />
    </Routes>
  )
}

export function App() {
  return (
    <HashRouter>
      <CustomerAuthGate>
        <AppRoutes />
      </CustomerAuthGate>
    </HashRouter>
  )
}
```

- [ ] **Step 7: Validate route split**

Run:

```powershell
pnpm -F @tengyu-aipod/client type-check
pnpm -F @tengyu-aipod/client e2e -- e2e/workspace-settings.spec.ts e2e/tutorial.spec.ts
```

Expected: type-check passes; relevant E2E specs pass.

- [ ] **Step 8: Commit**

```powershell
git add -- 'packages/client/src/renderer/src/App.tsx' 'packages/client/src/renderer/src/app'
git commit -m "refactor(client): extract workbench route shell"
```

---

## Task 3: Extract Complete Task Validation As A Pure Module

**Files:**
- Create: `packages/client/src/renderer/src/features/pipeline/types.ts`
- Create: `packages/client/src/renderer/src/features/pipeline/pipeline-validation.ts`
- Create: `packages/client/src/renderer/src/features/pipeline/pipeline-validation.test.ts`
- Modify: `packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx`

- [ ] **Step 1: Create stage-aware validation types**

```ts
export type PipelineConfigStage = 'source' | 'matting' | 'detection' | 'photoshop' | 'title'

export type PipelineValidationIssue = {
  stage: PipelineConfigStage
  field: string
  message: string
}

export type PipelineValidationInput = {
  effectivePhotoshopEnabled: boolean
  effectiveMattingEnabled: boolean
  effectiveDetectionEnabled: boolean
  effectiveTitleEnabled: boolean
  isMac: boolean
  printSkuCode: string
  templateCount: number
  sourceMode: 'collection' | 'txt2img' | 'img2img' | 'existing_prints'
  sourceFolder: string
  existingPrintFolder: string
  extractSkillOptionCount: number
  hasSelectedExtractSkill: boolean
  extractProvider: 'grsai' | 'comfyui-chenyu'
  runningInstanceCount: number
  extractWorkflowId: string
  extractInstanceUuid: string
  promptSkillOptionCount: number
  hasSelectedPromptSkill: boolean
  promptModel: string
  promptRequirement: string
  txt2imgProvider: 'grsai' | 'comfyui-chenyu'
  txt2imgComfyuiWorkflowId: string
  txt2imgComfyuiInstanceUuid: string
  img2imgProvider: 'grsai' | 'comfyui-chenyu'
  referenceImageCount: number
  img2imgSourceFolder: string
  img2imgComfyuiWorkflowId: string
  img2imgComfyuiInstanceUuid: string
  img2imgComfyuiPromptMode: 'ai' | 'workflow'
  mattingWorkflowId: string
  mattingInstanceUuid: string
  detectionModel: string
  hasSelectedDetectionSkill: boolean
  titleEnabled: boolean
  titlePlatform: string
  titleLanguage: string
  titleModel: string
}
```

- [ ] **Step 2: Move validation rules without changing messages**

Create `validatePipelineConfig(input: PipelineValidationInput): PipelineValidationIssue[]`. Preserve all existing Chinese messages exactly, but attach stage and field.

Example rule:

```ts
if (input.effectivePhotoshopEnabled && !input.printSkuCode.trim()) {
  issues.push({
    stage: 'photoshop',
    field: 'printSkuCode',
    message: '请先填写印花货号',
  })
}
```

- [ ] **Step 3: Write table tests for representative stage mapping**

```ts
import { describe, expect, it } from 'vitest'
import { validatePipelineConfig, type PipelineValidationInput } from './pipeline-validation'

const baseInput: PipelineValidationInput = {
  effectivePhotoshopEnabled: false,
  effectiveMattingEnabled: false,
  effectiveDetectionEnabled: false,
  effectiveTitleEnabled: false,
  isMac: false,
  printSkuCode: '',
  templateCount: 0,
  sourceMode: 'existing_prints',
  sourceFolder: '',
  existingPrintFolder: 'C:/prints',
  extractSkillOptionCount: 1,
  hasSelectedExtractSkill: true,
  extractProvider: 'grsai',
  runningInstanceCount: 1,
  extractWorkflowId: 'extract',
  extractInstanceUuid: 'instance',
  promptSkillOptionCount: 1,
  hasSelectedPromptSkill: true,
  promptModel: 'qwen',
  promptRequirement: 'make a print',
  txt2imgProvider: 'grsai',
  txt2imgComfyuiWorkflowId: '',
  txt2imgComfyuiInstanceUuid: '',
  img2imgProvider: 'grsai',
  referenceImageCount: 1,
  img2imgSourceFolder: '',
  img2imgComfyuiWorkflowId: '',
  img2imgComfyuiInstanceUuid: '',
  img2imgComfyuiPromptMode: 'ai',
  mattingWorkflowId: 'matting',
  mattingInstanceUuid: 'instance',
  detectionModel: 'qwen',
  hasSelectedDetectionSkill: true,
  titleEnabled: false,
  titlePlatform: 'temu',
  titleLanguage: 'en',
  titleModel: 'qwen',
}

describe('validatePipelineConfig', () => {
  it('marks missing print sku as a photoshop issue', () => {
    expect(
      validatePipelineConfig({
        ...baseInput,
        effectivePhotoshopEnabled: true,
        templateCount: 1,
      }),
    ).toContainEqual({
      stage: 'photoshop',
      field: 'printSkuCode',
      message: '请先填写印花货号',
    })
  })

  it('marks title without photoshop as a title issue', () => {
    expect(validatePipelineConfig({ ...baseInput, titleEnabled: true })).toContainEqual({
      stage: 'title',
      field: 'titleEnabled',
      message: '标题生成需要先启用 PS 套版',
    })
  })
})
```

- [ ] **Step 4: Replace `validationIssues` in `FullTaskPage.tsx`**

Map the new issues to existing UI behavior:

```ts
const validationIssues = useMemo(
  () =>
    validatePipelineConfig({
      effectivePhotoshopEnabled,
      effectiveMattingEnabled,
      effectiveDetectionEnabled,
      effectiveTitleEnabled,
      isMac,
      printSkuCode,
      templateCount: templatePaths.length,
      sourceMode,
      sourceFolder,
      existingPrintFolder,
      extractSkillOptionCount: extractSkillOptions.length,
      hasSelectedExtractSkill: Boolean(selectedExtractSkill),
      extractProvider,
      runningInstanceCount: runningInstances.length,
      extractWorkflowId,
      extractInstanceUuid,
      promptSkillOptionCount: promptSkillOptions.length,
      hasSelectedPromptSkill: Boolean(selectedPromptSkill),
      promptModel,
      promptRequirement,
      txt2imgProvider,
      txt2imgComfyuiWorkflowId,
      txt2imgComfyuiInstanceUuid,
      img2imgProvider,
      referenceImageCount: referenceImages.length,
      img2imgSourceFolder,
      img2imgComfyuiWorkflowId,
      img2imgComfyuiInstanceUuid,
      img2imgComfyuiPromptMode,
      mattingWorkflowId,
      mattingInstanceUuid,
      detectionModel,
      hasSelectedDetectionSkill: Boolean(selectedDetectionSkill),
      titleEnabled,
      titlePlatform,
      titleLanguage,
      titleModel,
    }),
  [/* same primitive dependencies as current validation useMemo */],
)
const validationMessages = validationIssues.map((issue) => issue.message)
const canStart = !running && validationIssues.length === 0
```

Update existing render references from `validationIssues.map((issue) => ...)` to `validationMessages.map((message) => ...)`.

- [ ] **Step 5: Validate**

Run:

```powershell
pnpm -F @tengyu-aipod/client exec vitest run src/renderer/src/features/pipeline/pipeline-validation.test.ts
pnpm -F @tengyu-aipod/client type-check
```

Expected: validation tests and type-check pass.

- [ ] **Step 6: Commit**

```powershell
git add -- 'packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx' 'packages/client/src/renderer/src/features/pipeline/types.ts' 'packages/client/src/renderer/src/features/pipeline/pipeline-validation.ts' 'packages/client/src/renderer/src/features/pipeline/pipeline-validation.test.ts'
git commit -m "refactor(client): extract pipeline validation"
```

---

## Task 4: Add Pipeline Progress View Model Before UI Rail

**Files:**
- Create: `packages/client/src/renderer/src/features/pipeline/pipeline-progress-view-model.ts`
- Create: `packages/client/src/renderer/src/features/pipeline/pipeline-progress-view-model.test.ts`
- Modify later: `packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx`

- [ ] **Step 1: Define serializable view model types**

```ts
import type { PipelineProgress, PipelineRunDetail } from '@tengyu-aipod/shared'
import type { PipelineConfigStage, PipelineValidationIssue } from './types'

export type RailMode = 'config' | 'running' | 'done'

export type RailStage = {
  key: PipelineConfigStage
  label: string
  enabled: boolean
  locked?: { on: boolean; reason: string }
  issues: number
  counts: { done: number; total: number; failed: number; blocked: number }
  active: boolean
  durationMs: number | null
}

export type PipelineRailViewModel = {
  mode: RailMode
  stages: RailStage[]
  logTail: string[]
  summary: { status: string; warning: string | null }
}
```

- [ ] **Step 2: Implement `buildPipelineRailViewModel`**

Rules:
- map source/extract to rail stage `source`
- map `matting`, `detection`, `photoshop`, `title` directly
- `status === 'running'` means active
- `status === 'completed'` contributes done count
- `status === 'failed'` contributes failed count
- item risk level `block` under detection contributes blocked count when available
- log tail returns the last five messages

- [ ] **Step 3: Test streaming multiple active stages**

```ts
it('allows multiple stages to be active at the same time', () => {
  const view = buildPipelineRailViewModel({
    progress: {
      run_id: 'run-1',
      status: 'running',
      message: 'running',
      steps: [
        { key: 'source', status: 'running', input_count: 0, output_count: 1 },
        { key: 'matting', status: 'running', input_count: 1, output_count: 0 },
      ],
      items: [],
      logs: [],
      result_sections: [],
      stats: {},
    } as unknown as PipelineProgress,
    issues: [],
    enabled: {
      source: true,
      matting: true,
      detection: false,
      photoshop: false,
      title: false,
    },
  })

  expect(view.stages.filter((stage) => stage.active).map((stage) => stage.key)).toEqual([
    'source',
    'matting',
  ])
})
```

- [ ] **Step 4: Test all-blocked run summary**

Use a completed progress fixture with detection blocked count and zero photoshop/title output. Expected summary warning: `本次没有可继续的印花`.

- [ ] **Step 5: Validate**

Run:

```powershell
pnpm -F @tengyu-aipod/client exec vitest run src/renderer/src/features/pipeline/pipeline-progress-view-model.test.ts
pnpm -F @tengyu-aipod/client type-check
```

- [ ] **Step 6: Commit**

```powershell
git add -- 'packages/client/src/renderer/src/features/pipeline/pipeline-progress-view-model.ts' 'packages/client/src/renderer/src/features/pipeline/pipeline-progress-view-model.test.ts'
git commit -m "refactor(client): add pipeline progress view model"
```

---

## Task 5: Split Complete Task Page Components

**Files:**
- Create: `packages/client/src/renderer/src/features/pipeline/components/PipelineRail.tsx`
- Create: `packages/client/src/renderer/src/features/pipeline/components/RunTheater.tsx`
- Create: `packages/client/src/renderer/src/features/pipeline/components/PipelineResultPanels.tsx`
- Modify: `packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx`

- [ ] **Step 1: Move existing panels first**

Move these existing functions unchanged into `PipelineResultPanels.tsx`:
- `PipelineLogDialog`
- `PipelineResultsPanel`
- `PipelineRunHistoryPanel`
- `PipelineItemsPanel`
- helper functions they directly use

Keep prop names identical so `FullTaskPage.tsx` only changes imports.

- [ ] **Step 2: Add controlled `PipelineRail`**

```tsx
import { Badge } from '@/components/ui/badge'
import type { PipelineRailViewModel } from '../pipeline-progress-view-model'

export function PipelineRail({
  view,
  selectedStage,
  onSelectStage,
}: {
  view: PipelineRailViewModel
  selectedStage: string | null
  onSelectStage: (stage: string) => void
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-5">
        {view.stages.map((stage) => (
          <button
            className="rounded-md border bg-background px-3 py-3 text-left"
            key={stage.key}
            onClick={() => onSelectStage(stage.key)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{stage.label}</span>
              {stage.issues > 0 ? <Badge variant="destructive">{stage.issues}</Badge> : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {stage.counts.done}/{stage.counts.total}
              {stage.counts.failed ? ` · 失败 ${stage.counts.failed}` : ''}
              {stage.counts.blocked ? ` · 拦截 ${stage.counts.blocked}` : ''}
            </p>
            {selectedStage === stage.key ? (
              <div className="mt-2 h-1 rounded-full bg-primary" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add `RunTheater` as a thin composition layer**

`RunTheater` receives `railView`, `progress`, `selectedStage`, `onSelectStage`, and reuses `PipelineResultsPanel`, `PipelineItemsPanel`, and `PipelineLogDialog`.

- [ ] **Step 4: Wire rail into `FullTaskPage.tsx`**

Use `buildPipelineRailViewModel` with current `progress`, `validationIssues`, and effective stage toggles. Keep the old warning list visible for this commit if needed; remove it only after E2E confirms the rail covers missing config.

- [ ] **Step 5: Validate**

Run:

```powershell
pnpm -F @tengyu-aipod/client type-check
pnpm -F @tengyu-aipod/client e2e -- e2e/pipeline-comfyui.spec.ts
```

Then run a manual UI smoke with `pnpm dev` and the existing stage0 mock environment:
- open complete task page
- confirm rail config state renders
- start one mock complete task
- confirm multiple stages can show activity
- cancel once

- [ ] **Step 6: Commit**

```powershell
git add -- 'packages/client/src/renderer/src/features/pipeline'
git commit -m "refactor(client): split pipeline page components"
```

---

## Task 6: Split Settings Page Without UX Changes

**Files:**
- Create: `packages/client/src/renderer/src/features/settings/types.ts`
- Create: `packages/client/src/renderer/src/features/settings/useSettingsPageModel.ts`
- Create: `packages/client/src/renderer/src/features/settings/components/WorkspaceSettingsCard.tsx`
- Create: `packages/client/src/renderer/src/features/settings/components/LogsSettingsCard.tsx`
- Move existing card components under `packages/client/src/renderer/src/features/settings/components/`
- Modify: `packages/client/src/renderer/src/features/settings/SettingsPage.tsx`

- [ ] **Step 1: Move pure helpers to `types.ts` or model module**

Move these unchanged:
- `selectPreferredGpu`
- `parseTags`
- `errorMessage`
- `formatLogBytes`
- `delay`

- [ ] **Step 2: Move card components unchanged**

Move existing card functions into separate files:
- `ConnectionCard.tsx`
- `GenerationLocalSettingsCard.tsx`
- `SkillSyncCard.tsx`
- `LocalWorkflowCard.tsx`
- `InstanceManagementCard.tsx`
- `AdvancedSettings.tsx`

- [ ] **Step 3: Extract `useSettingsPageModel`**

Move page state and functions from `SettingsPage` into the hook. Hook return shape:

```ts
export type SettingsPageModel = {
  state: {
    activeSettingsTab: 'general' | 'chenyu'
    workspace: WorkspaceState | null
    workspaceDraft: string
    message: string | null
    error: string | null
  }
  actions: {
    setActiveSettingsTab: (tab: 'general' | 'chenyu') => void
    chooseWorkspaceRoot: () => Promise<void>
    saveWorkspaceRoot: () => Promise<void>
    openLogsDirectory: () => Promise<void>
    exportLogsZip: () => Promise<void>
    deleteAllLogs: () => Promise<void>
  }
}
```

Add remaining existing settings state to `state` and existing callbacks to `actions`; do not rename UI-facing behavior in this commit.

- [ ] **Step 4: Keep `SettingsPage.tsx` as render-only composition**

`SettingsPage` should:
- call `useSettingsPageModel({ onWorkspaceSaved })`
- render tabs
- render moved cards
- render delete/destroy dialogs

- [ ] **Step 5: Validate**

Run:

```powershell
pnpm -F @tengyu-aipod/client type-check
pnpm -F @tengyu-aipod/client e2e -- e2e/workspace-settings.spec.ts
```

Manual UI smoke:
- open settings
- save workspace path in mock workbench
- open logs directory
- export logs zip
- switch to Chenyu tab and verify instance list area still renders

- [ ] **Step 6: Commit**

```powershell
git add -- 'packages/client/src/renderer/src/features/settings'
git commit -m "refactor(client): split settings page"
```

---

## Task 7: Move IPC API Types To Shared Incrementally

**Files:**
- Create: `packages/shared/src/client-api.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/client/src/preload/api.ts`
- Modify: `packages/client/src/preload/index.ts`
- Modify: `packages/client/src/renderer/src/vite-env.d.ts`

- [ ] **Step 1: Add shared response helpers**

```ts
export type IpcOk<TData> = { ok: true; data: TData }
export type IpcFail = { ok: false; error: { code: string; message: string } }
export type IpcResult<TData> = IpcOk<TData> | IpcFail
```

- [ ] **Step 2: Add `ClientApi` for shared-only modules first**

Start with modules whose public types already live in shared:

```ts
import type {
  ListingItem,
  ListingProgress,
  ListingTaskInput,
  ListingTaskRecord,
  ListingTaskStatus,
  ListingTemplateConfig,
  ListingWorkspaceInput,
  ListingWorkspaceRecord,
  ListingWorkspaceStatus,
  PipelineProgress,
  PipelineRunConfig,
  PipelineRunDetail,
  PipelineRunRecord,
  PipelineTaskEvent,
  Skill,
  SkillSummary,
} from './types'

export type ClientApi = {
  ping: () => Promise<string>
  skill: {
    list: (filter?: {
      module?: 'generation' | 'detection' | 'title'
      category?: string
      platform?: string
      language?: string
    }) => Promise<SkillSummary[]>
    get: (input: { id: string; version?: string }) => Promise<Skill>
    refresh: () => Promise<{ ok: true; count: number } | { ok: false; count: number; error: string }>
  }
  pipeline: {
    run: (input: PipelineRunConfig) => Promise<string>
    resume: (input: { run_id: string }) => Promise<string>
    cancel: (input: { run_id: string }) => Promise<{ ok: boolean }>
    listRuns: () => Promise<PipelineRunRecord[]>
    getRun: (input: { run_id: string }) => Promise<PipelineRunDetail | null>
    onProgress: (callback: (progress: PipelineProgress) => void) => () => void
    onCompleted: (callback: (event: PipelineTaskEvent) => void) => () => void
  }
  listing: {
    listTemplates: () => Promise<ListingTemplateConfig[]>
    listSavedWorkspaces: () => Promise<ListingWorkspaceRecord[]>
    saveWorkspace: (input: ListingWorkspaceInput) => Promise<ListingWorkspaceRecord>
    updateWorkspaceStatus: (input: {
      workspaceId: string
      status: ListingWorkspaceStatus
      currentTaskId: string | null
    }) => Promise<ListingWorkspaceRecord | null>
    listTasks: (input?: {
      workspaceId?: string
      status?: ListingTaskStatus
    }) => Promise<ListingTaskRecord[]>
    createTask: (input: ListingTaskInput) => Promise<ListingTaskRecord>
    onProgress: (callback: (progress: ListingProgress) => void) => () => void
    run: (input: { config: unknown; items: ListingItem[] }) => Promise<string>
  }
}
```

Do not add modules that still require importing from `packages/client/src/main`. Move their DTOs to shared in later commits.

- [ ] **Step 3: Export shared API type**

In `packages/shared/src/index.ts`:

```ts
export type { ClientApi, IpcFail, IpcOk, IpcResult } from './client-api'
```

- [ ] **Step 4: Split preload implementation**

Move current `const api = { ... }` from `preload/index.ts` to `preload/api.ts`. At the end of `api.ts`:

```ts
import type { ClientApi } from '@tengyu-aipod/shared'

export const api = {
  // existing implementation
} satisfies Partial<ClientApi> & Record<string, unknown>
```

Use `Partial<ClientApi>` only for the first commit because not every module is migrated yet.

- [ ] **Step 5: Use shared type in `vite-env.d.ts`**

Replace the duplicated Window declaration with:

```ts
/// <reference types="vite/client" />

import type { ClientApi } from '@tengyu-aipod/shared'

declare global {
  interface Window {
    api: ClientApi & typeof import('../../preload/api').api
  }
}
```

- [ ] **Step 6: Validate**

Run:

```powershell
pnpm type-check
pnpm -F @tengyu-aipod/client exec vitest run src/renderer/src/lib/use-ipc.test.ts
```

- [ ] **Step 7: Commit**

```powershell
git add -- 'packages/shared/src/client-api.ts' 'packages/shared/src/index.ts' 'packages/client/src/preload/index.ts' 'packages/client/src/preload/api.ts' 'packages/client/src/renderer/src/vite-env.d.ts'
git commit -m "refactor(client): share ipc api types"
```

---

## Task 8: Tokenize Theme And Remove Shell Glow

**Files:**
- Modify: `packages/client/src/renderer/src/index.css`
- Modify: `packages/client/src/renderer/src/layout/Header.tsx`
- Modify: `packages/client/src/renderer/src/layout/Sidebar.tsx`
- Modify: `packages/client/src/renderer/src/components/ui/button.tsx`
- Modify: `packages/client/src/renderer/src/components/ui/card.tsx`
- Modify: `packages/client/src/renderer/src/components/ui/input.tsx`
- Modify: `packages/client/src/renderer/src/components/ui/select.tsx`
- Modify: `packages/client/src/renderer/src/components/ui/tabs.tsx`
- Modify: `packages/client/src/renderer/src/components/ui/textarea.tsx`

- [ ] **Step 1: Replace shell background with token surface**

In `index.css`, replace `.workbench-shell`, `::before`, and `::after` with:

```css
.workbench-shell {
  position: relative;
  background: hsl(var(--background));
}
```

- [ ] **Step 2: Remove image/glow header**

In `Header.tsx`, remove `moduleVisual` usage and replace the banner with a compact header:

```tsx
export function Header({ module, rightSlot }: HeaderProps) {
  return (
    <header className="border-b bg-background px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-normal">{module.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
        </div>
        {rightSlot}
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Remove Sidebar gradients and Sparkles-as-decoration**

Keep module icons but replace active class with:

```ts
const activeClassName = 'bg-primary text-primary-foreground'
const inactiveClassName = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
```

Remove glow shadows and `border-white/70`.

- [ ] **Step 4: Normalize primitives**

Use these base styles:
- `Card`: `rounded-md border bg-card text-card-foreground shadow-sm`
- default `Button`: `bg-primary text-primary-foreground shadow-sm hover:bg-primary/90`
- `Input`, `SelectTrigger`, `Textarea`: `border-input bg-background shadow-sm`
- active `TabsTrigger`: `data-[state=active]:bg-background data-[state=active]:shadow-sm`

- [ ] **Step 5: Validate theme script and UI**

Run:

```powershell
pnpm -F @tengyu-aipod/client check:theme
pnpm -F @tengyu-aipod/client type-check
pnpm -F @tengyu-aipod/client e2e -- e2e/workspace-settings.spec.ts e2e/tutorial.spec.ts e2e/pipeline-comfyui.spec.ts
```

Manual screenshots under `pnpm dev`:
- collection page
- complete task page
- settings general tab
- settings Chenyu tab
- login page

- [ ] **Step 6: Commit**

```powershell
git add -- 'packages/client/src/renderer/src/index.css' 'packages/client/src/renderer/src/layout' 'packages/client/src/renderer/src/components/ui'
git commit -m "refactor(client): tokenize workbench theme"
```

---

## Task 9: Full Gate And P3 Baseline

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add P3 start entry**

Add a top entry:

```markdown
### P3 预备

- 拆分 P3 为路由壳、完整任务页、设置页、IPC 类型、主题 token、自动更新与 selector 热修 ADR 六条独立轨道。
- 明确自动更新和 selector 热修必须先走 ADR-0017，不在 UI 拆分提交中顺手实现。
```

- [ ] **Step 2: Run full gate**

```powershell
pnpm type-check
pnpm lint
pnpm -F @tengyu-aipod/client test
pnpm -F @tengyu-aipod/client e2e
```

Expected:
- type-check passes
- lint passes
- client tests pass
- E2E baseline remains 18 passed with existing skips

- [ ] **Step 3: Commit**

```powershell
git add -- 'CHANGELOG.md'
git commit -m "docs(client): record p3 baseline"
```

---

## Execution Notes

- Keep pure movement commits separate from logic commits.
- For `FullTaskPage.tsx`, prefer extraction order: validation → progress view model → existing panels → new rail.
- For `SettingsPage.tsx`, prefer extraction order: existing card components → hook/model → tab composition.
- For `App.tsx`, do not move collection/title controller state until route shell extraction is green.
- Listing code changes require ADR-0004 and ADR-0014 checks before editing.
- Any visual task requires `pnpm dev` screenshot review; tests alone are not enough.

## Final Verification Matrix

- Route shell: `pnpm -F @tengyu-aipod/client e2e -- e2e/workspace-settings.spec.ts e2e/tutorial.spec.ts`
- Pipeline page: `pnpm -F @tengyu-aipod/client e2e -- e2e/pipeline-comfyui.spec.ts`
- Settings page: `pnpm -F @tengyu-aipod/client e2e -- e2e/workspace-settings.spec.ts`
- IPC typing: `pnpm type-check` and `pnpm -F @tengyu-aipod/client exec vitest run src/renderer/src/lib/use-ipc.test.ts`
- Theme: `pnpm -F @tengyu-aipod/client check:theme` plus screenshots
- Final: `pnpm type-check && pnpm lint && pnpm -F @tengyu-aipod/client test && pnpm -F @tengyu-aipod/client e2e`

## Self-Review

- Spec coverage: route/page split, FullTaskPage split, SettingsPage split, IPC shared typing, dark tokenization, auto update, and selector dispatch are all assigned to separate tasks.
- Boundary coverage: ADR-0003, ADR-0004, ADR-0014, ADR-0015 constraints are explicitly called out.
- Placeholder scan: no task uses placeholder markers; follow-up items are named with files and commands.
- Type consistency: `PipelineConfigStage`, `PipelineValidationIssue`, `PipelineRailViewModel`, and `ClientApi` are introduced before use.
