import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type PreprocessError,
  SharpPreprocessPool,
  resolvePreprocessWorkerCount,
} from './preprocess-pool'

let workbenchRoot = ''
const pools: SharpPreprocessPool[] = []

beforeEach(async () => {
  workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-preprocess-'))
})

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()))
  await rm(workbenchRoot, { recursive: true, force: true })
})

function createPool(size = 1) {
  const pool = new SharpPreprocessPool(size)
  pools.push(pool)
  return pool
}

async function transparentPng(width = 6, height = 4) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 30, g: 60, b: 90, alpha: 0.4 },
    },
  })
    .png()
    .toBuffer()
}

describe('SharpPreprocessPool', () => {
  it('preprocesses buffer input into white-flattened resized JPEG data URLs', async () => {
    const pool = createPool()
    const source = await transparentPng(8, 4)

    const result = await pool.process({
      module: 'title',
      taskId: 'task-1',
      workbenchRoot,
      input: source,
      inputName: 'transparent.png',
      maxSize: 4,
      format: 'jpg',
    })

    const output = await readFile(result.outputPath)
    const metadata = await sharp(output).metadata()
    expect(result.outputPath).toContain(join('.workbench', 'tmp', 'title', 'task-1'))
    expect(result.outputPath).toMatch(/_preprocessed\.jpg$/)
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.sizeBytes).toBe(output.byteLength)
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(metadata.format).toBe('jpeg')
    expect(metadata.width).toBeLessThanOrEqual(4)
  })

  it('supports file input and PNG output', async () => {
    const pool = createPool()
    const inputPath = join(workbenchRoot, 'input.png')
    await writeFile(inputPath, await transparentPng())

    const result = await pool.process({
      module: 'detection',
      taskId: 'task-2',
      workbenchRoot,
      input: inputPath,
      compression: false,
      format: 'png',
    })

    const metadata = await sharp(await readFile(result.outputPath)).metadata()
    expect(result.mimeType).toBe('image/png')
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(metadata.format).toBe('png')
  })

  it('runs queued jobs through the worker pool', async () => {
    const pool = createPool(1)
    const source = await transparentPng()

    await expect(
      pool.processAll([
        {
          module: 'title',
          taskId: 'queued',
          workbenchRoot,
          input: source,
          inputName: 'first.png',
        },
        {
          module: 'title',
          taskId: 'queued',
          workbenchRoot,
          input: source,
          inputName: 'second.png',
        },
      ]),
    ).resolves.toHaveLength(2)
  })

  it('classifies missing file input', async () => {
    const pool = createPool()

    await expect(
      pool.process({
        module: 'title',
        taskId: 'missing',
        workbenchRoot,
        input: join(workbenchRoot, 'missing.png'),
      }),
    ).rejects.toMatchObject({
      kind: 'INPUT_NOT_FOUND',
      retryable: false,
    } satisfies Partial<PreprocessError>)
  })

  it('classifies sharp decode failures', async () => {
    const pool = createPool()

    await expect(
      pool.process({
        module: 'title',
        taskId: 'decode',
        workbenchRoot,
        input: Buffer.from('not an image'),
      }),
    ).rejects.toMatchObject({
      kind: 'SHARP_DECODE_FAILED',
      retryable: false,
    } satisfies Partial<PreprocessError>)
  })

  it('resolves default worker counts from machine specs and overrides', () => {
    expect(resolvePreprocessWorkerCount({ cpuCount: 8, ramGB: 16 })).toBe(4)
    expect(resolvePreprocessWorkerCount({ cpuCount: 4, ramGB: 6 })).toBe(2)
    expect(resolvePreprocessWorkerCount({ cpuCount: 2, ramGB: 16 })).toBe(1)
    expect(resolvePreprocessWorkerCount({ cpuCount: 8, ramGB: 3 })).toBe(1)
    expect(resolvePreprocessWorkerCount({ cpuCount: 8, ramGB: 16, overwrite: 20 })).toBe(8)
    expect(resolvePreprocessWorkerCount({ cpuCount: 8, ramGB: 16, overwrite: 0 })).toBe(1)
  })
})
