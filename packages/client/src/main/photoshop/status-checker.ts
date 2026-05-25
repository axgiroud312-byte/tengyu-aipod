import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PhotoshopStatus } from '@tengyu-aipod/shared'

type ExecFileResult = { stdout: string; stderr: string }
type ExecFileFn = (file: string, args: string[]) => Promise<ExecFileResult>

interface PhotoshopStatusCheckerOptions {
  platform?: NodeJS.Platform
  now?: () => number
  execFile?: ExecFileFn
}

const execFileAsync = promisify(nodeExecFile)

const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Adobe\\Photoshop',
  'HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop',
  'HKCU\\SOFTWARE\\Adobe\\Photoshop',
]

const WINDOWS_UNAVAILABLE_STATUS = {
  installed: false,
  running: false,
  com_connected: false,
  version: null,
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return null
}

function hasApplicationPath(registryOutput: string): boolean {
  return /ApplicationPath\s+REG_\w+\s+.+/i.test(registryOutput)
}

function hasPhotoshopProcess(tasklistOutput: string): boolean {
  return tasklistOutput.toLowerCase().includes('photoshop.exe')
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export class PhotoshopStatusChecker {
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly execFile: ExecFileFn

  constructor(options: PhotoshopStatusCheckerOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? Date.now
    this.execFile =
      options.execFile ??
      (async (file, args) => {
        const result = await execFileAsync(file, args, { windowsHide: true })
        return { stdout: result.stdout, stderr: result.stderr }
      })
  }

  async check(): Promise<PhotoshopStatus> {
    const lastCheckAt = this.now()

    if (this.platform !== 'win32') {
      return {
        ...WINDOWS_UNAVAILABLE_STATUS,
        last_check_at: lastCheckAt,
      }
    }

    const installed = await this.checkInstalled()
    const running = await this.checkRunning()
    if (!running) {
      return {
        installed,
        running,
        com_connected: false,
        version: null,
        last_check_at: lastCheckAt,
        error_code: installed ? 'PS_NOT_RUNNING' : 'PS_NOT_INSTALLED',
        error_message: installed ? 'Photoshop is not running' : 'Photoshop is not installed',
      }
    }

    const com = await this.tryConnectCom()
    return {
      installed,
      running,
      com_connected: com.connected,
      version: com.version,
      last_check_at: lastCheckAt,
      ...(com.connected
        ? {}
        : {
            error_code: 'PS_COM_FAILED' as const,
            error_message: com.error ?? 'Photoshop COM connection failed',
          }),
    }
  }

  private async checkInstalled(): Promise<boolean> {
    for (const registryKey of REGISTRY_KEYS) {
      try {
        const result = await this.execFile('reg', [
          'query',
          registryKey,
          '/s',
          '/v',
          'ApplicationPath',
        ])
        if (hasApplicationPath(result.stdout)) {
          return true
        }
      } catch {
        // Missing registry keys are expected when Photoshop is not installed.
      }
    }
    return false
  }

  private async checkRunning(): Promise<boolean> {
    try {
      const result = await this.execFile('tasklist', [
        '/FI',
        'IMAGENAME eq Photoshop.exe',
        '/FO',
        'CSV',
        '/NH',
      ])
      return hasPhotoshopProcess(result.stdout)
    } catch {
      return false
    }
  }

  private async tryConnectCom(): Promise<{
    connected: boolean
    version: string | null
    error?: string
  }> {
    try {
      const result = await this.execFile('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '$app = New-Object -ComObject Photoshop.Application; [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; Write-Output $app.Version',
      ])
      return { connected: true, version: normalizeVersion(result.stdout) }
    } catch (error) {
      return { connected: false, version: null, error: getErrorMessage(error) }
    }
  }
}

export const photoshopStatusChecker = new PhotoshopStatusChecker()
