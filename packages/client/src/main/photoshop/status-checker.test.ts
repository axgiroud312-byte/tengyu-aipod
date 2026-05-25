import { describe, expect, it } from 'vitest'
import { PhotoshopStatusChecker } from './status-checker'

function createChecker(overrides: {
  platform?: NodeJS.Platform
  registryOutput?: string
  tasklistOutput?: string
  comVersion?: string
  comError?: Error
}) {
  return new PhotoshopStatusChecker({
    platform: overrides.platform ?? 'win32',
    now: () => 1234,
    execFile: async (file, args) => {
      if (file === 'reg') {
        if (!overrides.registryOutput) {
          throw new Error(`missing registry key: ${args.join(' ')}`)
        }
        return { stdout: overrides.registryOutput, stderr: '' }
      }
      if (file === 'tasklist') {
        return { stdout: overrides.tasklistOutput ?? '', stderr: '' }
      }
      if (file === 'powershell.exe') {
        if (overrides.comError) {
          throw overrides.comError
        }
        return { stdout: overrides.comVersion ?? '26.0.0', stderr: '' }
      }
      throw new Error(`unexpected command: ${file}`)
    },
  })
}

describe('PhotoshopStatusChecker', () => {
  it('returns unavailable status on non-Windows without probing COM', async () => {
    const checker = createChecker({
      platform: 'darwin',
      registryOutput: 'ApplicationPath    REG_SZ    C:\\Program Files\\Adobe',
      tasklistOutput: '"Photoshop.exe","1234"',
    })

    await expect(checker.check()).resolves.toEqual({
      installed: false,
      running: false,
      com_connected: false,
      version: null,
      last_check_at: 1234,
    })
  })

  it('detects installed, running, and COM-connected Photoshop on Windows', async () => {
    const checker = createChecker({
      registryOutput: 'ApplicationPath    REG_SZ    C:\\Program Files\\Adobe\\Adobe Photoshop 2026',
      tasklistOutput: '"Photoshop.exe","1234","Console","1","100,000 K"',
      comVersion: '27.0.0',
    })

    await expect(checker.check()).resolves.toEqual({
      installed: true,
      running: true,
      com_connected: true,
      version: '27.0.0',
      last_check_at: 1234,
    })
  })

  it('returns PS_NOT_RUNNING when installed but no Photoshop process exists', async () => {
    const checker = createChecker({
      registryOutput: 'ApplicationPath    REG_SZ    C:\\Program Files\\Adobe\\Adobe Photoshop 2026',
      tasklistOutput: 'INFO: No tasks are running which match the specified criteria.',
    })

    await expect(checker.check()).resolves.toMatchObject({
      installed: true,
      running: false,
      com_connected: false,
      version: null,
      error_code: 'PS_NOT_RUNNING',
    })
  })

  it('surfaces COM connection failures without throwing', async () => {
    const checker = createChecker({
      registryOutput: 'ApplicationPath    REG_SZ    C:\\Program Files\\Adobe\\Adobe Photoshop 2026',
      tasklistOutput: '"Photoshop.exe","1234","Console","1","100,000 K"',
      comError: new Error('COM library failed to load'),
    })

    await expect(checker.check()).resolves.toMatchObject({
      installed: true,
      running: true,
      com_connected: false,
      version: null,
      error_code: 'PS_COM_FAILED',
      error_message: 'COM library failed to load',
    })
  })
})
