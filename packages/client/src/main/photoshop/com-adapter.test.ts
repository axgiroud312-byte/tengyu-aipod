import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
}) {
  const adapterOptions: ConstructorParameters<typeof PhotoshopComAdapter>[0] = {
    platform: options.platform ?? 'win32',
  }
  if (options.execFile) {
    adapterOptions.execFile = options.execFile
  }
  return new PhotoshopComAdapter(adapterOptions)
}

describe('PhotoshopComAdapter', () => {
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
    const version = await adapter.getVersion()

    expect(version).toMatch(/^\d+(\.\d+)*$/)
  })
})
