import { fileUrlLocalPath, localImageUrl } from '@/lib/media'
import type { GenerationCapability, SkillSummary, SkillVariable } from '@tengyu-aipod/shared'
import type { ComfyuiWorkflowSummary } from '../../../../../main/lib/comfyui-workflow-cache'
import type {
  GenerationDebugLogEntry,
  GenerationRunImage,
  Txt2imgPromptDraft,
} from '../../../../../main/lib/generation-service'
import { type GenerationUiCapability, generationCapabilities } from '../../../store/generation'
import {
  COMFYUI_WORKFLOW_SELECTION_STORAGE_PREFIX,
  EXTRACT_SKILL_CATEGORY,
  LEGACY_COMFYUI_EXTRACT_SKILL_CATEGORY,
  PROMPT_SKILL_SELECTION_STORAGE_PREFIX,
} from './constants'

export type SkillVariablesState = Record<string, string | boolean>
export type GenerationSettingsSnapshot = Awaited<
  ReturnType<typeof window.api.generationSettings.get>
>
export type GrsaiImageModelOption = GenerationSettingsSnapshot['grsaiModels'][number]
export type LocalModelOption = GenerationSettingsSnapshot['bailianTextModels'][number]
export type ActiveGenerationTask = {
  taskId: string
  capability: GenerationCapability
  processed: number
  total: number
  succeeded: number
  failed: number
  cancelRequested?: boolean
}

export const fallbackGrsaiModels: GrsaiImageModelOption[] = [
  {
    id: 'gpt-image-2',
    label: 'gpt-image-2',
    sizes: ['1024x1024', '1536x1024', '1024x1536'],
    allowCustomSize: false,
  },
  {
    id: 'gpt-image-2-vip',
    label: 'gpt-image-2-vip',
    sizes: ['1024x1024', '2048x2048', '3840x2160', '2160x3840'],
    allowCustomSize: true,
  },
]
export const fallbackGrsaiSizes = ['1024x1024', '1536x1024', '1024x1536']

export const fallbackBailianTextModels: LocalModelOption[] = [
  { id: 'qwen3.6-flash', label: 'qwen3.6-flash', modality: 'text' },
  { id: 'qwen3-vl-flash', label: 'qwen3-vl-flash', modality: 'text' },
]
export const fallbackBailianVisionModels: LocalModelOption[] = [
  { id: 'qwen3.6-flash', label: 'qwen3.6-flash', modality: 'vision' },
  { id: 'qwen3-vl-flash', label: 'qwen3-vl-flash', modality: 'vision' },
]

export const promptSkillCategories: Record<
  Extract<GenerationCapability, 'txt2img' | 'img2img'>,
  Record<'local' | 'full', string>
> = {
  txt2img: {
    local: 'txt2img-local-print',
    full: 'txt2img-full-print',
  },
  img2img: {
    local: 'img2img-local-reference',
    full: 'img2img-full-reference',
  },
}

const promptSkillLabels: Record<string, string> = {
  'txt2img-local-print': '文生图局部',
  'txt2img-full-print': '文生图满印',
  'img2img-local-reference': '图生图局部',
  'img2img-full-reference': '图生图满印',
}

export function generationDebugLogLevelClassName(level: GenerationDebugLogEntry['level']) {
  switch (level) {
    case 'error':
      return 'break-all whitespace-pre-wrap text-red-300'
    case 'warn':
      return 'break-all whitespace-pre-wrap text-amber-300'
    case 'info':
      return 'break-all whitespace-pre-wrap text-emerald-200'
    default:
      return 'break-all whitespace-pre-wrap text-zinc-400'
  }
}

export function skillOptionKey(skill: Pick<SkillSummary, 'id' | 'version'>) {
  return `${skill.id}@${skill.version}`
}

export function skillOptionLabel(skill: SkillSummary) {
  const noteTitle = skill.notes?.split('：')[0]?.trim()
  let title = noteTitle && !noteTitle.startsWith('用于') ? noteTitle : skill.id
  if (title.includes('付费模型提取') || title.includes('ComfyUI 提取')) {
    title = '提取提示词'
  }
  return `${title} · ${skill.version}`
}

export function skillOptionNotes(skill: SkillSummary) {
  if (
    skill.notes?.includes('付费模型提取') ||
    skill.notes?.includes('ComfyUI 提取') ||
    skill.notes?.includes('Grsai 路径')
  ) {
    return null
  }
  return skill.notes
}

export function isExtractSkillSummary(skill: SkillSummary) {
  return (
    skill.module === 'generation' &&
    (skill.category === EXTRACT_SKILL_CATEGORY ||
      skill.category === LEGACY_COMFYUI_EXTRACT_SKILL_CATEGORY)
  )
}

export function promptSkillCategoryFor(
  capability: Extract<GenerationCapability, 'txt2img' | 'img2img'>,
  printMode: 'local' | 'full',
) {
  return promptSkillCategories[capability][printMode]
}

export function promptSkillStorageKey(category: string) {
  return `${PROMPT_SKILL_SELECTION_STORAGE_PREFIX}${category}`
}

export function defaultPromptSkillId(category: string) {
  return category
}

export function promptSkillLabel(category: string) {
  return promptSkillLabels[category] ?? category
}

export function clampNumber(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

export function capabilityLabel(capability: GenerationCapability) {
  return generationCapabilities.find((item) => item.key === capability)?.label ?? capability
}

export function taskProgressLabel(task: ActiveGenerationTask) {
  return `${capabilityLabel(task.capability)} · ${task.processed}/${task.total} · 成功 ${task.succeeded} · 失败 ${task.failed}`
}

export function selectedPromptTexts(drafts: Txt2imgPromptDraft[]) {
  return drafts.filter((draft) => draft.selected && draft.text.trim()).map((draft) => draft.text)
}

export function workflowOptionKey(workflow: Pick<ComfyuiWorkflowSummary, 'id' | 'version'>) {
  return `${workflow.id}@${workflow.version}`
}

export function workflowStorageKey(scope: string) {
  return `${COMFYUI_WORKFLOW_SELECTION_STORAGE_PREFIX}${scope}`
}

export function storedWorkflowKey(scope: string) {
  try {
    return window.localStorage.getItem(workflowStorageKey(scope)) ?? ''
  } catch {
    return ''
  }
}

export function rememberWorkflowKey(scope: string, key: string) {
  try {
    if (key) {
      window.localStorage.setItem(workflowStorageKey(scope), key)
    } else {
      window.localStorage.removeItem(workflowStorageKey(scope))
    }
  } catch {
    // Storage failure should not block generation.
  }
}

export function workflowKeyOrFallback(scope: string, workflows: ComfyuiWorkflowSummary[]) {
  const stored = storedWorkflowKey(scope)
  if (stored && workflows.some((workflow) => workflowOptionKey(workflow) === stored)) {
    return stored
  }
  return workflows[0] ? workflowOptionKey(workflows[0]) : ''
}

export function modelOptionsForCapability(
  settings: GenerationSettingsSnapshot | null,
  capability: Extract<GenerationCapability, 'txt2img' | 'img2img' | 'extract'>,
) {
  void capability
  return settings?.grsaiModels.length ? settings.grsaiModels : fallbackGrsaiModels
}

export function bailianModelsForUse(
  settings: GenerationSettingsSnapshot | null,
  needsVision: boolean,
) {
  if (needsVision) {
    return settings?.bailianVisionModels.length
      ? settings.bailianVisionModels
      : fallbackBailianVisionModels
  }
  return settings?.bailianTextModels.length ? settings.bailianTextModels : fallbackBailianTextModels
}

export function modelLabel(model: { id: string; label?: string }) {
  return model.label ?? model.id
}

export function grsaiSizes(model: GrsaiImageModelOption | null) {
  return model?.sizes.length ? model.sizes : fallbackGrsaiSizes
}

export function isGenerationCapabilityKey(value: string): value is GenerationUiCapability {
  return generationCapabilities.some((capability) => capability.key === value)
}

export function defaultVariableValue(variable: SkillVariable): string | boolean {
  if (variable.type === 'checkbox') {
    return Boolean(variable.default)
  }
  return String(variable.default ?? '')
}

export function variablePayload(variables: SkillVariable[], values: SkillVariablesState) {
  return Object.fromEntries(
    variables.map((variable) => {
      const value = values[variable.key] ?? defaultVariableValue(variable)
      if (variable.type === 'number') {
        const parsed = Number(value)
        return [variable.key, Number.isFinite(parsed) ? parsed : value]
      }
      return [variable.key, value]
    }),
  )
}

export function imagePreviewSrc(image: GenerationRunImage) {
  const localPath = image.localPath ?? fileUrlLocalPath(image.url)
  return localPath ? localImageUrl(localPath) : image.url
}
