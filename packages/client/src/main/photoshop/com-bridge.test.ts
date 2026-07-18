import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PowerShellPhotoshopBridge } from './com-bridge'

interface FakeBridgeProcess {
  process: ChildProcessWithoutNullStreams
  requests: Array<Record<string, unknown>>
  stdout: PassThrough
  isKilled(): boolean
}

function createFakeBridgeProcess(): FakeBridgeProcess {
  const events = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const requests: Array<Record<string, unknown>> = []
  let killed = false
  stdin.setEncoding('utf8')
  stdin.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      requests.push(JSON.parse(line) as Record<string, unknown>)
    }
  })
  const process = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    kill: () => {
      killed = true
      return true
    },
  })
  Object.defineProperty(process, 'killed', { get: () => killed })
  return {
    process: process as unknown as ChildProcessWithoutNullStreams,
    requests,
    stdout,
    isKilled: () => killed,
  }
}

function reply(
  process: FakeBridgeProcess,
  requestIndex: number,
  payload: Record<string, unknown>,
): void {
  process.stdout.write(
    `${JSON.stringify({ id: process.requests[requestIndex]?.id, ...payload })}\n`,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PowerShellPhotoshopBridge', () => {
  it('reuses one PowerShell process for consecutive requests and disposes it', async () => {
    const processes: FakeBridgeProcess[] = []
    const bridge = new PowerShellPhotoshopBridge({
      spawn: () => {
        const process = createFakeBridgeProcess()
        processes.push(process)
        return process.process
      },
    })

    const versionRequest = bridge.request({ operation: 'getVersion' }, 1_000)
    reply(processes[0] as FakeBridgeProcess, 0, {
      ok: true,
      data: { version: '27.8.0' },
    })
    await expect(versionRequest).resolves.toEqual({ version: '27.8.0' })

    const probeRequest = bridge.request({ operation: 'probe' }, 1_000)
    reply(processes[0] as FakeBridgeProcess, 1, {
      ok: true,
      data: { version: '27.8.0' },
    })
    await expect(probeRequest).resolves.toEqual({ version: '27.8.0' })

    expect(processes).toHaveLength(1)
    bridge.dispose()
    expect(processes[0]?.isKilled()).toBe(true)
  })

  it('starts a fresh helper after timeout and ignores the old process exit', async () => {
    vi.useFakeTimers()
    const processes: FakeBridgeProcess[] = []
    const bridge = new PowerShellPhotoshopBridge({
      spawn: () => {
        const process = createFakeBridgeProcess()
        processes.push(process)
        return process.process
      },
    })

    const timedOutRequest = bridge.request({ operation: 'probe' }, 25)
    const timeoutExpectation = expect(timedOutRequest).rejects.toMatchObject({
      code: 'ETIMEDOUT',
      killed: true,
    })
    await vi.advanceTimersByTimeAsync(25)
    await timeoutExpectation

    const retryRequest = bridge.request({ operation: 'probe' }, 1_000)
    expect(processes).toHaveLength(2)
    processes[0]?.process.emit('exit', 1)
    expect(processes[1]?.isKilled()).toBe(false)
    reply(processes[1] as FakeBridgeProcess, 0, {
      ok: true,
      data: { version: '27.8.0' },
    })
    await expect(retryRequest).resolves.toEqual({ version: '27.8.0' })
    bridge.dispose()
  })

  it('terminates the helper when Photoshop reports an RPC disconnect', async () => {
    const process = createFakeBridgeProcess()
    const bridge = new PowerShellPhotoshopBridge({ spawn: () => process.process })

    const request = bridge.request({ operation: 'runJsxFile', filePath: 'C:\\job.jsx' }, 1_000)
    reply(process, 0, {
      ok: false,
      error: { message: 'The RPC server is unavailable', hresult: -2147023174 },
    })

    await expect(request).rejects.toThrow('HRESULT: 0x800706ba')
    expect(process.isKilled()).toBe(true)
  })
})
