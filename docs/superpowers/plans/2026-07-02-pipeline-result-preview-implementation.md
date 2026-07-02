# Pipeline Result Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** Rebuild the complete-task result preview so it defaults to the current run's final artifacts, shows PS mockup folders as the primary visual result, and hides disabled/intermediate stages by default.

**Architecture:** Extend the existing `PipelineResultSection` data model with optional result groups for PS folder cards, then keep the renderer decision logic in small pure helper functions. The page remains inside `FullTaskPage.tsx`; do not introduce a global result-preview framework or change pipeline execution semantics.

**Tech Stack:** TypeScript strict mode, React 19, Electron renderer/main IPC types from `@tengyu-aipod/shared`, Vitest, existing Tailwind/shadcn-style UI primitives, lucide-react icons.

---

## Implementation Result

- Status: completed on 2026-07-02.
- Commits:
  - `d649d4d feat(shared): add pipeline result groups`
  - `8b8b8df feat(client): group pipeline photoshop results`
  - `4f44702 feat(client): derive pipeline result preview state`
  - `e96f4cb fix(client): align pipeline preview tests with shared types`
  - `fb2abe0 feat(client): redesign pipeline result preview`
  - `68b659d fix(client): polish pipeline result preview`
- Verification passed:
  - `pnpm -F @tengyu-aipod/client test -- src/renderer/src/features/pipeline/pipeline-result-preview.test.ts`
  - `pnpm -F @tengyu-aipod/client test -- src/main/lib/pipeline-service.test.ts`
  - `pnpm -F @tengyu-aipod/client type-check`
  - `pnpm -F @tengyu-aipod/client build`
  - Plan-scoped Biome check for the five touched files
  - Electron visual script with screenshots under `packages/client/output/playwright/`
- Known verification note: full `pnpm -F @tengyu-aipod/client lint` still fails because of pre-existing Biome format / CRLF diagnostics in unrelated files.

---

## Context And Constraints

Read these before editing:

- `AGENTS.md`
- `docs/CONTEXT.md`
- `docs/spec/01-orchestration.md`
- `docs/spec/05-photoshop.md`
- `docs/superpowers/specs/2026-07-02-pipeline-result-preview-design.md`

Important constraints:

- Do not change complete-task execution order.
- Do not change PS output folders on disk.
- Do not implement a generic orchestration engine.
- Do not touch unrelated Photoshop worktree changes unless required by the files in this plan.
- Existing dirty files may be present. Do not revert them.
- Manual edits should use `apply_patch`.

Recommended first commands:

```powershell
git status --short
Get-Content -LiteralPath 'docs\superpowers\specs\2026-07-02-pipeline-result-preview-design.md'
```

## File Structure

Modify:

- `packages/shared/src/types.ts`
  - Add `PipelineResultGroup`.
  - Add optional `groups?: PipelineResultGroup[]` to `PipelineResultSection`.

- `packages/client/src/main/lib/pipeline-stages/photoshop-stage.ts`
  - Build grouped PS result sections keyed by real `template_batch / sku_code`.
  - Keep `items` populated for backward compatibility and lightbox fallback.

- `packages/client/src/main/lib/pipeline-service.test.ts`
  - Add focused assertions that PS result sections include groups and do not merge the same SKU across templates.

- `packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.ts`
  - New pure helper module for choosing the final display section, deriving stats, and flattening lightbox items.

- `packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.test.ts`
  - New Vitest tests for final-section selection, dynamic stats, and group lightbox data.

- `packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx`
  - Replace the current `PipelineResultsPanel` internals.
  - Remove the “最近完整任务” card from render output.
  - Keep run loading logic and `recentRuns` state only if still needed elsewhere; otherwise remove unused state/imports caused by this change.

Do not modify:

- `docs/CONTEXT.md`, `docs/spec/*.md`, or ADRs for this UI-only implementation.
- `packages/client/src/main/photoshop/*` unless TypeScript errors prove it is necessary.

---

### Task 1: Shared Result Group Type

**Files:**
- Modify: `packages/shared/src/types.ts`

- [x] **Step 1: Add the shared type**

In `packages/shared/src/types.ts`, near `PipelineResultImage`, add:

```ts
export interface PipelineResultGroup {
  id: string
  label: string
  subtitle?: string
  kind: 'folder' | 'image-set'
  cover_path?: string
  folder_path?: string
  template_batch?: string
  sku_code?: string
  items: PipelineResultImage[]
}
```

Then change `PipelineResultSection` to:

```ts
export interface PipelineResultSection {
  key: PipelineResultSectionKey
  title: string
  total: number
  completed: number
  failed?: number
  collapsible: boolean
  default_collapsed?: boolean
  paginated: boolean
  items: PipelineResultImage[]
  groups?: PipelineResultGroup[]
}
```

- [x] **Step 2: Run type-check for shared consumers**

Run:

```powershell
pnpm -F @tengyu-aipod/client type-check
```

Expected: PASS, or only errors from unrelated dirty work. If there are errors caused by missing `groups` handling, fix them before continuing.

- [x] **Step 3: Commit**

```powershell
git add -- 'packages/shared/src/types.ts'
git commit -m "feat(shared): add pipeline result groups"
```

---

### Task 2: Build PS Result Groups In The Pipeline Stage

**Files:**
- Modify: `packages/client/src/main/lib/pipeline-stages/photoshop-stage.ts`
- Test: `packages/client/src/main/lib/pipeline-service.test.ts`

- [x] **Step 1: Write the failing pipeline service test**

In `packages/client/src/main/lib/pipeline-service.test.ts`, add a test near the existing PS pipeline tests. The test should configure two templates and assert that the `print_products` section has two groups for the same SKU across two templates.

Use this shape for the assertion:

```ts
it('exposes complete task photoshop outputs as template and sku result groups', async () => {
  const printFolder = join(mocks.workbenchRoot, 'prints')
  await mkdir(printFolder, { recursive: true })
  await writeFile(join(printFolder, 'seed.png'), 'seed')

  mocks.runBatch.mockImplementation(async (prints, templates, config) => {
    const templatePath = Array.isArray(templates) ? String(templates[0] ?? 'template.psd') : 'template.psd'
    const templateName = basename(templatePath, extname(templatePath))
    const sku = prints[0]?.id ?? 'SKU-001'
    const outputPath = join(config.outputRoot, templateName, sku, '01.jpg')
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, 'mockup')
    return {
      ok: true,
      task_id: config.taskId,
      output_layout: config.outputLayout,
      templates_total: 1,
      groups_total: 1,
      groups_completed: 1,
      outputs: [outputPath],
      templates: [
        {
          template_id: `tpl-${templateName}`,
          template_name: templateName,
          groups_total: 1,
          groups_completed: 1,
          outputs: [outputPath],
        },
      ],
      result_groups: [
        {
          template_id: `tpl-${templateName}`,
          template_name: templateName,
          group_index: 0,
          sku_folder: sku,
          print_ids: [sku],
          outputs: [outputPath],
          status: 'completed' as const,
        },
      ],
    }
  })

  const service = new PipelineService()
  await service.runPipeline('run-photoshop-groups', {
    ...baseConfig(printFolder),
    printSkuCode: 'GZKJ',
    source: existingPrintSource(printFolder, 'photoshop'),
    matting: { enabled: false },
    detection: { enabled: false },
    photoshop: {
      enabled: true,
      templates: ['C:\\mockups\\front.psd', 'C:\\mockups\\back.psd'],
      outputRoot: join(mocks.workbenchRoot, WORKBENCH_DIRECTORIES.listing),
      replaceRange: 'auto',
      clipMode: 'auto',
      format: 'jpg',
      skipCompleted: true,
      maxRetries: 1,
    },
    title: {
      ...baseConfig(printFolder).title,
      enabled: false,
    },
  })

  const progressEvents = mocks.sentEvents.filter((event) => event.channel === 'pipeline:progress')
  const lastProgress = progressEvents.at(-1)?.payload as
    | {
        result_sections?: Array<{
          key: string
          groups?: Array<{
            label: string
            template_batch?: string
            sku_code?: string
            cover_path?: string
            folder_path?: string
            items: Array<{ local_path?: string }>
          }>
        }>
      }
    | undefined
  const section = lastProgress?.result_sections?.find((item) => item.key === 'print_products')

  expect(section?.groups?.map((group) => group.label).sort()).toEqual([
    'back / GZKJ-0001',
    'front / GZKJ-0001',
  ])
  expect(section?.groups?.every((group) => group.items.length === 1)).toBe(true)
  expect(section?.groups?.every((group) => Boolean(group.cover_path))).toBe(true)
  expect(section?.groups?.every((group) => Boolean(group.folder_path))).toBe(true)
})
```

If helper names such as `baseConfig`, `existingPrintSource`, `mocks`, or imports already differ in the file, adapt only to existing local test helpers.

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm -F @tengyu-aipod/client test -- src/main/lib/pipeline-service.test.ts -t "exposes complete task photoshop outputs as template and sku result groups"
```

Expected: FAIL because `section.groups` is undefined.

- [x] **Step 3: Implement PS group construction**

In `packages/client/src/main/lib/pipeline-stages/photoshop-stage.ts`:

1. Import `dirname` from `node:path`.
2. Import `type PipelineResultGroup` from shared.
3. Replace the local `resultSection(items)` implementation with a version that accepts output groups.

Use this helper shape:

```ts
function buildResultGroup(group: PhotoshopResultGroup): PipelineResultGroup {
  const items = group.outputs.map((outputPath) => buildResultImage(group, outputPath))
  const coverPath = group.outputs[0]
  const folderPath = coverPath ? dirname(coverPath) : undefined
  return {
    id: `photoshop-group-${group.template_name}-${group.sku_folder}-${group.group_index}`,
    label: `${group.template_name} / ${group.sku_folder}`,
    subtitle: `${items.length} 张成品图`,
    kind: 'folder',
    ...(coverPath ? { cover_path: coverPath } : {}),
    ...(folderPath ? { folder_path: folderPath } : {}),
    template_batch: group.template_name,
    sku_code: group.sku_folder,
    items,
  }
}

function resultSection(input: {
  items: PipelineResultImage[]
  groups: PipelineResultGroup[]
  failed: number
}): PipelineResultSection {
  return {
    key: 'print_products',
    title: '套版成品',
    items: input.items,
    groups: input.groups,
    total: input.groups.length,
    completed: input.groups.length,
    failed: input.failed,
    collapsible: true,
    default_collapsed: false,
    paginated: true,
  }
}
```

Inside `createPhotoshopStage`, replace:

```ts
const outputItems: PipelineResultImage[] = []
```

with:

```ts
const outputItems: PipelineResultImage[] = []
const outputGroups: PipelineResultGroup[] = []
```

Update `refreshSection`:

```ts
const refreshSection = () => {
  dependencies.updateResultSection(
    context.runId,
    resultSection({ items: outputItems, groups: outputGroups, failed }),
  )
}
```

When a PS group succeeds, after `const group = result.result_groups[0]`, append:

```ts
const resultGroup = buildResultGroup(group)
outputGroups.push(resultGroup)
for (const outputPath of group.outputs) {
  outputItems.push(buildResultImage(group, outputPath))
}
```

Remove the old loop if it now duplicates `outputItems`.

- [x] **Step 4: Run focused test**

Run:

```powershell
pnpm -F @tengyu-aipod/client test -- src/main/lib/pipeline-service.test.ts -t "exposes complete task photoshop outputs as template and sku result groups"
```

Expected: PASS.

- [x] **Step 5: Run existing pipeline tests**

Run:

```powershell
pnpm -F @tengyu-aipod/client test -- src/main/lib/pipeline-service.test.ts
```

Expected: PASS. If unrelated tests fail because of pre-existing dirty Photoshop changes, record the exact failing test names in the final handoff and continue only if this task's new behavior is passing.

- [x] **Step 6: Commit**

```powershell
git add -- 'packages/client/src/main/lib/pipeline-stages/photoshop-stage.ts' 'packages/client/src/main/lib/pipeline-service.test.ts'
git commit -m "feat(client): group pipeline photoshop results"
```

---

### Task 3: Add Pure Renderer Helpers For Final Result Selection And Stats

**Files:**
- Create: `packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.ts`
- Create: `packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.test.ts`

- [x] **Step 1: Write tests first**

Create `packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.test.ts`:

```ts
import type {
  PipelineProgress,
  PipelineResultSection,
  PipelineRunConfig,
} from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import {
  finalPipelineResult,
  pipelineResultStats,
  sectionItemsForLightbox,
  sourceMetricLabel,
} from './pipeline-result-preview'

function section(input: Partial<PipelineResultSection> & Pick<PipelineResultSection, 'key'>): PipelineResultSection {
  return {
    title: input.title ?? input.key,
    total: input.total ?? input.items?.length ?? input.groups?.length ?? 0,
    completed: input.completed ?? input.items?.length ?? input.groups?.length ?? 0,
    collapsible: true,
    paginated: false,
    items: input.items ?? [],
    ...input,
  }
}

function config(input: Partial<PipelineRunConfig>): PipelineRunConfig {
  return {
    printMode: 'local',
    source: { mode: 'txt2img', provider: 'grsai', promptCount: 2 },
    matting: { enabled: false },
    detection: { enabled: false },
    photoshop: { enabled: false, templates: [] },
    title: { enabled: false },
    ...input,
  } as PipelineRunConfig
}

function progress(sections: PipelineResultSection[]): PipelineProgress {
  return {
    run_id: 'run-1',
    status: 'running',
    current_step: null,
    message: '',
    stats: {
      sourceImages: 0,
      prints: 2,
      detectionPass: 1,
      detectionReview: 1,
      detectionBlock: 1,
      photoshopGroups: 2,
      titleSucceeded: 1,
      titleFailed: 1,
    },
    steps: [],
    result_sections: sections,
  }
}

describe('pipeline result preview helpers', () => {
  it('prefers photoshop groups when photoshop is enabled', () => {
    const result = finalPipelineResult(
      config({ photoshop: { enabled: true, templates: ['front.psd'] } }),
      progress([
        section({
          key: 'image_processing',
          items: [{ id: 'print-1', status: 'success', step_key: 'source', label: 'print' }],
        }),
        section({
          key: 'print_products',
          groups: [
            {
              id: 'front-sku',
              label: 'front / GZKJ-0001',
              kind: 'folder',
              cover_path: 'C:\\out\\front\\GZKJ-0001\\01.jpg',
              folder_path: 'C:\\out\\front\\GZKJ-0001',
              items: [
                {
                  id: 'img-1',
                  status: 'success',
                  step_key: 'photoshop',
                  label: 'front / GZKJ-0001',
                  local_path: 'C:\\out\\front\\GZKJ-0001\\01.jpg',
                },
              ],
            },
          ],
        }),
      ]),
    )

    expect(result?.mode).toBe('groups')
    expect(result?.section.key).toBe('print_products')
  })

  it('falls back to detection passed results when photoshop is disabled and detection is enabled', () => {
    const result = finalPipelineResult(
      config({ detection: { enabled: true } }),
      progress([
        section({
          key: 'image_processing',
          items: [{ id: 'print-1', status: 'success', step_key: 'source', label: 'print' }],
        }),
        section({
          key: 'detection_passed',
          items: [{ id: 'pass-1', status: 'success', step_key: 'detection', label: 'pass' }],
        }),
      ]),
    )

    expect(result?.mode).toBe('images')
    expect(result?.section.key).toBe('detection_passed')
  })

  it('does not emit stats for disabled stages', () => {
    const stats = pipelineResultStats(
      config({
        source: { mode: 'img2img', provider: 'grsai', promptCount: 2 },
        matting: { enabled: false },
        detection: { enabled: false },
        photoshop: { enabled: true, templates: ['front.psd'] },
        title: { enabled: false },
      }),
      progress([]),
    )

    expect(stats.map((item) => item.key)).toEqual(['source', 'photoshop'])
    expect(stats[0]).toMatchObject({ label: '图生图产出', value: '2' })
  })

  it('labels source metric by source mode', () => {
    expect(sourceMetricLabel(config({ source: { mode: 'txt2img', provider: 'grsai', promptCount: 1 } }))).toBe('文生图产出')
    expect(sourceMetricLabel(config({ source: { mode: 'img2img', provider: 'grsai', promptCount: 1 } }))).toBe('图生图产出')
    expect(sourceMetricLabel(config({ source: { mode: 'collection', folder: 'C:\\source', extractProvider: 'grsai' } }))).toBe('提取印花')
    expect(sourceMetricLabel(config({ source: { mode: 'existing_prints', folder: 'C:\\prints', startStep: 'photoshop' } }))).toBe('已有印花')
  })

  it('flattens group items for lightbox', () => {
    const items = sectionItemsForLightbox(
      section({
        key: 'print_products',
        groups: [
          {
            id: 'group-1',
            label: 'front / SKU',
            kind: 'folder',
            items: [
              { id: 'img-1', status: 'success', step_key: 'photoshop', label: '01', local_path: 'C:\\a.jpg' },
            ],
          },
        ],
      }),
    )

    expect(items).toEqual([
      { id: 'img-1', status: 'success', step_key: 'photoshop', label: '01', local_path: 'C:\\a.jpg' },
    ])
  })
})
```

- [x] **Step 2: Run tests to verify failure**

Run:

```powershell
pnpm -F @tengyu-aipod/client test -- src/renderer/src/features/pipeline/pipeline-result-preview.test.ts
```

Expected: FAIL because the helper module does not exist.

- [x] **Step 3: Implement helper module**

Create `packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.ts`:

```ts
import type {
  PipelineProgress,
  PipelineResultImage,
  PipelineResultSection,
  PipelineRunConfig,
} from '@tengyu-aipod/shared'

export type PipelineFinalResult =
  | { mode: 'groups'; section: PipelineResultSection }
  | { mode: 'images'; section: PipelineResultSection }

export type PipelineResultStat = {
  key: 'source' | 'matting' | 'detection' | 'photoshop' | 'title'
  label: string
  value: string
  detail: string
}

const FINAL_SECTION_BY_PRIORITY: Array<PipelineResultSection['key']> = [
  'print_products',
  'detection_passed',
  'image_processing',
  'source_images',
  'reference_images',
]

export function sourceMetricLabel(config: PipelineRunConfig) {
  if (config.source.mode === 'txt2img') {
    return '文生图产出'
  }
  if (config.source.mode === 'img2img') {
    return '图生图产出'
  }
  if (config.source.mode === 'collection') {
    return '提取印花'
  }
  return '已有印花'
}

function findSection(
  progress: PipelineProgress | null,
  key: PipelineResultSection['key'],
): PipelineResultSection | null {
  return progress?.result_sections?.find((section) => section.key === key) ?? null
}

function hasSuccessfulItems(section: PipelineResultSection | null) {
  return Boolean(section?.items.some((item) => item.status === 'success'))
}

function hasGroups(section: PipelineResultSection | null) {
  return Boolean(section?.groups?.length)
}

export function finalPipelineResult(
  config: PipelineRunConfig,
  progress: PipelineProgress | null,
): PipelineFinalResult | null {
  const printProducts = findSection(progress, 'print_products')
  if (config.photoshop.enabled && hasGroups(printProducts)) {
    return { mode: 'groups', section: printProducts! }
  }
  if (config.photoshop.enabled && hasSuccessfulItems(printProducts)) {
    return { mode: 'images', section: printProducts! }
  }

  if (config.detection.enabled) {
    const detectionPassed = findSection(progress, 'detection_passed')
    if (hasSuccessfulItems(detectionPassed)) {
      return { mode: 'images', section: detectionPassed! }
    }
  }

  for (const key of FINAL_SECTION_BY_PRIORITY) {
    const section = findSection(progress, key)
    if (hasGroups(section)) {
      return { mode: 'groups', section: section! }
    }
    if (hasSuccessfulItems(section)) {
      return { mode: 'images', section: section! }
    }
  }

  return null
}

export function sectionItemsForLightbox(section: PipelineResultSection): PipelineResultImage[] {
  if (section.groups?.length) {
    return section.groups.flatMap((group) => group.items)
  }
  return section.items
}

export function pipelineResultStats(
  config: PipelineRunConfig,
  progress: PipelineProgress | null,
): PipelineResultStat[] {
  const stats = progress?.stats
  const sourceValue = String(stats?.prints || stats?.sourceImages || 0)
  const result: PipelineResultStat[] = [
    {
      key: 'source',
      label: sourceMetricLabel(config),
      value: sourceValue,
      detail: '当前起点产物',
    },
  ]

  if (config.matting.enabled) {
    const mattingSection = findSection(progress, 'image_processing')
    result.push({
      key: 'matting',
      label: '抠图',
      value: String(mattingSection?.completed ?? 0),
      detail: mattingSection?.failed ? `失败 ${mattingSection.failed}` : '已完成抠图',
    })
  }

  if (config.detection.enabled) {
    result.push({
      key: 'detection',
      label: '侵权检测',
      value: `${stats?.detectionPass ?? 0} / ${stats?.detectionReview ?? 0} / ${
        stats?.detectionBlock ?? 0
      }`,
      detail: '通过 / 疑似 / 拦截',
    })
  }

  if (config.photoshop.enabled) {
    const printProducts = findSection(progress, 'print_products')
    const folderCount = printProducts?.groups?.length ?? stats?.photoshopGroups ?? 0
    const imageCount = printProducts?.items.filter((item) => item.status === 'success').length ?? 0
    result.push({
      key: 'photoshop',
      label: 'PS 套版',
      value: String(imageCount || folderCount),
      detail: `${folderCount} 个文件夹`,
    })
  }

  if (config.title.enabled) {
    result.push({
      key: 'title',
      label: '标题',
      value: String(stats?.titleSucceeded ?? 0),
      detail: stats?.titleFailed ? `失败 ${stats.titleFailed}` : '已生成标题',
    })
  }

  return result
}
```

- [x] **Step 4: Run helper tests**

Run:

```powershell
pnpm -F @tengyu-aipod/client test -- src/renderer/src/features/pipeline/pipeline-result-preview.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add -- 'packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.ts' 'packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.test.ts'
git commit -m "feat(client): derive pipeline result preview state"
```

---

### Task 4: Rebuild `PipelineResultsPanel` UI And Remove Recent Runs Card

**Files:**
- Modify: `packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx`

- [x] **Step 1: Import helper functions and icons**

In `FullTaskPage.tsx`, add imports:

```ts
import {
  finalPipelineResult,
  pipelineResultStats,
  sectionItemsForLightbox,
} from '@/features/pipeline/pipeline-result-preview'
```

Add lucide icons if not already present:

```ts
Folder,
ImageIcon,
Sparkles,
```

If `Folder` conflicts with an existing name, import as `FolderIcon`.

- [x] **Step 2: Change `PipelineResultsPanel` props**

Current props are:

```ts
function PipelineResultsPanel({
  message,
  progress,
}: {
  message: string
  progress: PipelineProgress | null
}) {
```

Change to:

```ts
function PipelineResultsPanel({
  config,
  message,
  progress,
}: {
  config: PipelineRunConfig
  message: string
  progress: PipelineProgress | null
}) {
```

- [x] **Step 3: Replace result panel state logic**

Inside `PipelineResultsPanel`, keep `collapsed`, `pages`, and `lightbox`. Add:

```ts
const finalResult = finalPipelineResult(config, progress)
const stats = pipelineResultStats(config, progress)
const selectedSection = finalResult?.section ?? null
const firstGroup = selectedSection?.groups?.[0] ?? null
const firstImage =
  selectedSection?.items.find((item) => item.status === 'success' && pipelineResultImageSrc(item)) ??
  null
const heroImagePath = firstGroup?.cover_path ?? firstImage?.local_path ?? firstImage?.url ?? null
const heroTitle = firstGroup?.label ?? firstImage?.label ?? '等待结果'
const heroSubtitle =
  firstGroup?.subtitle ??
  (selectedSection ? `${selectedSection.completed}/${selectedSection.total}` : message)
```

Update `openLightbox` so it handles groups:

```ts
function openLightbox(section: PipelineResultSection, image: PipelineResultImage) {
  const sectionItems = sectionItemsForLightbox(section)
  const items = sectionItems
    .filter((item) => item.status === 'success' && pipelineResultImageSrc(item))
    .map(pipelineResultLightboxItem)
  const index = sectionItems
    .filter((item) => item.status === 'success' && pipelineResultImageSrc(item))
    .findIndex((item) => item.id === image.id)
  setLightbox({ title: section.title, items, index: Math.max(0, index) })
}
```

Add a group click helper:

```ts
function openGroup(section: PipelineResultSection, groupIndex: number) {
  const group = section.groups?.[groupIndex]
  if (!group) {
    return
  }
  const items = group.items
    .filter((item) => item.status === 'success' && pipelineResultImageSrc(item))
    .map(pipelineResultLightboxItem)
  setLightbox({ title: group.label, items, index: 0 })
}
```

- [x] **Step 4: Replace the JSX returned by `PipelineResultsPanel`**

Replace the current `<Card>...</Card>` body with this structure, adapting class names only when necessary to match existing style:

```tsx
return (
  <Card className="overflow-hidden">
    <CardHeader className="border-b bg-gradient-to-r from-blue-50 via-slate-50 to-emerald-50 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg text-balance">结果预览</CardTitle>
          <CardDescription>{message}</CardDescription>
        </div>
        <Badge variant="secondary">{progress?.status ?? '未启动'}</Badge>
      </div>
    </CardHeader>

    <CardContent className="space-y-4 p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="relative min-h-[360px] overflow-hidden rounded-md border bg-slate-950">
          {heroImagePath ? (
            <img
              alt={heroTitle}
              className="h-full min-h-[360px] w-full object-cover"
              src={heroImagePath.startsWith('file://') ? heroImagePath : `file://${heroImagePath}`}
            />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center bg-muted text-sm text-muted-foreground">
              启动完整任务后，这里会展示当前最终产物。
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent p-4 text-white">
            <div className="text-xl font-semibold">{heroTitle}</div>
            <div className="mt-1 text-sm text-white/70">{heroSubtitle}</div>
          </div>
        </div>

        <div className="rounded-md border bg-background p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">
                {finalResult?.mode === 'groups' ? '套版后文件夹' : '最终产物'}
              </div>
              <div className="text-xs text-muted-foreground">
                {finalResult?.mode === 'groups'
                  ? '生成一套显示一套，点击查看全部裁剪图。'
                  : '展示当前任务最后阶段的产物。'}
              </div>
            </div>
            <Badge variant="outline">
              {selectedSection?.groups?.length ?? selectedSection?.completed ?? 0}
            </Badge>
          </div>

          {selectedSection?.groups?.length ? (
            <div className="grid max-h-[430px] grid-cols-2 gap-3 overflow-y-auto pr-1">
              {selectedSection.groups.map((group, index) => (
                <button
                  className="min-w-0 rounded-md border bg-muted/20 p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  key={group.id}
                  onClick={() => openGroup(selectedSection, index)}
                  type="button"
                >
                  {group.cover_path ? (
                    <img
                      alt={group.label}
                      className="aspect-[4/3] w-full rounded-sm bg-muted object-cover"
                      src={`file://${group.cover_path}`}
                    />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center rounded-sm bg-muted text-muted-foreground">
                      <FolderOpen className="size-5" />
                    </div>
                  )}
                  <div className="mt-2 truncate text-xs font-medium">{group.label}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {group.subtitle ?? `${group.items.length} 张`}
                  </div>
                </button>
              ))}
            </div>
          ) : selectedSection?.items.length ? (
            <div className="grid max-h-[430px] grid-cols-2 gap-3 overflow-y-auto pr-1">
              {selectedSection.items
                .filter((item) => item.status === 'success')
                .map((image) => (
                  <button
                    className="min-w-0 rounded-md border bg-muted/20 p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    key={image.id}
                    onClick={() => openLightbox(selectedSection, image)}
                    type="button"
                  >
                    <img
                      alt={image.label}
                      className="aspect-[4/3] w-full rounded-sm bg-muted object-cover"
                      src={pipelineResultImageSrc(image)}
                    />
                    <div className="mt-2 truncate text-xs font-medium">{image.label}</div>
                  </button>
                ))}
            </div>
          ) : (
            <div className="flex min-h-[280px] items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
              等待结果
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {stats.map((item) => (
          <div className="rounded-md border bg-background p-3" key={item.key}>
            <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
          </div>
        ))}
      </div>

      {sections.length ? (
        <div className="space-y-3">
          {sections
            .filter((section) => section.key !== selectedSection?.key)
            .map((section) => {
              const isCollapsed = collapsed[section.key] ?? section.default_collapsed ?? true
              const pageSize = 12
              const maxPage = Math.max(0, Math.ceil(section.items.length / pageSize) - 1)
              const page = Math.min(pages[section.key] ?? 0, maxPage)
              const visibleItems = section.paginated
                ? section.items.slice(page * pageSize, page * pageSize + pageSize)
                : section.items
              return (
                <section className="rounded-md border bg-background p-4" key={section.key}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      className="flex min-w-0 items-center gap-2 text-left"
                      onClick={() => toggleSection(section.key)}
                      type="button"
                    >
                      <ChevronDown
                        className={`size-4 shrink-0 transition-transform ${
                          isCollapsed ? '-rotate-90' : ''
                        }`}
                      />
                      <span className="truncate font-semibold">{section.title}</span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {section.completed}/{section.total}
                      </span>
                      {section.failed ? (
                        <span className="text-sm tabular-nums text-muted-foreground">
                          失败 {section.failed}
                        </span>
                      ) : null}
                    </button>
                    {section.paginated && !isCollapsed ? (
                      <div className="flex items-center gap-2">
                        <Button
                          aria-label="上一页"
                          className="size-8 p-0"
                          disabled={page === 0}
                          onClick={() => updatePage(section.key, -1, maxPage)}
                          type="button"
                          variant="outline"
                        >
                          <ChevronLeft className="size-4" />
                        </Button>
                        <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
                          {page + 1}/{maxPage + 1}
                        </span>
                        <Button
                          aria-label="下一页"
                          className="size-8 p-0"
                          disabled={page >= maxPage}
                          onClick={() => updatePage(section.key, 1, maxPage)}
                          type="button"
                          variant="outline"
                        >
                          <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {isCollapsed ? null : visibleItems.length ? (
                    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                      {visibleItems.map((image) =>
                        image.status === 'loading' ? (
                          <div
                            className="flex aspect-square items-center justify-center rounded-md border border-dashed bg-muted/30 text-sm text-muted-foreground"
                            key={image.id}
                          >
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            图像加载中
                          </div>
                        ) : (
                          <button
                            className="min-w-0 rounded-md border bg-muted/20 p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                            key={image.id}
                            onClick={() => openLightbox(section, image)}
                            type="button"
                          >
                            <img
                              alt={image.label}
                              className="aspect-square w-full rounded-sm bg-muted object-cover"
                              src={pipelineResultImageSrc(image)}
                            />
                            <div className="mt-2 truncate text-xs font-medium">{image.label}</div>
                            {image.risk_level ? (
                              <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                                风险值 {image.risk_score ?? '-'}
                              </div>
                            ) : null}
                          </button>
                        ),
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
                      等待结果
                    </div>
                  )}
                </section>
              )
            })}
        </div>
      ) : null}
    </CardContent>

    <ImageLightbox
      activeIndex={lightbox?.index ?? null}
      items={lightbox?.items ?? []}
      onActiveIndexChange={(index) =>
        setLightbox((current) => {
          if (!current || index === null) {
            return null
          }
          return { ...current, index }
        })
      }
      title={lightbox?.title ?? '图片预览'}
    />
  </Card>
)
```

Keep these existing behaviors:

- Section collapse toggle.
- Pagination buttons for paginated sections.
- Loading placeholders.
- Risk score display for detection result images.

- [x] **Step 5: Fix image source helper use for raw file paths**

If TypeScript complains about `heroImagePath`, add a local helper inside `FullTaskPage.tsx`:

```ts
function localImageSrc(pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) {
    return undefined
  }
  if (/^(?:file|https?):\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }
  return `file://${pathOrUrl.replace(/\\/g, '/')}`
}
```

Then replace raw `file://` string construction with `localImageSrc(...)`.

- [x] **Step 6: Pass current config into `PipelineResultsPanel`**

Near the bottom of `FullTaskPage`, find:

```tsx
<PipelineResultsPanel message={message} progress={progress} />
```

Change to:

```tsx
<PipelineResultsPanel config={buildConfig()} message={message} progress={progress} />
```

If `buildConfig()` is expensive or throws before validation, create:

```ts
const previewConfig = useMemo(() => buildConfig(), [/* use the same dependencies already used by buildConfig inputs */])
```

Only use `useMemo` if the direct call causes a problem. Prefer the direct call if it compiles and behaves.

- [x] **Step 7: Remove the recent runs card**

Delete this whole block from the render output:

```tsx
<Card>
  <CardHeader className="pb-4">
    <CardTitle className="text-base">最近完整任务</CardTitle>
  </CardHeader>
  <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
    ...
  </CardContent>
</Card>
```

Then remove unused `recentRuns` state/effects only if TypeScript reports they are unused. Do not remove `pipeline:list-runs` IPC or service methods.

- [x] **Step 8: Type-check**

Run:

```powershell
pnpm -F @tengyu-aipod/client type-check
```

Expected: PASS.

- [x] **Step 9: Commit**

```powershell
git add -- 'packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx'
git commit -m "feat(client): redesign pipeline result preview"
```

---

### Task 5: Verification And Visual QA

**Files:**
- May modify: files touched in previous tasks only, if verification finds issues.

- [x] **Step 1: Run focused tests**

Run:

```powershell
pnpm -F @tengyu-aipod/client test -- src/renderer/src/features/pipeline/pipeline-result-preview.test.ts
pnpm -F @tengyu-aipod/client test -- src/main/lib/pipeline-service.test.ts
```

Expected: PASS.

- [x] **Step 2: Run type-check**

Run:

```powershell
pnpm -F @tengyu-aipod/client type-check
```

Expected: PASS.

- [x] **Step 3: Run lint**

Run:

```powershell
pnpm -F @tengyu-aipod/client lint
```

Expected: PASS. If Biome only complains about formatting in files you changed, run:

```powershell
pnpm -F @tengyu-aipod/client exec biome check --write src/renderer/src/features/pipeline/FullTaskPage.tsx src/renderer/src/features/pipeline/pipeline-result-preview.ts src/renderer/src/features/pipeline/pipeline-result-preview.test.ts src/main/lib/pipeline-stages/photoshop-stage.ts src/main/lib/pipeline-service.test.ts
```

Then rerun lint.

- [x] **Step 4: Start the app for visual inspection**

Run:

```powershell
pnpm -F @tengyu-aipod/client dev
```

Open the Electron window and inspect the complete-task page:

- “最近完整任务” is gone.
- Result preview occupies the space.
- Empty state text fits and does not overlap.
- Stats footer only shows enabled stages.
- No nested cards inside cards beyond the existing top-level `Card`.
- Text in folder/image cards truncates cleanly.

- [x] **Step 5: Optional browser/screenshot verification**

If Playwright or the in-app browser is available in the implementation terminal, capture desktop-sized and narrow viewport screenshots of the complete-task page. Verify:

- No overlap at 1365px width.
- No overlap at narrow/mobile-ish width if the Electron layout can be resized.
- Hero preview and final grid do not render blank when sample `file://` image paths exist.

- [x] **Step 6: Final commit**

If verification required fixes:

```powershell
git add -- 'packages/shared/src/types.ts' 'packages/client/src/main/lib/pipeline-stages/photoshop-stage.ts' 'packages/client/src/main/lib/pipeline-service.test.ts' 'packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.ts' 'packages/client/src/renderer/src/features/pipeline/pipeline-result-preview.test.ts' 'packages/client/src/renderer/src/features/pipeline/FullTaskPage.tsx'
git commit -m "fix(client): polish pipeline result preview"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

Before handing back:

- [x] The design spec requirements are covered:
  - [x] Recent runs card removed.
  - [x] PS enabled defaults to grouped `template_batch / sku_code` cards.
  - [x] PS disabled falls back to final produced stage.
  - [x] Disabled stages do not show stat cards.
  - [x] Intermediate sections are collapsed by default.
  - [x] Group click opens all cropped images in that real folder group.
- [x] No placeholder comments remain in `FullTaskPage.tsx`.
- [x] No `any`, `as any`, or `@ts-ignore` introduced.
- [x] No unrelated Photoshop module changes were reverted.
- [x] Tests and type-check results are recorded in the final response.

## Final Handoff Format

When implementation is complete, report:

```text
Implemented:
- ...

Verification:
- pnpm -F @tengyu-aipod/client test -- ...
- pnpm -F @tengyu-aipod/client type-check
- pnpm -F @tengyu-aipod/client lint

Notes:
- Any skipped verification or pre-existing dirty worktree risk.
```
