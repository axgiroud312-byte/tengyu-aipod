import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Skill } from '@tengyu-aipod/shared'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type DetectionBatchConfig,
  DetectionService,
  classifyRisk,
  parseDetectionResponse,
} from './detection-service'

type TestDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'close'>

type FakeDetectionRow = {
  id: string
  artifactId: string
  taskId: string
  riskScore: number
  riskLevel: string
  reason: string
  model: string
  skillId: string
  skillVersion: string
  thresholdSnapshot: string
  outputPath: string
  createdAt: number
}

let workbenchRoot = ''
let tempRoot = ''

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: workbenchRoot }),
}))

function detectionSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'infringement-v2',
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
    ...overrides,
  }
}

function createFakeDb() {
  const detectionRows: FakeDetectionRow[] = []
  const artifacts = new Map<string, unknown[]>()

  const db = {
    exec: vi.fn(),
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT') && sql.includes('FROM detection_results')) {
        return {
          get: (artifactId: string, model: string, skillId: string, skillVersion: string) =>
            detectionRows
              .filter(
                (row) =>
                  row.artifactId === artifactId &&
                  row.model === model &&
                  row.skillId === skillId &&
                  row.skillVersion === skillVersion,
              )
              .sort((left, right) => right.createdAt - left.createdAt)[0],
        }
      }

      if (sql.includes('INSERT INTO artifacts')) {
        return {
          run: (...values: unknown[]) => {
            artifacts.set(String(values[0]), values)
          },
        }
      }

      if (sql.includes('INSERT INTO detection_results')) {
        return {
          run: (...values: unknown[]) => {
            detectionRows.push({
              id: String(values[0]),
              artifactId: String(values[1]),
              taskId: String(values[2]),
              riskScore: Number(values[3]),
              riskLevel: String(values[4]),
              reason: String(values[5] ?? ''),
              model: String(values[6]),
              skillId: String(values[7]),
              skillVersion: String(values[8]),
              thresholdSnapshot: String(values[9]),
              outputPath: String(values[10]),
              createdAt: Number(values[11]),
            })
          },
        }
      }

      return { run: vi.fn(), get: vi.fn() }
    }),
    close: vi.fn(),
  }

  return {
    detectionRows,
    artifacts,
    openDatabase: () => db as unknown as TestDatabase,
  }
}

async function createImage(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

beforeEach(async () => {
  const { mkdtemp } = await import('node:fs/promises')
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-detection-service-'))
  workbenchRoot = join(tempRoot, 'workbench')
  await mkdir(workbenchRoot, { recursive: true })
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('detection service utilities', () => {
  it('parses JSON, code block, and regex detection responses', () => {
    expect(parseDetectionResponse('{"risk_score": 72, "reason": "疑似影视 IP"}')).toEqual({
      score: 72,
      reason: '疑似影视 IP',
    })
    expect(parseDetectionResponse('```json\n{"score": "45", "reason": "卡通相似"}\n```')).toEqual({
      score: 45,
      reason: '卡通相似',
    })
    expect(parseDetectionResponse('风险值：105\n依据：包含商标')).toEqual({
      score: 100,
      reason: '包含商标',
    })
    expect(parseDetectionResponse('无法判断')).toBeNull()
  })

  it('classifies score by configurable thresholds', () => {
    expect(classifyRisk(39)).toBe('pass')
    expect(classifyRisk(40)).toBe('review')
    expect(classifyRisk(70)).toBe('block')
    expect(classifyRisk(50, { passMax: 50, reviewMax: 80 })).toBe('pass')
    expect(classifyRisk(81, { passMax: 50, reviewMax: 80 })).toBe('block')
  })
})

describe('DetectionService', () => {
  it('preprocesses, calls Bailian with JSON response format, copies outputs, stores results, and emits progress', async () => {
    const imagePaths = [
      join(tempRoot, 'inputs', 'print-a.png'),
      join(tempRoot, 'inputs', 'print-b.png'),
      join(tempRoot, 'inputs', 'print-c.png'),
    ]
    await Promise.all(imagePaths.map((path, index) => createImage(path, `image-${index}`)))
    const fakeDb = createFakeDb()
    const progress: unknown[] = []
    const visionCompletion = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"risk_score": 12, "reason": "原创图案"}' })
      .mockResolvedValueOnce({ text: '{"risk_score": 55, "reason": "卡通相似"}' })
      .mockResolvedValueOnce({ text: '{"risk_score": 88, "reason": "明显商标"}' })
    const preprocess = vi.fn(async (options: { taskId: string; inputName?: string }) => {
      const outputPath = join(
        workbenchRoot,
        '.workbench',
        'tmp',
        'detection',
        options.taskId,
        `${options.inputName ?? 'image'}_processed.jpg`,
      )
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, 'processed')
      return {
        outputPath,
        mimeType: 'image/jpeg',
        sizeBytes: 9,
        dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
      }
    })
    const service = new DetectionService()

    const result = await service.runDetectionBatch(
      {
        imagePaths,
        skillId: 'infringement-v2',
        model: 'qwen3-vl-flash',
        threshold: { passMax: 39, reviewMax: 69 },
        concurrency: 1,
        taskId: 'task-detection',
      } satisfies DetectionBatchConfig,
      {
        skillCache: { getSkill: vi.fn().mockResolvedValue(detectionSkill()) },
        createBailianAdapter: () => ({ visionCompletion }),
        preprocessPool: { process: preprocess, close: vi.fn() },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        openDatabase: fakeDb.openDatabase,
        emitProgress: (item) => progress.push(item),
      },
    )

    expect(result).toMatchObject({
      total: 3,
      succeeded: 3,
      failed: 0,
      skipped: 0,
    })
    expect(result.results.map((item) => item.status === 'success' && item.riskLevel)).toEqual([
      'pass',
      'review',
      'block',
    ])
    expect(visionCompletion).toHaveBeenCalledTimes(3)
    expect(visionCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: { type: 'json_object' } }),
    )
    expect(preprocess).toHaveBeenCalledTimes(3)
    expect(fakeDb.detectionRows).toHaveLength(3)
    await expect(stat(join(workbenchRoot, '03-检测', 'pass'))).resolves.toBeTruthy()
    await expect(stat(join(workbenchRoot, '03-检测', 'review'))).resolves.toBeTruthy()
    await expect(stat(join(workbenchRoot, '03-检测', 'block'))).resolves.toBeTruthy()
    expect(progress).toContainEqual(
      expect.objectContaining({ task_id: 'task-detection', processed: 3, succeeded: 3 }),
    )
    await expect(
      stat(join(workbenchRoot, '.workbench', 'tmp', 'detection', 'task-detection')),
    ).rejects.toThrow()
  })

  it('skips cached detections for the same image, model, skill, and version', async () => {
    const imagePath = join(tempRoot, 'inputs', 'cached.png')
    await createImage(imagePath, 'same-image')
    const fakeDb = createFakeDb()
    const service = new DetectionService()
    const baseConfig = {
      imagePaths: [imagePath],
      skillId: 'infringement-v2',
      model: 'qwen3-vl-flash',
      concurrency: 1,
    } satisfies DetectionBatchConfig
    const skill = detectionSkill()
    const firstPreprocess = vi.fn(async (options: { taskId: string; inputName?: string }) => {
      const outputPath = join(
        workbenchRoot,
        '.workbench',
        'tmp',
        'detection',
        options.taskId,
        `${options.inputName ?? 'image'}_processed.jpg`,
      )
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, 'processed')
      return {
        outputPath,
        mimeType: 'image/jpeg',
        sizeBytes: 9,
        dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
      }
    })
    const firstVision = vi
      .fn()
      .mockResolvedValue({ text: '{"risk_score": 22, "reason": "低风险"}' })

    await service.runDetectionBatch(
      { ...baseConfig, taskId: 'first-run' },
      {
        skillCache: { getSkill: vi.fn().mockResolvedValue(skill) },
        createBailianAdapter: () => ({ visionCompletion: firstVision }),
        preprocessPool: { process: firstPreprocess, close: vi.fn() },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        openDatabase: fakeDb.openDatabase,
      },
    )

    const secondPreprocess = vi.fn()
    const secondVision = vi.fn()
    const second = await service.runDetectionBatch(
      { ...baseConfig, taskId: 'second-run' },
      {
        skillCache: { getSkill: vi.fn().mockResolvedValue(skill) },
        createBailianAdapter: () => ({ visionCompletion: secondVision }),
        preprocessPool: { process: secondPreprocess, close: vi.fn() },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        openDatabase: fakeDb.openDatabase,
      },
    )

    expect(second).toMatchObject({ succeeded: 0, failed: 0, skipped: 1 })
    expect(second.results[0]).toMatchObject({
      status: 'skipped',
      riskScore: 22,
      riskLevel: 'pass',
      cached: true,
    })
    expect(secondPreprocess).not.toHaveBeenCalled()
    expect(secondVision).not.toHaveBeenCalled()
  })

  it('marks unparseable model output as llm_parse_failed without copying to risk folders', async () => {
    const imagePath = join(tempRoot, 'inputs', 'bad-output.png')
    await createImage(imagePath, 'bad-output')
    const fakeDb = createFakeDb()
    const outputPath = join(workbenchRoot, '.workbench', 'tmp', 'detection', 'parse-fail', 'p.jpg')
    const service = new DetectionService()

    const result = await service.runDetectionBatch(
      {
        imagePaths: [imagePath],
        skillId: 'infringement-v2',
        model: 'qwen3-vl-flash',
        maxRetries: 0,
        taskId: 'parse-fail',
      },
      {
        skillCache: { getSkill: vi.fn().mockResolvedValue(detectionSkill()) },
        createBailianAdapter: () => ({
          visionCompletion: vi.fn().mockResolvedValue({ text: 'not json' }),
        }),
        preprocessPool: {
          process: vi.fn(async () => {
            await mkdir(dirname(outputPath), { recursive: true })
            await writeFile(outputPath, 'processed')
            return {
              outputPath,
              mimeType: 'image/jpeg',
              sizeBytes: 9,
              dataUrl: 'data:image/jpeg;base64,cHJvY2Vzc2Vk',
            }
          }),
          close: vi.fn(),
        },
        readConfig: async () => ({ workbench_root: workbenchRoot }),
        getSecret: async () => 'sk-test',
        openDatabase: fakeDb.openDatabase,
      },
    )

    expect(result).toMatchObject({ succeeded: 0, failed: 1, skipped: 0 })
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      errorCode: 'llm_parse_failed',
    })
    expect(fakeDb.detectionRows).toHaveLength(0)
    await expect(stat(join(workbenchRoot, '03-检测'))).rejects.toThrow()
  })
})
