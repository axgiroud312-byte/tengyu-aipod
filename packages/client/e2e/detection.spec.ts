import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Skill } from '@tengyu-aipod/shared'
import type Database from 'better-sqlite3'
import sharp from 'sharp'
import { openCollectionDatabase as openWorkbenchDatabase } from '../src/main/lib/collection-record-store'
import { type DetectionBatchConfig, DetectionService } from '../src/main/lib/detection-service'
import { SharpPreprocessPool } from '../src/main/lib/preprocess-pool'

const detectionSkill: Skill = {
  id: 'infringement-v2-e2e',
  module: 'detection',
  category: null,
  platform: null,
  language: null,
  version: '2.0.0',
  enabled: true,
  recommendedModel: 'qwen3-vl-flash',
  notes: null,
  systemPrompt: 'Return JSON with risk_score and reason.',
  variables: [],
}

type OpenDatabase = (workbenchRoot: string) => Pick<Database.Database, 'exec' | 'prepare' | 'close'>

async function createInputImages(root: string) {
  const inputDir = join(root, '02-生图', '03-提取', 'detection-e2e')
  const images: string[] = []
  for (let index = 0; index < 10; index += 1) {
    const transparent = index % 2 === 0
    const imagePath = join(inputDir, `print-${String(index + 1).padStart(2, '0')}.png`)
    await mkdir(dirname(imagePath), { recursive: true })
    if (transparent) {
      await transparentPrint(imagePath, index)
    } else {
      await opaquePrint(imagePath, index)
    }
    images.push(imagePath)
  }
  return images
}

async function transparentPrint(path: string, index: number) {
  const width = 24
  const height = 24
  const pixels = Buffer.alloc(width * height * 4, 0)
  for (let y = 8; y < 16; y += 1) {
    for (let x = 8; x < 16; x += 1) {
      const offset = (y * width + x) * 4
      pixels[offset] = 180 + index
      pixels[offset + 1] = 20 + index
      pixels[offset + 2] = 80 + index
      pixels[offset + 3] = 255
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(path)
}

async function opaquePrint(path: string, index: number) {
  await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 4,
      background: { r: 20 + index, g: 120 + index, b: 210 - index, alpha: 1 },
    },
  })
    .png()
    .toFile(path)
}

function scoreForIndex(index: number) {
  if (index < 4) {
    return 12 + index
  }
  if (index < 7) {
    return 45 + index
  }
  return 78 + index
}

async function listFiles(folder: string) {
  return (await readdir(folder).catch(() => [])).sort()
}

test.describe('detection module E2E', () => {
  let tempRoot = ''

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-detection-e2e-'))
  })

  test.afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('classifies ten images, cleans successful temp files, white-flattens alpha, and retries failures', async () => {
    const workbenchRoot = join(tempRoot, 'workbench')
    const imagePaths = await createInputImages(workbenchRoot)
    const pool = new SharpPreprocessPool(1)
    const service = new DetectionService()
    const progressEvents: unknown[] = []
    const attemptsByInput = new Map<string, number>()
    const dataUrls: string[] = []
    let nextInputIndex = 0
    const openDatabase: OpenDatabase = (root) => openWorkbenchDatabase(root)

    try {
      const result = await service.runDetectionBatch(
        {
          imagePaths,
          skillId: detectionSkill.id,
          model: 'qwen3-vl-flash',
          threshold: { passMax: 39, reviewMax: 69 },
          preprocess: { format: 'jpg', maxSize: 1024, compress: true },
          concurrency: 1,
          maxRetries: 1,
          taskId: 'detection-e2e-success',
        } satisfies DetectionBatchConfig,
        {
          skillCache: { getSkill: async () => detectionSkill },
          createBailianAdapter: () => ({
            visionCompletion: async (request) => {
              const dataUrl = request.messages
                .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
                .find(
                  (part): part is { type: 'image_url'; image_url: { url: string } } =>
                    typeof part === 'object' &&
                    part !== null &&
                    'type' in part &&
                    part.type === 'image_url',
                )?.image_url.url
              if (!dataUrl) {
                throw new Error('missing detection image data URL')
              }
              dataUrls.push(dataUrl)
              const inputIndex = nextInputIndex
              const key = `${inputIndex}`
              const attempt = attemptsByInput.get(key) ?? 0
              attemptsByInput.set(key, attempt + 1)
              if (inputIndex === 0 && attempt === 0) {
                throw new Error('temporary Bailian failure')
              }
              nextInputIndex += 1
              return {
                text: JSON.stringify({
                  risk_score: scoreForIndex(inputIndex),
                  reason: `mock score ${scoreForIndex(inputIndex)}`,
                }),
                model: 'qwen3-vl-flash',
                finishReason: 'stop',
                usage: null,
                raw: {},
              }
            },
          }),
          preprocessPool: pool,
          readConfig: async () => ({ workbench_root: workbenchRoot }),
          getSecret: async () => 'sk-e2e',
          openDatabase,
          emitProgress: (progress) => progressEvents.push(progress),
          tempFileManager: {
            createTaskDir: async (_module, taskId) => {
              const dir = join(workbenchRoot, '.workbench', 'tmp', 'detection', taskId)
              await mkdir(dir, { recursive: true })
              return dir
            },
            cleanupTask: async (_module, taskId, options = {}) => {
              const dir = join(workbenchRoot, '.workbench', 'tmp', 'detection', taskId)
              if (!options.keepIfFailed) {
                await rm(dir, { recursive: true, force: true })
              }
            },
          },
        },
      )

      expect(result).toMatchObject({
        total: 10,
        succeeded: 10,
        failed: 0,
        skipped: 0,
      })
      expect(result.results.map((item) => item.status === 'success' && item.riskLevel)).toEqual([
        'pass',
        'pass',
        'pass',
        'pass',
        'review',
        'review',
        'review',
        'block',
        'block',
        'block',
      ])
      expect(dataUrls).toHaveLength(11)
      expect(attemptsByInput.get('0')).toBe(2)
      expect(progressEvents).toContainEqual(
        expect.objectContaining({
          task_id: 'detection-e2e-success',
          processed: 10,
          succeeded: 10,
          failed: 0,
        }),
      )

      await expect(listFiles(join(workbenchRoot, '03-检测', 'pass'))).resolves.toHaveLength(4)
      await expect(listFiles(join(workbenchRoot, '03-检测', 'review'))).resolves.toHaveLength(3)
      await expect(listFiles(join(workbenchRoot, '03-检测', 'block'))).resolves.toHaveLength(3)
      await expect(
        stat(join(workbenchRoot, '.workbench', 'tmp', 'detection', 'detection-e2e-success')),
      ).rejects.toThrow()

      const flattened = await sharp(Buffer.from(dataUrls[0]?.split(',')[1] ?? '', 'base64'))
        .raw()
        .ensureAlpha()
        .toBuffer()
      expect(Array.from(flattened.subarray(0, 3)).every((channel) => channel >= 248)).toBe(true)
      expect(flattened[3]).toBe(255)
    } finally {
      await pool.close()
    }
  })

  test('keeps failed task temp directory for retry diagnostics', async () => {
    const workbenchRoot = join(tempRoot, 'workbench-failed')
    const imagePaths = await createInputImages(workbenchRoot)
    const pool = new SharpPreprocessPool(1)
    const service = new DetectionService()
    let keptFailedTemp = false

    try {
      const result = await service.runDetectionBatch(
        {
          imagePaths: imagePaths.slice(0, 1),
          skillId: detectionSkill.id,
          model: 'qwen3-vl-flash',
          maxRetries: 0,
          taskId: 'detection-e2e-failed',
        },
        {
          skillCache: { getSkill: async () => detectionSkill },
          createBailianAdapter: () => ({
            visionCompletion: async () => ({ text: 'not json' }),
          }),
          preprocessPool: pool,
          readConfig: async () => ({ workbench_root: workbenchRoot }),
          getSecret: async () => 'sk-e2e',
          openDatabase: (root) => openWorkbenchDatabase(root),
          tempFileManager: {
            createTaskDir: async (_module, taskId) => {
              const dir = join(workbenchRoot, '.workbench', 'tmp', 'detection', taskId)
              await mkdir(dir, { recursive: true })
              return dir
            },
            cleanupTask: async (_module, _taskId, options = {}) => {
              keptFailedTemp = Boolean(options.keepIfFailed)
            },
          },
        },
      )

      expect(result).toMatchObject({ succeeded: 0, failed: 1, skipped: 0 })
      expect(result.results[0]).toMatchObject({
        status: 'failed',
        errorCode: 'llm_parse_failed',
      })
      expect(keptFailedTemp).toBe(true)
    } finally {
      await pool.close()
    }
  })
})
