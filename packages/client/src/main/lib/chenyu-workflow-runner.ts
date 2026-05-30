import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  AppErrorClass,
  type GenerationCapability,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import type {
  ChenyuCloudClient,
  ChenyuSubmitWorkflowRunInput,
  ChenyuWorkflowExecution,
  ChenyuWorkflowMarketParams,
  ChenyuWorkflowRunSubmitResult,
} from './chenyu-cloud-client'
import type { SqliteDatabase } from './sqlite'

type WorkflowRunnerDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>

export type ChenyuWorkflowRunnerOptions = {
  chenyu: Pick<
    ChenyuCloudClient,
    'listWorkflowMarket' | 'getWorkflowMarketInfo' | 'submitWorkflowRun' | 'getWorkflowRunExecution'
  >
  workbenchRoot: string
  openDatabase: (workbenchRoot: string) => WorkflowRunnerDatabase
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export type ChenyuRunImageWorkflowInput = {
  workflowId: string
  revisionId?: string
  inputs?: Record<string, unknown>
  capability: GenerationCapability
  prompt?: string
  idempotencyKey?: string
  acceptExternalCostRisk?: boolean
  taskId?: string
}

export type ChenyuRunImageWorkflowResult = {
  submit: ChenyuWorkflowRunSubmitResult
  execution: ChenyuWorkflowExecution
  images: Array<{ url: string; local_path: string; artifact_id: string }>
}

const CAPABILITY_FOLDERS: Record<GenerationCapability, string> = {
  txt2img: '01-文生图',
  img2img: '02-图生图',
  extract: '03-提取',
  matting: '04-抠图',
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled', 'cancelled'])
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60_000

export class ChenyuWorkflowRunner {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly pollIntervalMs: number
  private readonly pollTimeoutMs: number

  constructor(private readonly options: ChenyuWorkflowRunnerOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? delay
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  }

  listWorkflows(params: ChenyuWorkflowMarketParams = {}) {
    return this.options.chenyu.listWorkflowMarket(params)
  }

  getWorkflowInfo(workflowId: string) {
    return this.options.chenyu.getWorkflowMarketInfo(workflowId)
  }

  async runImageWorkflow(
    input: ChenyuRunImageWorkflowInput,
  ): Promise<ChenyuRunImageWorkflowResult> {
    const submitPayload: ChenyuSubmitWorkflowRunInput = {
      workflow_id: input.workflowId,
      ...(input.revisionId ? { revision_id: input.revisionId } : {}),
      ...(input.inputs ? { inputs: input.inputs } : {}),
      idempotency_key: input.idempotencyKey ?? `wf_${randomUUID()}`,
      ...(input.acceptExternalCostRisk !== undefined
        ? { accept_external_cost_risk: input.acceptExternalCostRisk }
        : {}),
    }
    const submit = await this.options.chenyu.submitWorkflowRun(submitPayload)
    const execution = await this.pollExecution(submit.run_order_id)
    if (execution.status !== 'succeeded') {
      throw workflowExecutionError(execution)
    }

    const imageUrls = imageUrlsFromOutputs(execution.outputs)
    if (imageUrls.length === 0) {
      throw new AppErrorClass('HTTP_5XX', '晨羽工作流未返回图片输出', true, {
        provider: 'comfyui-chenyu-workflow',
        workflowId: input.workflowId,
        runOrderId: submit.run_order_id,
      })
    }

    const images = await this.downloadAndPersistImages({
      imageUrls,
      input,
      submit,
      execution,
    })
    return { submit, execution, images }
  }

  private async pollExecution(runOrderId: string) {
    const deadline = this.now() + this.pollTimeoutMs
    while (true) {
      const execution = await this.options.chenyu.getWorkflowRunExecution(runOrderId)
      if (TERMINAL_STATUSES.has(execution.status)) {
        return execution
      }
      if (this.now() >= deadline) {
        throw new AppErrorClass('NETWORK_TIMEOUT', '晨羽工作流执行超时', true, {
          provider: 'comfyui-chenyu-workflow',
          runOrderId,
          status: execution.status,
        })
      }
      await this.sleep(this.pollIntervalMs)
    }
  }

  private async downloadAndPersistImages(input: {
    imageUrls: string[]
    input: ChenyuRunImageWorkflowInput
    submit: ChenyuWorkflowRunSubmitResult
    execution: ChenyuWorkflowExecution
  }) {
    const outputFolder = join(
      this.options.workbenchRoot,
      WORKBENCH_DIRECTORIES.generation,
      CAPABILITY_FOLDERS[input.input.capability],
    )
    await mkdir(outputFolder, { recursive: true })
    const db = this.options.openDatabase(this.options.workbenchRoot)
    try {
      ensureArtifactsTable(db)
      const images: ChenyuRunImageWorkflowResult['images'] = []
      for (const [index, url] of input.imageUrls.entries()) {
        const buffer = await this.downloadImage(url)
        const targetPath = await uniqueTargetPath(outputFolder, targetName(url, index))
        await writeFile(targetPath, buffer)
        const artifactId = await registerWorkflowArtifact(db, {
          taskId: input.input.taskId ?? input.submit.run_order_id,
          printId: `pri_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
          targetPath,
          capability: input.input.capability,
          workflowId: input.input.workflowId,
          prompt: input.input.prompt ?? '',
          params: {
            revisionId: input.input.revisionId ?? input.submit.revision_id ?? null,
            runOrderId: input.submit.run_order_id,
            executionTaskId: input.execution.task_id ?? null,
            inputs: input.input.inputs ?? {},
          },
          createdAt: this.now(),
        })
        images.push({
          url: pathToFileURL(targetPath).toString(),
          local_path: targetPath,
          artifact_id: artifactId,
        })
      }
      return images
    } finally {
      db.close()
    }
  }

  private async downloadImage(url: string) {
    const response = await this.fetchImpl(url)
    if (!response.ok) {
      throw new AppErrorClass('HTTP_5XX', '晨羽工作流图片下载失败', true, {
        provider: 'comfyui-chenyu-workflow',
        status: response.status,
        url,
      })
    }
    return Buffer.from(await response.arrayBuffer())
  }
}

function workflowExecutionError(execution: ChenyuWorkflowExecution) {
  return new AppErrorClass(
    execution.status === 'canceled' || execution.status === 'cancelled' ? 'HTTP_4XX' : 'HTTP_5XX',
    execution.error?.message ?? execution.error?.reason ?? '晨羽工作流执行失败',
    execution.status !== 'canceled' && execution.status !== 'cancelled',
    {
      provider: 'comfyui-chenyu-workflow',
      status: execution.status,
      error: execution.error ?? null,
    },
  )
}

function imageUrlsFromOutputs(outputs: Record<string, unknown> | undefined) {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const value of Object.values(outputs ?? {})) {
    collectImageUrls(value, urls, seen)
  }
  return urls
}

function collectImageUrls(value: unknown, urls: string[], seen: Set<string>) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && !seen.has(value)) {
      seen.add(value)
      urls.push(value)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageUrls(item, urls, seen)
    }
    return
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const item of Object.values(record)) {
      collectImageUrls(item, urls, seen)
    }
  }
}

function targetName(url: string, index: number) {
  const name = basename(new URL(url).pathname) || `workflow-output-${index + 1}.png`
  const ext = extname(name)
  return ext ? name : `${name}.png`
}

async function uniqueTargetPath(folder: string, filename: string) {
  const ext = extname(filename) || '.png'
  const stem = basename(filename, ext)
  let version = 0
  while (true) {
    const suffix = version === 0 ? '' : `-${version + 1}`
    const candidate = join(folder, `${stem}${suffix}${ext}`)
    try {
      await stat(candidate)
      version += 1
    } catch {
      return candidate
    }
  }
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

async function registerWorkflowArtifact(
  db: Pick<SqliteDatabase, 'prepare'>,
  input: {
    taskId: string
    printId: string
    targetPath: string
    capability: GenerationCapability
    workflowId: string
    prompt: string
    params: Record<string, unknown>
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
    'comfyui-chenyu-workflow',
    input.workflowId,
    JSON.stringify([]),
    input.targetPath,
    info.size,
    fileHash,
    input.prompt,
    JSON.stringify(input.params),
    input.createdAt,
  )
  return artifactId
}

function hashFile(path: string) {
  return readFile(path).then((buffer) => createHash('sha256').update(buffer).digest('hex'))
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
