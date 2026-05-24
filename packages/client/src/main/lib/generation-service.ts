import { randomUUID } from 'node:crypto'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { BrowserWindow, ipcMain } from 'electron'
import { GenerationConcurrencyController } from './generation-concurrency'
import {
  GRSAI_SUPPORTED_MODELS,
  type GenerateRequest,
  GrsaiAdapter,
  type GrsaiModel,
} from './grsai-adapter'
import { getSecret } from './keychain'
import { parsePrompts, promptGeneratorService } from './prompt-generator-service'

export type Txt2imgPromptDraft = {
  id: string
  text: string
  selected: boolean
}

export type GenerationPromptInput = {
  skillId?: string
  skillVersion?: string
  printMode?: 'local' | 'full'
  requirement: string
  count: number
  model?: string
}

export type Txt2imgRunInput = {
  prompts: string[]
  model: string
  aspectRatio: string
  imageSize: '1K' | '2K' | '4K'
  concurrency: number
}

export type GenerationProgress = {
  task_id: string
  capability: 'txt2img'
  processed: number
  total: number
  succeeded: number
  failed: number
  current_prompt?: string
}

export type GenerationRunResult = {
  taskId: string
  total: number
  succeeded: number
  failed: number
  images: Array<{ prompt: string; url: string }>
  failures: Array<{ prompt: string; error: string }>
}

export type GenerationTaskEvent =
  | { ok: true; result: GenerationRunResult }
  | { ok: false; taskId: string; error: string }

const DEFAULT_GENERATION_MODEL: GrsaiModel = 'nano-banana-2'

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function normalizeModel(model: string) {
  return GRSAI_SUPPORTED_MODELS.includes(model as GrsaiModel) ? model : DEFAULT_GENERATION_MODEL
}

function appErrorMessage(error: unknown) {
  if (error instanceof AppErrorClass) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function emitProgress(progress: GenerationProgress) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:progress', progress)
  }
}

function emitCompleted(event: GenerationTaskEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generation:completed', event)
  }
}

export async function generateTxt2imgPrompts(input: GenerationPromptInput) {
  const count = clampInt(input.count, 1, 20, 5)
  const prompts = await promptGeneratorService.generatePrompts({
    ...(input.skillId ? { skillId: input.skillId } : { category: 'txt2img' as const }),
    variables: {
      printMode: input.printMode === 'full' ? '满印' : '局部',
      requirement: input.requirement,
      count,
    },
    count,
    ...(input.model ? { model: input.model } : {}),
    userMessage: `生成 ${count} 条适合 Grsai 文生图的英文印花提示词。`,
    responseFormat: 'json_object',
  })

  return prompts.map((text) => ({
    id: randomUUID(),
    text,
    selected: true,
  })) satisfies Txt2imgPromptDraft[]
}

export async function runTxt2img(input: Txt2imgRunInput) {
  const prompts = input.prompts.map((prompt) => prompt.trim()).filter(Boolean)
  if (prompts.length === 0) {
    throw new AppErrorClass('HTTP_4XX', '请先准备至少一条提示词', false)
  }

  const apiKey = await getSecret('grsai')
  if (!apiKey) {
    throw new AppErrorClass('HTTP_4XX', '缺少 Grsai API Key', false, { provider: 'grsai' })
  }

  const taskId = `gen_${randomUUID()}`
  void runTxt2imgTask(taskId, prompts, input, apiKey)
  return taskId
}

async function runTxt2imgTask(
  taskId: string,
  prompts: string[],
  input: Txt2imgRunInput,
  apiKey: string,
) {
  const controller = new GenerationConcurrencyController({
    workers: clampInt(input.concurrency, 1, 10, 3),
  })
  const adapter = new GrsaiAdapter(apiKey)
  const result: GenerationRunResult = {
    taskId,
    total: prompts.length,
    succeeded: 0,
    failed: 0,
    images: [],
    failures: [],
  }

  try {
    await Promise.all(
      prompts.map((prompt, index) =>
        controller.run(`${taskId}-${index}`, async () => {
          emitProgress({
            task_id: taskId,
            capability: 'txt2img',
            processed: result.succeeded + result.failed,
            total: prompts.length,
            succeeded: result.succeeded,
            failed: result.failed,
            current_prompt: prompt,
          })

          try {
            const response = await adapter.generate({
              capability: 'txt2img',
              prompt,
              output: {
                aspect_ratio: input.aspectRatio,
                image_size_label: input.imageSize,
              },
              model: normalizeModel(input.model),
            } satisfies GenerateRequest)
            if (response.status !== 'succeeded') {
              throw response.error ?? new AppErrorClass('GRSAI_FAILED', 'Grsai 生成失败', true)
            }
            result.succeeded += response.images.length
            result.images.push(...response.images.map((image) => ({ prompt, url: image.url })))
          } catch (error) {
            result.failed += 1
            result.failures.push({ prompt, error: appErrorMessage(error) })
          } finally {
            emitProgress({
              task_id: taskId,
              capability: 'txt2img',
              processed: result.succeeded + result.failed,
              total: prompts.length,
              succeeded: result.succeeded,
              failed: result.failed,
              current_prompt: prompt,
            })
          }
        }),
      ),
    )
    emitCompleted({ ok: true, result })
  } catch (error) {
    emitCompleted({ ok: false, taskId, error: appErrorMessage(error) })
  }
}

export function parseManualPrompts(text: string) {
  return parsePrompts(text, 200)
}

export function registerGenerationIpc() {
  ipcMain.handle('generation:generate-prompts', (_event, input: GenerationPromptInput) =>
    generateTxt2imgPrompts(input),
  )
  ipcMain.handle('generation:parse-manual-prompts', (_event, text: string) =>
    parseManualPrompts(text),
  )
  ipcMain.handle('generation:run-txt2img', (_event, input: Txt2imgRunInput) => runTxt2img(input))
}
