import { access } from 'node:fs/promises'
import { basename } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import {
  type PhotoshopBridgeRequest,
  type PhotoshopBridgeResponse,
  type PhotoshopComBridge,
  PowerShellPhotoshopBridge,
} from './com-bridge'

type ExecFileResult = { stdout: string; stderr: string }
type ExecFileOptions = { timeoutMs: number }
type ExecFileFn = (
  file: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<ExecFileResult>

const DEFAULT_COM_COMMAND_TIMEOUT_MS = 30_000
const DEFAULT_JSX_TIMEOUT_MS = 20 * 60 * 1000
const READY_PROBE_COUNT = 3

interface PhotoshopComAdapterOptions {
  platform?: NodeJS.Platform
  execFile?: ExecFileFn
  bridgeFactory?: () => PhotoshopComBridge
  commandTimeoutMs?: number
  jsxTimeoutMs?: number
}

interface RunPowerShellOptions {
  script: string
  errorCode?: 'PS_COM_FAILED' | 'JSX_EXEC_FAILED'
  retryable?: boolean
  details?: Record<string, unknown>
  timeoutMs?: number
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function normalizeOutput(value: string): string {
  return value.trim()
}

function quotePowerShellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function classifyPowerShellError(
  error: unknown,
  fallbackCode: 'PS_COM_FAILED' | 'JSX_EXEC_FAILED',
) {
  const message = getErrorMessage(error)
  if (
    /Invalid class string|REGDB_E_CLASSNOTREG|0x80040154|0x80080005|0x800706ba|0x80010108|0x80010001|0x8001010a|Photoshop\.Application|Photoshop COM bridge exited/i.test(
      message,
    )
  ) {
    return {
      code: 'PS_COM_FAILED' as const,
      message: `Photoshop COM 连接失败：${message}`,
      retryable: true,
    }
  }
  return {
    code: fallbackCode,
    message: fallbackCode === 'JSX_EXEC_FAILED' ? `Photoshop JSX 执行失败：${message}` : message,
    retryable: fallbackCode === 'PS_COM_FAILED',
  }
}

function isTimeoutError(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; killed?: unknown }
    if (candidate.code === 'ETIMEDOUT' || candidate.killed === true) {
      return true
    }
  }
  return /timed?\s*out|timeout/i.test(getErrorMessage(error))
}

class PromiseMutex {
  private current = Promise.resolve()

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.current
    let release: () => void = () => {}
    this.current = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

const photoshopMutex = new PromiseMutex()

export class PhotoshopComAdapter {
  private readonly platform: NodeJS.Platform
  private readonly execFile: ExecFileFn | undefined
  private readonly bridgeFactory: () => PhotoshopComBridge
  private readonly commandTimeoutMs: number
  private readonly jsxTimeoutMs: number
  private bridge: PhotoshopComBridge | null = null

  constructor(options: PhotoshopComAdapterOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COM_COMMAND_TIMEOUT_MS
    this.jsxTimeoutMs = options.jsxTimeoutMs ?? DEFAULT_JSX_TIMEOUT_MS
    this.execFile = options.execFile
    this.bridgeFactory = options.bridgeFactory ?? (() => new PowerShellPhotoshopBridge())
  }

  async launchApp(): Promise<void> {
    await this.runCommand(
      { operation: 'launchApp' },
      {
        script:
          '$app = New-Object -ComObject Photoshop.Application; $app.Visible = $true; Write-Output "ok"',
        errorCode: 'PS_COM_FAILED',
        retryable: true,
      },
    )
  }

  async getVersion(): Promise<string> {
    const output = await this.runCommand(
      { operation: 'getVersion' },
      {
        script:
          '$app = New-Object -ComObject Photoshop.Application; [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; Write-Output $app.Version',
        errorCode: 'PS_COM_FAILED',
        retryable: true,
      },
    )
    return normalizeOutput(typeof output === 'string' ? output : String(output.version ?? ''))
  }

  async ensureReady(): Promise<string> {
    let version = ''
    for (let index = 0; index < READY_PROBE_COUNT; index += 1) {
      const output = await this.runCommand(
        { operation: 'probe' },
        {
          script: [
            '$app = New-Object -ComObject Photoshop.Application',
            '[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8',
            "Write-Output $app.DoJavaScript('app.version')",
          ].join('; '),
          errorCode: 'PS_COM_FAILED',
          retryable: true,
        },
      )
      version = normalizeOutput(typeof output === 'string' ? output : String(output.version ?? ''))
      if (!version) {
        throw new AppErrorClass(
          'PS_COM_FAILED',
          'Photoshop 就绪探测未返回版本，请检查 Photoshop 是否存在阻塞弹窗',
          true,
        )
      }
    }
    return version
  }

  async runJsxFile(filePath: string): Promise<void> {
    await access(filePath)
    await this.runCommand(
      { operation: 'runJsxFile', filePath },
      {
        script: `$app = New-Object -ComObject Photoshop.Application; $app.DoJavaScriptFile(${quotePowerShellString(
          filePath,
        )})`,
        errorCode: 'JSX_EXEC_FAILED',
        retryable: false,
        details: { jsx_file: filePath },
        timeoutMs: this.jsxTimeoutMs,
      },
    )
  }

  async getActiveDocument(): Promise<{ name: string; fullName: string | null }> {
    const output = await this.runCommand(
      { operation: 'getActiveDocument' },
      {
        script: [
          '$app = New-Object -ComObject Photoshop.Application',
          '$doc = $app.ActiveDocument',
          '[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8',
          'Write-Output ($doc.Name + "`n" + $doc.FullName)',
        ].join('; '),
        errorCode: 'PS_COM_FAILED',
        retryable: true,
      },
    )
    if (typeof output !== 'string') {
      return { name: output.name ?? '', fullName: output.fullName ?? null }
    }
    const [name = '', fullName = null] = output.split(/\r?\n/)
    return { name, fullName }
  }

  async closeAll(options: { allowUnsavedClose: boolean }): Promise<void> {
    if (!options.allowUnsavedClose) {
      throw new AppErrorClass(
        'PS_COM_FAILED',
        '关闭 Photoshop 文档需要 REAL_PS_MUTATE=1，已阻止可能丢失用户工作的操作',
        false,
      )
    }

    await this.runCommand(
      { operation: 'closeAll' },
      {
        script: [
          '$app = New-Object -ComObject Photoshop.Application',
          'while ($app.Documents.Count -gt 0) { $app.ActiveDocument.Close(2) }',
          'Write-Output "ok"',
        ].join('; '),
        errorCode: 'PS_COM_FAILED',
        retryable: false,
      },
    )
  }

  async dispose(): Promise<void> {
    await photoshopMutex.runExclusive(async () => {
      const bridge = this.bridge
      this.bridge = null
      await bridge?.dispose()
    })
  }

  async tryFixCom(): Promise<{ ok: false; message: string }> {
    return {
      ok: false,
      message:
        'COM 修复需要管理员权限。请关闭所有 Photoshop 实例，然后右键 Photoshop 图标选择“以管理员身份运行”，启动一次后再重试。',
    }
  }

  private async runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    this.assertWindows()
    return photoshopMutex.runExclusive(fn)
  }

  private assertWindows(): void {
    if (this.platform !== 'win32') {
      throw new AppErrorClass(
        'PS_UNSUPPORTED_PLATFORM',
        'PS 套版仅支持 Windows，请在 Windows 电脑使用 Photoshop COM 功能',
        false,
        { platform: this.platform },
      )
    }
  }

  private async runCommand(
    request: PhotoshopBridgeRequest,
    options: RunPowerShellOptions,
  ): Promise<string | PhotoshopBridgeResponse> {
    return this.runSerialized(async () => {
      if (this.execFile) {
        return this.runPowerShell(options)
      }
      const timeoutMs = options.timeoutMs ?? this.commandTimeoutMs
      try {
        this.bridge ??= this.bridgeFactory()
        return await this.bridge.request(request, timeoutMs)
      } catch (error) {
        throw this.createCommandError(error, options, timeoutMs)
      }
    })
  }

  private async runPowerShell(options: RunPowerShellOptions): Promise<string> {
    const timeoutMs = options.timeoutMs ?? this.commandTimeoutMs
    try {
      const result = await this.execFile?.(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', options.script],
        { timeoutMs },
      )
      if (!result) {
        throw new Error('PowerShell executor is unavailable')
      }
      return result.stdout
    } catch (error) {
      throw this.createCommandError(error, options, timeoutMs)
    }
  }

  private createCommandError(
    error: unknown,
    options: RunPowerShellOptions,
    timeoutMs: number,
  ): AppErrorClass {
    const classified = classifyPowerShellError(error, options.errorCode ?? 'PS_COM_FAILED')
    const timedOut = isTimeoutError(error)
    const message = timedOut
      ? `Photoshop 执行超时（${Math.ceil(timeoutMs / 1000)} 秒），请检查 Photoshop 是否无响应或存在阻塞弹窗`
      : classified.message
    return new AppErrorClass(
      classified.code,
      message,
      timedOut || classified.retryable || options.retryable === true,
      {
        ...options.details,
        command: basename('powershell.exe'),
        cause_message: getErrorMessage(error),
        ...(timedOut ? { timeout_ms: timeoutMs } : {}),
      },
    )
  }
}

export const photoshopComAdapter = new PhotoshopComAdapter()
