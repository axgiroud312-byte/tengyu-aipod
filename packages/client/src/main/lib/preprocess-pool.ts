import { cpus, totalmem } from 'node:os'
import { Worker } from 'node:worker_threads'
import { AppErrorClass } from '@tengyu-aipod/shared'

export type PreprocessModule = 'title' | 'detection' | 'generation'
export type PreprocessFormat = 'jpg' | 'png'
export type PreprocessInput = string | Buffer

export type PreprocessOptions = {
  module: PreprocessModule
  taskId: string
  workbenchRoot: string
  input: PreprocessInput
  inputName?: string
  maxSize?: number
  compression?: boolean
  format?: PreprocessFormat
  quality?: number
}

export type PreprocessResult = {
  outputPath: string
  mimeType: string
  sizeBytes: number
  dataUrl: string
}

export class PreprocessError extends AppErrorClass {
  constructor(
    public kind: 'INPUT_NOT_FOUND' | 'SHARP_DECODE_FAILED' | 'DISK_FULL',
    message: string,
    cause?: unknown,
  ) {
    super('HTTP_4XX', message, false, { kind }, cause)
    this.name = 'PreprocessError'
  }
}

type SerializablePreprocessOptions = Omit<PreprocessOptions, 'input'> & {
  input: string | Uint8Array
}

type WorkerRequest = {
  id: number
  options: SerializablePreprocessOptions
}

type WorkerSuccess = {
  id: number
  ok: true
  result: PreprocessResult
}

type WorkerFailure = {
  id: number
  ok: false
  error: {
    kind: PreprocessError['kind']
    message: string
    rawMessage: string
  }
}

type WorkerResponse = WorkerSuccess | WorkerFailure

type QueuedJob = {
  id: number
  options: SerializablePreprocessOptions
  resolve: (result: PreprocessResult) => void
  reject: (error: unknown) => void
}

type PoolWorker = {
  worker: Worker
  job: QueuedJob | null
}

export function defaultPreprocessWorkerCount(overwrite?: number) {
  const input = {
    cpuCount: cpus().length,
    ramGB: totalmem() / 1024 ** 3,
    ...(overwrite !== undefined ? { overwrite } : {}),
  }
  return resolvePreprocessWorkerCount(input)
}

export function resolvePreprocessWorkerCount(input: {
  cpuCount: number
  ramGB: number
  overwrite?: number
}) {
  if (input.overwrite !== undefined) {
    return clamp(Math.floor(input.overwrite), 1, 8)
  }

  const cpuCount = input.cpuCount
  const ramGB = input.ramGB
  if (cpuCount < 4 || ramGB < 4) {
    return 1
  }

  return clamp(Math.floor(cpuCount / 2), 1, 4)
}

export class SharpPreprocessPool {
  readonly size: number
  private nextId = 1
  private readonly workers: PoolWorker[]
  private readonly queue: QueuedJob[] = []

  constructor(workerCount = defaultPreprocessWorkerCount()) {
    this.size = clamp(Math.floor(workerCount), 1, 8)
    this.workers = Array.from({ length: this.size }, () => this.createWorker())
  }

  process(options: PreprocessOptions): Promise<PreprocessResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextId,
        options: serializeOptions(options),
        resolve,
        reject,
      })
      this.nextId += 1
      this.schedule()
    })
  }

  async processAll(options: PreprocessOptions[]) {
    return Promise.all(options.map((item) => this.process(item)))
  }

  async close() {
    await Promise.all(this.workers.map(({ worker }) => worker.terminate()))
    this.queue.splice(0)
  }

  private createWorker(): PoolWorker {
    const poolWorker: PoolWorker = {
      worker: new Worker(PREPROCESS_WORKER_SOURCE, { eval: true }),
      job: null,
    }

    poolWorker.worker.on('message', (message: WorkerResponse) => {
      const job = poolWorker.job
      if (!job || job.id !== message.id) {
        return
      }

      poolWorker.job = null
      if (message.ok) {
        job.resolve(message.result)
      } else {
        job.reject(
          new PreprocessError(
            message.error.kind,
            message.error.message,
            new Error(message.error.rawMessage),
          ),
        )
      }
      this.schedule()
    })

    poolWorker.worker.on('error', (error) => {
      const job = poolWorker.job
      poolWorker.job = null
      job?.reject(error)
      this.schedule()
    })

    return poolWorker
  }

  private schedule() {
    for (const poolWorker of this.workers) {
      if (poolWorker.job) {
        continue
      }

      const job = this.queue.shift()
      if (!job) {
        return
      }

      poolWorker.job = job
      poolWorker.worker.postMessage({ id: job.id, options: job.options } satisfies WorkerRequest)
    }
  }
}

function serializeOptions(options: PreprocessOptions): SerializablePreprocessOptions {
  return {
    ...options,
    input: Buffer.isBuffer(options.input) ? new Uint8Array(options.input) : options.input,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

const PREPROCESS_WORKER_SOURCE = String.raw`
const { createHash } = require('node:crypto')
const { mkdir, readFile, stat } = require('node:fs/promises')
const { basename, join } = require('node:path')
const { parentPort } = require('node:worker_threads')
const sharp = require('sharp')

parentPort.on('message', async (job) => {
  try {
    const result = await preprocessImage(job.options)
    parentPort.postMessage({ id: job.id, ok: true, result })
  } catch (error) {
    const classified = classifyPreprocessError(error)
    parentPort.postMessage({
      id: job.id,
      ok: false,
      error: {
        kind: classified.kind,
        message: classified.message,
        rawMessage: error instanceof Error ? error.message : String(error),
      },
    })
  }
})

async function preprocessImage(options) {
  const inputBuffer = await readInput(options.input)
  const format = options.format ?? 'jpg'
  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const hash = createHash('sha256')
    .update(inputBuffer)
    .update(options.inputName ?? '')
    .digest('hex')
    .slice(0, 16)
  const outputDir = join(options.workbenchRoot, '.workbench', 'tmp', options.module, options.taskId)
  const outputPath = join(outputDir, hash + '_preprocessed.' + format)

  await mkdir(outputDir, { recursive: true })

  let pipeline = sharp(inputBuffer).flatten({ background: '#ffffff' })
  if (options.compression ?? true) {
    pipeline = pipeline.resize({
      width: options.maxSize ?? 1024,
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  if (format === 'jpg') {
    pipeline = pipeline.jpeg({ quality: options.quality ?? 85 })
  } else {
    pipeline = pipeline.png()
  }

  await pipeline.toFile(outputPath)

  const output = await readFile(outputPath)
  return {
    outputPath,
    mimeType,
    sizeBytes: output.byteLength,
    dataUrl: 'data:' + mimeType + ';base64,' + output.toString('base64'),
  }
}

async function readInput(input) {
  if (typeof input !== 'string') {
    return Buffer.from(input)
  }

  try {
    await stat(input)
    return await readFile(input)
  } catch (error) {
    const name = basename(input) || input
    throw Object.assign(new Error('输入图片不存在：' + name), { kind: 'INPUT_NOT_FOUND' })
  }
}

function classifyPreprocessError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (error && error.kind === 'INPUT_NOT_FOUND') {
    return { kind: 'INPUT_NOT_FOUND', message }
  }
  if (/no space|enospc/i.test(message)) {
    return { kind: 'DISK_FULL', message: '磁盘空间不足，无法写入预处理图片' }
  }
  return { kind: 'SHARP_DECODE_FAILED', message: '图片解码失败，无法预处理' }
}
`
