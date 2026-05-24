import { createHash, randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AppErrorClass,
  type ComfyuiWorkflow,
  type ComfyuiWorkflowSlot,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import type Database from 'better-sqlite3'
import type { ComfyHistoryEntry, ComfyHttpClient } from './comfy-http-client'
import type { ComfyuiInstanceSummary } from './comfyui-instance-manager'
import type { GenerateRequest, GenerateResponse, ImageGenerationAdapter } from './grsai-adapter'

export type ComfyuiWorkflowCache = {
  get(
    workflowId: string,
    capability: GenerateRequest['capability'],
    version?: string,
  ): Promise<ComfyuiWorkflow>
}

export type ComfyuiExecutionDatabase = Pick<Database.Database, 'exec' | 'prepare'>

export type ComfyuiChenyuAdapterOptions = {
  instanceManager: {
    refreshCurrentInstance(): Promise<ComfyuiInstanceSummary | null>
  }
  comfyHttp: Pick<ComfyHttpClient, 'uploadImage' | 'queuePrompt' | 'getHistory' | 'viewImage'>
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
  txt2img: '01-文生图',
  img2img: '02-图生图',
  extract: '03-提取',
  matting: '04-抠图',
}

export class ComfyuiChenyuAdapter implements ImageGenerationAdapter {
  private readonly now: () => number

  constructor(private readonly options: ComfyuiChenyuAdapterOptions) {
    this.now = options.now ?? Date.now
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const instance = await this.options.instanceManager.refreshCurrentInstance()
    if (!instance || instance.status !== 'running') {
      throw new AppErrorClass('CHENYU_INSTANCE_DOWN', 'ComfyUI 实例未运行', false, {
        provider: 'comfyui-chenyu',
        status: instance?.status ?? 'none',
      })
    }

    if (!req.workflow_id) {
      throw new AppErrorClass('HTTP_4XX', '请选择 ComfyUI 工作流', false, {
        provider: 'comfyui-chenyu',
        capability: req.capability,
      })
    }

    const workflow = await this.options.workflowCache.get(
      req.workflow_id,
      req.capability,
      workflowVersionFromRequest(req),
    )
    const uploadedImages = await this.uploadReferenceImages(req)
    const injectedWorkflow = injectComfyuiInputs(workflow.workflowJson, workflow.inputSlots, req, {
      uploadedImages,
    })
    const promptId = await this.options.comfyHttp.queuePrompt(injectedWorkflow)
    const history = await this.options.comfyHttp.getHistory(promptId)
    const outputs = outputsFromHistory(history, workflow.outputSlots)
    const images = await this.downloadAndPersistOutputs({
      req,
      workflow,
      outputs,
      promptId,
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

  private async uploadReferenceImages(req: GenerateRequest) {
    const uploaded: string[] = []
    for (const [index, image] of (req.reference_images ?? []).entries()) {
      const filename = referenceFilename(image.mime_type, index)
      const buffer = Buffer.from(stripDataUrlPrefix(image.base64), 'base64')
      uploaded.push(await this.options.comfyHttp.uploadImage(buffer, filename))
    }
    return uploaded
  }

  private async downloadAndPersistOutputs(input: {
    req: GenerateRequest
    workflow: ComfyuiWorkflow
    outputs: ComfyImageOutput[]
    promptId: string
  }) {
    const outputFolder = join(
      this.options.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      CAPABILITY_FOLDERS[input.req.capability],
    )
    await mkdir(outputFolder, { recursive: true })
    const db = this.options.openDatabase(this.options.workbenchRoot)
    ensureArtifactsTable(db)

    const images: NonNullable<GenerateResponse['images']> = []
    for (const output of input.outputs) {
      if (!output.filename) {
        throw new AppErrorClass('HTTP_5XX', 'ComfyUI 输出缺少文件名', true, {
          provider: 'comfyui-chenyu',
          promptId: input.promptId,
        })
      }

      const buffer = await this.options.comfyHttp.viewImage(output.filename)
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
        taskId: taskIdFromRequest(input.req),
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

  if (slot.name.toLowerCase().includes('image') || slot.field.toLowerCase().includes('image')) {
    const filename = context.uploadedImages[0]
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

function ensureArtifactsTable(db: Pick<Database.Database, 'exec'>) {
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
  db: Pick<Database.Database, 'prepare'>,
  input: {
    taskId: string
    printId: string
    targetPath: string
    capability: GenerateRequest['capability']
    workflow: ComfyuiWorkflow
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
    'comfyui-chenyu',
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

function printIdFromRequest(req: GenerateRequest) {
  return typeof req.options?.printId === 'string' ? req.options.printId : null
}

function workflowVersionFromRequest(req: GenerateRequest) {
  return typeof req.options?.workflowVersion === 'string' ? req.options.workflowVersion : undefined
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
