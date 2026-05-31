import { createHash, randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AppErrorClass,
  type ComfyuiWorkflowSlot,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import type { ComfyHistoryEntry, ComfyHttpClient } from './comfy-http-client'
import type { ComfyuiInstanceSummary } from './comfyui-instance-manager'
import type { CachedComfyuiWorkflow, ComfyuiWorkflowCategory } from './comfyui-workflow-cache'
import type { GenerateRequest, GenerateResponse, ImageGenerationAdapter } from './grsai-adapter'
import type { SqliteDatabase } from './sqlite'

export type ComfyuiWorkflowCache = {
  get(
    workflowId: string,
    capability: ComfyuiWorkflowCategory,
    version?: string,
  ): Promise<CachedComfyuiWorkflow>
}

export type ComfyuiExecutionDatabase = Pick<SqliteDatabase, 'exec' | 'prepare'> & {
  close?: () => void
}

export type ComfyuiChenyuAdapterOptions = {
  instanceManager: {
    refreshCurrentInstance(): Promise<ComfyuiInstanceSummary | null>
  }
  comfyHttp?: Pick<ComfyHttpClient, 'uploadImage' | 'queuePrompt' | 'getHistory' | 'viewImage'>
  createComfyHttp?: (
    baseUrl: string,
  ) => Pick<ComfyHttpClient, 'uploadImage' | 'queuePrompt' | 'getHistory' | 'viewImage'>
  workflowCache: ComfyuiWorkflowCache
  workbenchRoot: string
  openDatabase: (workbenchRoot: string) => ComfyuiExecutionDatabase
  now?: () => number
}

type ComfyImageOutput = {
  filename?: string
  subfolder?: string
  type?: string
}

type ComfyOutputNode = {
  images?: ComfyImageOutput[]
}

const CAPABILITY_FOLDERS: Record<GenerateRequest['capability'], string> = {
  txt2img: '文生图',
  img2img: '图生图',
  extract: '提取',
  matting: '抠图',
}

export class ComfyuiChenyuAdapter implements ImageGenerationAdapter {
  private readonly now: () => number

  constructor(private readonly options: ComfyuiChenyuAdapterOptions) {
    this.now = options.now ?? Date.now
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const instance = await this.options.instanceManager.refreshCurrentInstance()
    if (!instance || instance.status !== 'running') {
      throw new AppErrorClass('CHENYU_INSTANCE_DOWN', '默认云机未运行，请先到设置页开机', false, {
        provider: 'comfyui-chenyu',
        status: instance?.status ?? 'none',
      })
    }
    const comfyHttp = this.comfyHttpFor(instance.comfyuiUrl)

    if (!req.workflow_id) {
      throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 工作流', false, {
        provider: 'comfyui-chenyu',
        capability: req.capability,
      })
    }

    const workflow = await this.options.workflowCache.get(
      req.workflow_id,
      workflowCategoryFromRequest(req),
      workflowVersionFromRequest(req),
    )
    const uploadedImages = await this.uploadReferenceImages(req, comfyHttp)
    const injectedWorkflow = injectComfyuiInputs(workflow.workflowJson, workflow.inputSlots, req, {
      uploadedImages,
    })
    const promptId = await comfyHttp.queuePrompt(injectedWorkflow)
    const history = await comfyHttp.getHistory(promptId)
    const outputs = outputsFromHistory(history, workflow.outputSlots)
    const images = await this.downloadAndPersistOutputs({
      req,
      workflow,
      outputs,
      promptId,
      comfyHttp,
    })

    return {
      status: 'succeeded',
      images,
      raw_response: {
        promptId,
        history,
      },
    }
  }

  private comfyHttpFor(baseUrl: string) {
    const client = this.options.createComfyHttp?.(baseUrl) ?? this.options.comfyHttp
    if (!client) {
      throw new AppErrorClass('HTTP_5XX', '缺少 ComfyUI 客户端', true, {
        provider: 'comfyui-chenyu',
      })
    }
    return client
  }

  private async uploadReferenceImages(
    req: GenerateRequest,
    comfyHttp: Pick<ComfyHttpClient, 'uploadImage'>,
  ) {
    const uploaded: string[] = []
    for (const [index, image] of (req.reference_images ?? []).entries()) {
      const filename = referenceFilename(image.mime_type, index)
      const buffer = Buffer.from(stripDataUrlPrefix(image.base64), 'base64')
      uploaded.push(await comfyHttp.uploadImage(buffer, filename))
    }
    return uploaded
  }

  private async downloadAndPersistOutputs(input: {
    req: GenerateRequest
    workflow: CachedComfyuiWorkflow
    outputs: ComfyImageOutput[]
    promptId: string
    comfyHttp: Pick<ComfyHttpClient, 'viewImage'>
  }) {
    const taskId = taskIdFromRequest(input.req)
    const outputFolder = join(
      this.options.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      CAPABILITY_FOLDERS[input.req.capability],
      safePathSegment(taskId),
    )
    await mkdir(outputFolder, { recursive: true })
    const db = this.options.openDatabase(this.options.workbenchRoot)
    try {
      ensureArtifactsTable(db)

      const images: NonNullable<GenerateResponse['images']> = []
      for (const output of input.outputs) {
        if (!output.filename) {
          throw new AppErrorClass('HTTP_5XX', 'ComfyUI 输出缺少文件名', true, {
            provider: 'comfyui-chenyu',
            promptId: input.promptId,
          })
        }

        const buffer = await input.comfyHttp.viewImage(output.filename)
        const printId = printIdFromRequest(input.req) ?? newPrintId()
        const targetPath =
          input.req.capability === 'img2img'
            ? await uniqueVersionedTargetPath(outputFolder, printId, '.png')
            : join(
                outputFolder,
                `${printId}${input.req.capability === 'matting' ? '.png' : extensionFromFilename(output.filename)}`,
              )
        await writeFile(targetPath, buffer)
        const artifactId = await registerComfyuiArtifact(db, {
          taskId,
          printId,
          targetPath,
          capability: input.req.capability,
          workflow: input.workflow,
          prompt: input.req.prompt,
          params: input.req.options ?? {},
          sourceArtifactIds: sourceArtifactIdsFromRequest(input.req),
          createdAt: this.now(),
        })
        images.push({
          url: pathToFileURL(targetPath).toString(),
          local_path: targetPath,
        })
      }

      return images
    } finally {
      db.close?.()
    }
  }
}

export function injectComfyuiInputs(
  workflowJson: unknown,
  slots: ComfyuiWorkflowSlot[],
  req: GenerateRequest,
  context: { uploadedImages: string[] },
) {
  const workflow = structuredClone(workflowJson) as Record<
    string,
    { inputs?: Record<string, unknown> }
  >

  for (const slot of slots) {
    const node = workflow[slot.nodeId]
    if (!node) {
      throw new AppErrorClass('HTTP_4XX', 'ComfyUI 工作流缺少输入节点', false, {
        provider: 'comfyui-chenyu',
        nodeId: slot.nodeId,
      })
    }
    node.inputs ??= {}
    node.inputs[slot.field] = valueForSlot(slot, req, context)
  }

  return workflow
}

export function outputsFromHistory(history: ComfyHistoryEntry, outputSlots: ComfyuiWorkflowSlot[]) {
  const outputs: ComfyImageOutput[] = []
  const rawOutputs = history.outputs ?? {}

  for (const slot of outputSlots) {
    const nodeOutput = rawOutputs[slot.nodeId] as ComfyOutputNode | undefined
    outputs.push(...(nodeOutput?.images ?? []))
  }

  if (outputs.length === 0) {
    throw new AppErrorClass('HTTP_5XX', 'ComfyUI 未返回输出图片', true, {
      provider: 'comfyui-chenyu',
    })
  }

  return outputs
}

function valueForSlot(
  slot: ComfyuiWorkflowSlot,
  req: GenerateRequest,
  context: { uploadedImages: string[] },
) {
  const optionValue = req.options?.[slot.name] ?? req.options?.[slot.field]
  if (optionValue !== undefined) {
    return optionValue
  }

  const normalizedName = `${slot.name} ${slot.field}`.toLowerCase()
  if (normalizedName.includes('width')) {
    return req.output.size_px?.width ?? 1024
  }
  if (normalizedName.includes('height')) {
    return req.output.size_px?.height ?? 1024
  }

  if (normalizedName.includes('image')) {
    const filename = context.uploadedImages[imageIndexForSlot(slot, req)]
    if (!filename) {
      throw new AppErrorClass('HTTP_4XX', 'ComfyUI 工作流需要参考图', false, {
        provider: 'comfyui-chenyu',
        slot: slot.name,
      })
    }
    return filename
  }

  return req.prompt
}

function imageIndexForSlot(slot: ComfyuiWorkflowSlot, req: GenerateRequest) {
  if (typeof slot.imageIndex === 'number' && Number.isInteger(slot.imageIndex)) {
    return Math.max(0, slot.imageIndex)
  }

  const explicitValue =
    req.options?.[`${slot.name}ImageIndex`] ??
    req.options?.[`${slot.field}ImageIndex`] ??
    req.options?.imageSlotIndexes
  if (typeof explicitValue === 'number' && Number.isInteger(explicitValue) && explicitValue >= 0) {
    return explicitValue
  }
  if (explicitValue && typeof explicitValue === 'object' && !Array.isArray(explicitValue)) {
    const indexes = explicitValue as Record<string, unknown>
    const indexValue = indexes[slot.name] ?? indexes[slot.field]
    if (typeof indexValue === 'number' && Number.isInteger(indexValue) && indexValue >= 0) {
      return indexValue
    }
  }

  const normalizedName = `${slot.name} ${slot.field}`.toLowerCase()
  if (normalizedName.includes('mask')) {
    return 1
  }
  return 0
}

function providerFromParams(params: Record<string, unknown>) {
  return params.artifactProvider === 'grsai+comfyui-mask' ? 'grsai+comfyui-mask' : 'comfyui-chenyu'
}

function ensureArtifactsTable(db: Pick<SqliteDatabase, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      sku_code TEXT,
      print_id TEXT,
      step TEXT NOT NULL,
      provider TEXT,
      model_or_workflow TEXT,
      skill_id TEXT,
      skill_version TEXT,
      source_artifact_ids TEXT,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      file_hash TEXT,
      prompt_snapshot TEXT,
      params_snapshot TEXT,
      created_at INTEGER NOT NULL
    );
  `)
}

async function registerComfyuiArtifact(
  db: Pick<SqliteDatabase, 'prepare'>,
  input: {
    taskId: string
    printId: string
    targetPath: string
    capability: GenerateRequest['capability']
    workflow: CachedComfyuiWorkflow
    prompt: string
    params: Record<string, unknown>
    sourceArtifactIds: string[]
    createdAt: number
  },
) {
  const [fileHash, info] = await Promise.all([hashFile(input.targetPath), stat(input.targetPath)])
  const artifactId = randomUUID()
  db.prepare(`
    INSERT INTO artifacts (
      id,
      task_id,
      print_id,
      step,
      provider,
      model_or_workflow,
      source_artifact_ids,
      file_path,
      file_size,
      file_hash,
      prompt_snapshot,
      params_snapshot,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    artifactId,
    input.taskId,
    input.printId,
    input.capability,
    providerFromParams(input.params),
    input.workflow.id,
    JSON.stringify(input.sourceArtifactIds),
    input.targetPath,
    info.size,
    fileHash,
    input.prompt,
    JSON.stringify(input.params),
    input.createdAt,
  )
  return artifactId
}

function sourceArtifactIdsFromRequest(req: GenerateRequest) {
  const value = req.options?.sourceArtifactIds
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function taskIdFromRequest(req: GenerateRequest) {
  return typeof req.options?.taskId === 'string' ? req.options.taskId : `comfy_${randomUUID()}`
}

function safePathSegment(value: string) {
  return (value || 'task').replace(/[\\/:*?"<>|]/g, '_')
}

function printIdFromRequest(req: GenerateRequest) {
  return typeof req.options?.printId === 'string' ? req.options.printId : null
}

function workflowVersionFromRequest(req: GenerateRequest) {
  return typeof req.options?.workflowVersion === 'string' ? req.options.workflowVersion : undefined
}

function workflowCategoryFromRequest(req: GenerateRequest): ComfyuiWorkflowCategory {
  return req.options?.workflowCategory === 'matting-mixed' ? 'matting-mixed' : req.capability
}

function newPrintId() {
  return `pri_${randomUUID().replaceAll('-', '').slice(0, 16)}`
}

async function uniqueVersionedTargetPath(folder: string, printId: string, ext: string) {
  let version = 1
  while (true) {
    const candidate = join(folder, `${printId}_v${version}${ext}`)
    try {
      await stat(candidate)
      version += 1
    } catch {
      return candidate
    }
  }
}

function hashFile(path: string) {
  return import('node:fs/promises')
    .then(({ readFile }) => readFile(path))
    .then((buffer) => createHash('sha256').update(buffer).digest('hex'))
}

function extensionFromFilename(filename: string) {
  const ext = extname(filename).toLowerCase()
  return ext || '.png'
}

function referenceFilename(mimeType: string, index: number) {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
  return `reference-${index + 1}.${ext}`
}

function stripDataUrlPrefix(value: string) {
  if (!value.startsWith('data:')) {
    return value
  }
  const commaIndex = value.indexOf(',')
  return commaIndex === -1 ? value.slice('data:'.length) : value.slice(commaIndex + 1)
}
