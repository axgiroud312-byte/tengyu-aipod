import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoshopComAdapter } from './com-adapter'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tengyu-ps-com-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createAdapter(options: {
  platform?: NodeJS.Platform
  bridgeFactory?: NonNullable<ConstructorParameters<typeof PhotoshopComAdapter>[0]>['bridgeFactory']
  execFile?: (
    file: string,
    args: string[],
    options?: { timeoutMs: number },
  ) => Promise<{ stdout: string; stderr: string }>
  jsxTimeoutMs?: number
}) {
  const adapterOptions: ConstructorParameters<typeof PhotoshopComAdapter>[0] = {
    platform: options.platform ?? 'win32',
  }
  if (options.execFile) {
    adapterOptions.execFile = options.execFile
  }
  if (options.bridgeFactory) {
    adapterOptions.bridgeFactory = options.bridgeFactory
  }
  if (options.jsxTimeoutMs !== undefined) {
    Object.assign(adapterOptions, { jsxTimeoutMs: options.jsxTimeoutMs })
  }
  return new PhotoshopComAdapter(adapterOptions)
}

describe('PhotoshopComAdapter', () => {
  it('reuses one persistent bridge and releases it on dispose', async () => {
    const requests: string[] = []
    let bridgeCreations = 0
    let bridgeDisposals = 0
    const adapter = createAdapter({
      bridgeFactory: () => {
        bridgeCreations += 1
        return {
          request: async (request) => {
            requests.push(request.operation)
            return request.operation === 'getVersion' ? { version: '27.8.0' } : {}
          },
          dispose: () => {
            bridgeDisposals += 1
          },
        }
      },
    })
    const jsxPath = join(tempDir, 'job.jsx')
    await writeFile(jsxPath, 'app.version', 'utf8')

    await expect(adapter.getVersion()).resolves.toBe('27.8.0')
    await expect(adapter.runJsxFile(jsxPath)).resolves.toBeUndefined()
    await adapter.dispose()

    expect(bridgeCreations).toBe(1)
    expect(requests).toEqual(['getVersion', 'runJsxFile'])
    expect(bridgeDisposals).toBe(1)
  })

  it('disposes the bridge immediately while a COM request is pending', async () => {
    let rejectRequest: ((error: Error) => void) | undefined
    let bridgeDisposals = 0
    const adapter = createAdapter({
      bridgeFactory: () => ({
        request: () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject
          }),
        dispose: () => {
          bridgeDisposals += 1
        },
      }),
    })
    const versionRequest = adapter.getVersion()
    const requestExpectation = expect(versionRequest).rejects.toThrow('bridge stopped')
    await vi.waitFor(() => expect(rejectRequest).toBeTypeOf('function'))

    void adapter.dispose()
    const immediateDisposals = bridgeDisposals
    rejectRequest?.(new Error('bridge stopped'))
    await requestExpectation
    expect(immediateDisposals).toBe(1)
  })

  it('requires three successful JSX probes before reporting Photoshop ready', async () => {
    const requests: string[] = []
    const adapter = createAdapter({
      bridgeFactory: () => ({
        request: async (request) => {
          requests.push(request.operation)
          return { version: '27.8.0' }
        },
        dispose: () => undefined,
      }),
    })

    await expect(adapter.ensureReady()).resolves.toBe('27.8.0')
    expect(requests).toEqual(['probe', 'probe', 'probe'])
  })

  it('rejects non-Windows platforms with AppError', async () => {
    const adapter = createAdapter({ platform: 'darwin' })

    await expect(adapter.getVersion()).rejects.toMatchObject({
      code: 'PS_UNSUPPORTED_PLATFORM',
      retryable: false,
    })
  })

  it('gets Photoshop version through the COM bridge', async () => {
    const adapter = createAdapter({
      execFile: async (file, args) => {
        expect(file).toBe('powershell.exe')
        expect(args).toContain('-NonInteractive')
        expect(args.at(-1)).toContain('Photoshop.Application')
        return { stdout: '27.7.0\r\n', stderr: '' }
      },
    })

    await expect(adapter.getVersion()).resolves.toBe('27.7.0')
  })

  it('runs JSX files through DoJavaScriptFile', async () => {
    const jsxPath = join(tempDir, 'job.jsx')
    await writeFile(jsxPath, 'alert("ok")', 'utf8')
    const adapter = createAdapter({
      execFile: async (_file, args) => {
        expect(args.at(-1)).toContain('DoJavaScriptFile')
        expect(args.at(-1)).toContain(jsxPath.replaceAll("'", "''"))
        return { stdout: '', stderr: '' }
      },
    })

    await expect(adapter.runJsxFile(jsxPath)).resolves.toBeUndefined()
  })

  it('classifies JSX execution failures', async () => {
    const jsxPath = join(tempDir, 'bad.jsx')
    await writeFile(jsxPath, 'throw new Error("bad")', 'utf8')
    const adapter = createAdapter({
      execFile: async () => {
        throw new Error('syntax error')
      },
    })

    await expect(adapter.runJsxFile(jsxPath)).rejects.toMatchObject({
      code: 'JSX_EXEC_FAILED',
      retryable: false,
    })
  })

  it('keeps JSX COM connection failures retryable', async () => {
    const jsxPath = join(tempDir, 'com-disconnected.jsx')
    await writeFile(jsxPath, 'alert("ok")', 'utf8')
    const adapter = createAdapter({
      execFile: async () => {
        throw new Error('Invalid class string: Photoshop.Application')
      },
    })

    await expect(adapter.runJsxFile(jsxPath)).rejects.toMatchObject({
      code: 'PS_COM_FAILED',
      retryable: true,
    })
  })

  it('keeps bridge COM server activation failures retryable', async () => {
    const jsxPath = join(tempDir, 'bridge-disconnected.jsx')
    await writeFile(jsxPath, 'app.version', 'utf8')
    const adapter = createAdapter({
      bridgeFactory: () => ({
        request: async () => {
          throw new Error('COM server execution failed (HRESULT: 0x80080005)')
        },
        dispose: () => undefined,
      }),
    })

    await expect(adapter.runJsxFile(jsxPath)).rejects.toMatchObject({
      code: 'PS_COM_FAILED',
      retryable: true,
    })
  })

  it('applies a JSX watchdog and classifies timeouts as retryable', async () => {
    const jsxPath = join(tempDir, 'slow.jsx')
    await writeFile(jsxPath, 'while (true) {}', 'utf8')
    let timeoutMs: number | undefined
    const adapter = createAdapter({
      jsxTimeoutMs: 25,
      execFile: async (_file, _args, options) => {
        timeoutMs = options?.timeoutMs
        throw Object.assign(new Error('operation timed out'), {
          code: 'ETIMEDOUT',
          killed: true,
        })
      },
    })

    await expect(adapter.runJsxFile(jsxPath)).rejects.toMatchObject({
      code: 'JSX_EXEC_FAILED',
      retryable: true,
      details: { timeout_ms: 25 },
    })
    expect(timeoutMs).toBe(25)
  })

  it('requires mutation guard before closing documents', async () => {
    const adapter = createAdapter({})

    await expect(adapter.closeAll({ allowUnsavedClose: false })).rejects.toMatchObject({
      code: 'PS_COM_FAILED',
      retryable: false,
    })
  })

  it('runs real Photoshop COM version check when REAL_PS=1', async () => {
    if (process.env.REAL_PS !== '1') {
      return
    }

    const adapter = createAdapter({})
    try {
      const version = await adapter.getVersion()
      const readyVersion = await adapter.ensureReady()

      expect(version).toMatch(/^\d+(\.\d+)*$/)
      expect(readyVersion).toMatch(/^\d+(\.\d+)*$/)
    } finally {
      adapter.dispose()
    }
  }, 30_000)
})
