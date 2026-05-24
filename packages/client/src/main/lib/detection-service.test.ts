import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Skill } from '@tengyu-aipod/shared'
import Database from 'better-sqlite3'
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

type MattingArtifactRow = {
  task_id: string
  print_id: string
  step: string
  provider: string
  source_artifact_ids: string
  file_path: string
  file_size: number
  file_hash: string
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

function createSqliteDependencies() {
  return {
    readConfig: async () => ({ workbench_root: workbenchRoot }),
    openDatabase: (_workbenchRoot: string) =>
      new Database(join(workbenchRoot, '.workbench', 'workbench.db')),
  }
}

async function initializeDetectionSqlite(
  service: DetectionService,
  dependencies: ReturnType<typeof createSqliteDependencies>,
) {
  await mkdir(join(workbenchRoot, '.workbench'), { recursive: true })
  await service.listResults({}, dependencies)
}

function seedDetectionResult(
  db: Database.Database,
  input: {
    artifactId: string
    detectionId: string
    taskId: string
    printId: string
    sourcePath: string
  },
) {
  db.prepare(`
    INSERT INTO artifacts (
      id,
      task_id,
      print_id,
      step,
      provider,
      source_artifact_ids,
      file_path,
      file_size,
      file_hash,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.artifactId,
    input.taskId,
    input.printId,
    'manual-import',
    'manual-import',
    '[]',
    input.sourcePath,
    10,
    'seed-hash',
    1000,
  )
  db.prepare(`
    INSERT INTO detection_results (
      id,
      artifact_id,
      task_id,
      risk_score,
      risk_level,
      reason,
      model,
      skill_id,
      skill_version,
      threshold_snapshot,
      output_path,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.detectionId,
    input.artifactId,
    input.taskId,
    12,
    'pass',
    '原创图案',
    'qwen3-vl-flash',
    'infringement-v2',
    '2.0.0',
    '{"passMax":39,"reviewMax":69}',
    input.sourcePath,
    1001,
  )
}

function readMattingArtifacts(
  openDatabase: ReturnType<typeof createSqliteDependencies>['openDatabase'],
) {
  const db = openDatabase(workbenchRoot)
  try {
    return db
      .prepare(
        `
          SELECT
            task_id,
            print_id,
            step,
            provider,
            source_artifact_ids,
            file_path,
            file_size,
            file_hash
          FROM artifacts
          WHERE step = ?
        `,
      )
      .all('matting') as MattingArtifactRow[]
  } finally {
    db.close()
  }
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

  it('copies detected pass images to matting and records artifact rows in sqlite', async () => {
    const sourcePath = join(workbenchRoot, '03-检测', 'pass', 'pri-pass.png')
    await createImage(sourcePath, 'pass-image')
    const service = new DetectionService()
    const dependencies = createSqliteDependencies()

    await initializeDetectionSqlite(service, dependencies)
    const db = dependencies.openDatabase(workbenchRoot)
    try {
      seedDetectionResult(db, {
        artifactId: 'art-pass',
        detectionId: 'det-pass',
        taskId: 'task-pass',
        printId: 'pri-pass',
        sourcePath,
      })
    } finally {
      db.close()
    }

    const promoted = await service.promoteToMatting(
      { artifact_ids: ['art-pass'], mode: 'copy' },
      dependencies,
    )

    const targetPath = join(workbenchRoot, '04-待套版印花', 'pri-pass.png')
    expect(promoted).toBe(1)
    await expect(stat(sourcePath)).resolves.toBeTruthy()
    await expect(stat(targetPath)).resolves.toBeTruthy()

    const mattingRows = readMattingArtifacts(dependencies.openDatabase)
    expect(mattingRows).toHaveLength(1)
    const mattingRow = mattingRows[0]
    if (!mattingRow) {
      throw new Error('Expected promoted matting artifact row')
    }
    expect(mattingRow).toMatchObject({
      task_id: 'task-pass',
      print_id: 'pri-pass',
      step: 'matting',
      provider: 'detection-promote',
      file_path: targetPath,
      file_size: 10,
    })
    expect(JSON.parse(mattingRow.source_artifact_ids)).toEqual(['art-pass'])
    expect(mattingRow.file_hash).toMatch(/^[a-f0-9]{64}$/)

    const verifyDb = dependencies.openDatabase(workbenchRoot)
    try {
      const detectionRows = verifyDb
        .prepare(
          `
            SELECT risk_level, output_path
            FROM detection_results
            WHERE artifact_id = ?
          `,
        )
        .all('art-pass')
      expect(detectionRows).toEqual([{ risk_level: 'pass', output_path: sourcePath }])
    } finally {
      verifyDb.close()
    }
  })

  it('moves detected pass images to matting when requested', async () => {
    const sourcePath = join(workbenchRoot, '03-检测', 'pass', 'pri-move.png')
    await createImage(sourcePath, 'pass-image')
    const service = new DetectionService()
    const dependencies = createSqliteDependencies()

    await initializeDetectionSqlite(service, dependencies)
    const db = dependencies.openDatabase(workbenchRoot)
    try {
      seedDetectionResult(db, {
        artifactId: 'art-move',
        detectionId: 'det-move',
        taskId: 'task-move',
        printId: 'pri-move',
        sourcePath,
      })
    } finally {
      db.close()
    }

    const promoted = await service.promoteToMatting(
      { artifact_ids: ['art-move'], mode: 'move' },
      dependencies,
    )

    const targetPath = join(workbenchRoot, '04-待套版印花', 'pri-move.png')
    expect(promoted).toBe(1)
    await expect(stat(sourcePath)).rejects.toThrow()
    await expect(stat(targetPath)).resolves.toBeTruthy()

    const mattingRows = readMattingArtifacts(dependencies.openDatabase)
    expect(mattingRows).toHaveLength(1)
    expect(mattingRows[0]).toMatchObject({
      task_id: 'task-move',
      print_id: 'pri-move',
      step: 'matting',
      provider: 'detection-promote',
      file_path: targetPath,
      file_size: 10,
    })
    expect(JSON.parse(mattingRows[0]?.source_artifact_ids ?? '[]')).toEqual(['art-move'])
  })
})
