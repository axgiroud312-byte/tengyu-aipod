import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeDiagnosticValue } from './diagnostic-log-service'
import {
  type VideoCompletedEvent,
  VideoGenerationService,
  type VideoImageMetadata,
  type VideoRunInput,
  buildHappyHorsePayload,
  mapHappyHorseTaskStatus,
  registerVideoGenerationIpc,
  resolveHappyHorseModel,
  validateVideoImages,
  videoOutputPath,
  videoTaskId,
} from './video-generation-service'

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  shellOpenPath: vi.fn(),
  browserWindows: [] as Array<{
    webContents: { send: (channel: string, payload: unknown) => void }
  }>,
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => electronMocks.browserWindows,
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler)
    },
  },
  shell: {
    openPath: electronMocks.shellOpenPath,
  },
}))

let workbenchRoot = ''

beforeEach(async () => {
  workbenchRoot = await mkdtemp(join(tmpdir(), 'tengyu-video-'))
  await mkdir(join(workbenchRoot, WORKBENCH_DIRECTORIES.video), { recursive: true })
  electronMocks.handlers.clear()
  electronMocks.showOpenDialog.mockReset()
  electronMocks.shellOpenPath.mockReset()
  electronMocks.browserWindows.length = 0
})

afterEach(async () => {
  if (workbenchRoot) {
    await rm(workbenchRoot, { recursive: true, force: true })
  }
})

describe('video generation service helpers', () => {
  it('maps page model version to provider model', () => {
    expect(resolveHappyHorseModel('image-to-video', 'happyhorse-1.1')).toBe('happyhorse-1.1-i2v')
    expect(resolveHappyHorseModel('reference-to-video', 'happyhorse-1.0')).toBe(
      'happyhorse-1.0-r2v',
    )
  })

  it('maps task status safely', () => {
    expect(mapHappyHorseTaskStatus('PENDING')).toBe('PENDING')
    expect(mapHappyHorseTaskStatus('weird')).toBe('UNKNOWN')
  })

  it('sanitizes empty task name to timestamp', () => {
    expect(videoTaskId('\u0001 . ', new Date(2026, 5, 30, 12, 34, 56).getTime())).toBe(
      '20260630-123456',
    )
  })

  it('builds output path under the video workspace', () => {
    expect(videoOutputPath(workbenchRoot, 'image-to-video', 'test task')).toBe(
      join(workbenchRoot, '05-视频工作区', '图生视频', 'test task', '0001.mp4'),
    )
  })

  it('builds image-to-video payload without ratio', () => {
    const payload = buildHappyHorsePayload(
      {
        mode: 'image-to-video',
        prompt: '',
        imagePaths: ['/tmp/a.png'],
        modelVersion: 'happyhorse-1.1',
        resolution: '720P',
        duration: 5,
        watermark: false,
      },
      [mockImage('/tmp/a.png')],
    )
    expect(payload).toMatchObject({
      model: 'happyhorse-1.1-i2v',
      input: {
        media: [{ type: 'first_frame' }],
      },
      parameters: {
        resolution: '720P',
        duration: 5,
        watermark: false,
      },
    })
    expect(payload).not.toHaveProperty('parameters.ratio')
    expect(payload).not.toHaveProperty('input.prompt')
  })

  it('builds reference-to-video payload with ratio and prompt', () => {
    const payload = buildHappyHorsePayload(
      {
        mode: 'reference-to-video',
        prompt: '[Image 1] walk',
        imagePaths: ['/tmp/a.png'],
        modelVersion: 'happyhorse-1.0',
        resolution: '1080P',
        duration: 10,
        watermark: true,
        ratio: '9:16',
      },
      [mockImage('/tmp/a.png')],
    )
    expect(payload).toMatchObject({
      model: 'happyhorse-1.0-r2v',
      input: {
        prompt: '[Image 1] walk',
        media: [{ type: 'reference_image' }],
      },
      parameters: {
        resolution: '1080P',
        duration: 10,
        watermark: true,
        ratio: '9:16',
      },
    })
  })

  it('redacts api key and base64 payload in diagnostics data', () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`
    expect(
      sanitizeDiagnosticValue({
        apiKey: 'sk-secret',
        media: [{ url: dataUrl }],
      }),
    ).toMatchObject({
      apiKey: '[REDACTED]',
      media: [{ url: { redacted: 'data-url', mime: 'image/png' } }],
    })
  })
})

describe('video image validation', () => {
  it('accepts a valid first frame image', async () => {
    const imagePath = join(workbenchRoot, 'frame.png')
    await createPng(imagePath, 600, 600)
    await expect(validateVideoImages('image-to-video', [imagePath])).resolves.toHaveLength(1)
  })

  it('rejects invalid image count for image-to-video', async () => {
    await expect(validateVideoImages('image-to-video', [])).rejects.toMatchObject({
      message: '图生视频只能选择 1 张首帧图',
    })
  })

  it('rejects unsupported image extension', async () => {
    const imagePath = join(workbenchRoot, 'frame.gif')
    await writeFile(imagePath, 'gif')
    await expect(validateVideoImages('image-to-video', [imagePath])).rejects.toMatchObject({
      message: '只支持 JPEG、PNG、WEBP 图片',
    })
  })

  it('rejects too small first frame image', async () => {
    const imagePath = join(workbenchRoot, 'small.png')
    await createPng(imagePath, 200, 200)
    await expect(validateVideoImages('image-to-video', [imagePath])).rejects.toMatchObject({
      message: '首帧图宽高都不能小于 300px',
    })
  })

  it('rejects invalid first frame ratio', async () => {
    const imagePath = join(workbenchRoot, 'ratio.png')
    await createPng(imagePath, 1000, 350)
    await expect(validateVideoImages('image-to-video', [imagePath])).rejects.toMatchObject({
      message: '首帧图宽高比必须在 1:2.5 到 2.5:1 之间',
    })
  })

  it('rejects too many reference images', async () => {
    const paths = await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const imagePath = join(workbenchRoot, `ref-${index}.png`)
        await createPng(imagePath, 500, 500)
        return imagePath
      }),
    )
    await expect(validateVideoImages('reference-to-video', paths)).rejects.toMatchObject({
      message: '参考生视频需要 1-9 张参考图',
    })
  })

  it('rejects too small reference image', async () => {
    const imagePath = join(workbenchRoot, 'ref-small.png')
    await createPng(imagePath, 399, 600)
    await expect(validateVideoImages('reference-to-video', [imagePath])).rejects.toMatchObject({
      message: '参考图短边不能低于 400px',
    })
  })
})

describe('video ipc', () => {
  it('rejects invalid video:run input at the IPC boundary', () => {
    registerVideoGenerationIpc()
    const handler = electronMocks.handlers.get('video:run')
    if (!handler) {
      throw new Error('video:run handler was not registered')
    }
    let thrown: unknown
    try {
      handler({}, { mode: 'image-to-video' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects invalid video:stop input at the IPC boundary', () => {
    registerVideoGenerationIpc()
    const handler = electronMocks.handlers.get('video:stop')
    if (!handler) {
      throw new Error('video:stop handler was not registered')
    }
    expect(() => handler({}, { task_id: '' })).toThrow('视频停止参数不正确')
  })

  it('rejects invalid video:open-path input at the IPC boundary', () => {
    registerVideoGenerationIpc()
    const handler = electronMocks.handlers.get('video:open-path')
    if (!handler) {
      throw new Error('video:open-path handler was not registered')
    }
    expect(() => handler({}, { path: '' })).toThrow('视频打开路径参数不正确')
  })
})

describe('video generation service run', () => {
  it('fails when output file already exists', async () => {
    const imagePath = join(workbenchRoot, 'frame.png')
    const outputPath = videoOutputPath(workbenchRoot, 'image-to-video', '冲突任务')
    await createPng(imagePath, 600, 600)
    await mkdir(join(workbenchRoot, WORKBENCH_DIRECTORIES.video, '图生视频', '冲突任务'), {
      recursive: true,
    })
    await writeFile(outputPath, 'existing mp4')

    const createFetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/services/aigc/video-generation/video-synthesis')) {
        return jsonResponse({ output: { task_id: 'remote-task-1' } })
      }
      if (url.endsWith('/tasks/remote-task-1')) {
        return jsonResponse({
          output: {
            task_id: 'remote-task-1',
            task_status: 'SUCCEEDED',
            video_url: 'https://example.com/video.mp4',
          },
        })
      }
      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const completed = waitForCompletedEvent()
    const service = new VideoGenerationService({
      readConfig: async () => ({ workbench_root: workbenchRoot }),
      getSecret: async () => 'sk-test',
      createFetch: createFetchMock as typeof fetch,
      sleep: async () => {},
    })

    const taskId = await service.run({
      mode: 'image-to-video',
      taskName: '冲突任务',
      imagePaths: [imagePath],
      modelVersion: 'happyhorse-1.1',
      resolution: '720P',
      duration: 5,
      watermark: false,
    })
    const event = await completed

    expect(event).toMatchObject({
      ok: false,
      task_id: taskId,
      error: '保存目录里已存在 0001.mp4，请更换任务名或删除旧文件后重试。',
    })
    expect(createFetchMock).toHaveBeenCalledTimes(2)
  })
})

async function createPng(path: string, width: number, height: number) {
  const sharp = (await import('sharp')).default
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toFile(path)
}

function mockImage(path: string): VideoImageMetadata {
  return {
    path,
    name: 'a.png',
    mime: 'image/png',
    bytes: 10,
    sha256: 'hash',
    width: 600,
    height: 600,
    dataUrl: 'data:image/png;base64,aaa',
  }
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function waitForCompletedEvent() {
  return new Promise<VideoCompletedEvent>((resolve) => {
    electronMocks.browserWindows.push({
      webContents: {
        send: (channel, payload) => {
          if (channel === 'video:completed') {
            resolve(payload as VideoCompletedEvent)
          }
        },
      },
    })
  })
}
