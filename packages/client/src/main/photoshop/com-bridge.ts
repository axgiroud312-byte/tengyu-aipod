import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  spawn as nodeSpawn,
} from 'node:child_process'
import { randomUUID } from 'node:crypto'

export type PhotoshopBridgeRequest =
  | { operation: 'launchApp' }
  | { operation: 'getVersion' }
  | { operation: 'probe' }
  | { operation: 'runJsxFile'; filePath: string }
  | { operation: 'getActiveDocument' }
  | { operation: 'closeAll' }

export interface PhotoshopBridgeResponse {
  version?: string
  name?: string
  fullName?: string | null
}

export interface PhotoshopComBridge {
  request(request: PhotoshopBridgeRequest, timeoutMs: number): Promise<PhotoshopBridgeResponse>
  dispose(): void | Promise<void>
}

type SpawnFn = (
  file: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

interface PowerShellPhotoshopBridgeOptions {
  spawn?: SpawnFn
}

interface BridgeReply {
  id?: unknown
  ok?: unknown
  data?: unknown
  error?: unknown
}

interface PendingRequest {
  resolve(value: PhotoshopBridgeResponse): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

const POWERSHELL_BRIDGE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:photoshop = $null

function Get-PhotoshopApplication {
  if ($null -ne $script:photoshop) {
    try {
      [void]$script:photoshop.Version
      return $script:photoshop
    } catch {
      $script:photoshop = $null
    }
  }

  try {
    $script:photoshop = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
  } catch {
    $script:photoshop = New-Object -ComObject Photoshop.Application
  }
  return $script:photoshop
}

while (($line = [Console]::ReadLine()) -ne $null) {
  $requestId = $null
  try {
    $request = $line | ConvertFrom-Json
    $requestId = [string]$request.id
    $app = Get-PhotoshopApplication
    $data = @{}

    switch ([string]$request.operation) {
      'launchApp' {
        $app.Visible = $true
      }
      'getVersion' {
        $data.version = [string]$app.Version
      }
      'probe' {
        $data.version = [string]$app.DoJavaScript('app.version')
      }
      'runJsxFile' {
        [void]$app.DoJavaScriptFile([string]$request.filePath)
      }
      'getActiveDocument' {
        $document = $app.ActiveDocument
        $fullName = $null
        try {
          $fullName = [string]$document.FullName
        } catch {}
        $data.name = [string]$document.Name
        $data.fullName = $fullName
      }
      'closeAll' {
        while ($app.Documents.Count -gt 0) {
          $app.ActiveDocument.Close(2)
        }
      }
      default {
        throw "Unsupported Photoshop bridge operation: $($request.operation)"
      }
    }

    $reply = @{ id = $requestId; ok = $true; data = $data }
  } catch {
    $script:photoshop = $null
    $exception = $_.Exception
    $hresult = [int64]$exception.HResult
    if ($null -ne $exception.InnerException) {
      $hresult = [int64]$exception.InnerException.HResult
    }
    $reply = @{
      id = $requestId
      ok = $false
      error = @{ message = [string]$exception.Message; hresult = $hresult }
    }
  }

  [Console]::WriteLine(($reply | ConvertTo-Json -Compress -Depth 4))
}
`

function encodedPowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function bridgeErrorMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const hresult = 'hresult' in value ? Number(value.hresult) : Number.NaN
    const hresultSuffix = Number.isInteger(hresult)
      ? ` (HRESULT: 0x${(hresult >>> 0).toString(16).padStart(8, '0')})`
      : ''
    return `${String(value.message)}${hresultSuffix}`
  }
  return 'Photoshop COM bridge request failed'
}

function responseData(value: unknown): PhotoshopBridgeResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const candidate = value as Record<string, unknown>
  return {
    ...(typeof candidate.version === 'string' ? { version: candidate.version } : {}),
    ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
    ...(typeof candidate.fullName === 'string' || candidate.fullName === null
      ? { fullName: candidate.fullName }
      : {}),
  }
}

export class PowerShellPhotoshopBridge implements PhotoshopComBridge {
  private readonly spawn: SpawnFn
  private process: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private readonly pending = new Map<string, PendingRequest>()

  constructor(options: PowerShellPhotoshopBridgeOptions = {}) {
    this.spawn =
      options.spawn ??
      ((file, args, spawnOptions) =>
        nodeSpawn(file, args, {
          ...spawnOptions,
          stdio: ['pipe', 'pipe', 'pipe'],
        }))
  }

  async request(
    request: PhotoshopBridgeRequest,
    timeoutMs: number,
  ): Promise<PhotoshopBridgeResponse> {
    const process = this.getOrStartProcess()
    const id = randomUUID()
    return new Promise<PhotoshopBridgeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        const error = Object.assign(
          new Error(`Photoshop COM bridge timed out after ${timeoutMs} ms`),
          { code: 'ETIMEDOUT', killed: true },
        )
        reject(error)
        this.stopProcess(error, process)
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      process.stdin.write(`${JSON.stringify({ id, ...request })}\n`, 'utf8', (error) => {
        if (!error) {
          return
        }
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error)
        this.stopProcess(error, process)
      })
    })
  }

  dispose(): void {
    this.stopProcess(new Error('Photoshop COM bridge disposed'))
  }

  private getOrStartProcess(): ChildProcessWithoutNullStreams {
    if (this.process) {
      return this.process
    }

    const process = this.spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Sta',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedPowerShellCommand(POWERSHELL_BRIDGE_SCRIPT),
      ],
      { windowsHide: true },
    )
    this.process = process
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    process.stdout.setEncoding('utf8')
    process.stderr.setEncoding('utf8')
    process.stdout.on('data', (chunk: string) => this.consumeStdout(chunk))
    process.stderr.on('data', (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-4_000)
    })
    process.once('error', (error) => this.stopProcess(error, process))
    process.once('exit', (code) => {
      this.stopProcess(
        new Error(
          `Photoshop COM bridge exited${code === null ? '' : ` with code ${code}`}${
            this.stderrBuffer ? `: ${this.stderrBuffer.trim()}` : ''
          }`,
        ),
        process,
      )
    })
    return process
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    while (true) {
      const lineEnd = this.stdoutBuffer.indexOf('\n')
      if (lineEnd < 0) {
        return
      }
      const line = this.stdoutBuffer.slice(0, lineEnd).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1)
      if (!line) {
        continue
      }
      this.handleReply(line)
    }
  }

  private handleReply(line: string): void {
    let reply: BridgeReply
    try {
      reply = JSON.parse(line) as BridgeReply
    } catch {
      return
    }
    if (typeof reply.id !== 'string') {
      return
    }
    const pending = this.pending.get(reply.id)
    if (!pending) {
      return
    }
    clearTimeout(pending.timeout)
    this.pending.delete(reply.id)
    if (reply.ok === true) {
      pending.resolve(responseData(reply.data))
      return
    }
    pending.reject(new Error(bridgeErrorMessage(reply.error)))
  }

  private stopProcess(
    error: Error,
    process: ChildProcessWithoutNullStreams | null = this.process,
  ): void {
    if (process && this.process && process !== this.process) {
      return
    }
    if (process === this.process) {
      this.process = null
    }
    if (process && !process.killed) {
      process.kill()
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
