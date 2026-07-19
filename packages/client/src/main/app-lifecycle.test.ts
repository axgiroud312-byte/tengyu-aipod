import { describe, expect, it, vi } from 'vitest'
import {
  countRunningTasks,
  initializeWorkbenchAfterPipelineCleanup,
  installQuitGuard,
  installSingleInstanceLock,
} from './app-lifecycle'

function createMockApp() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    app: {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler)
      }),
    },
  }
}

describe('app lifecycle', () => {
  it('waits for persisted pipeline cleanup before registering IPC or creating a window', async () => {
    let finishCleanup: (() => void) | undefined
    const cleanupGate = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })
    const events: string[] = []

    const initialization = initializeWorkbenchAfterPipelineCleanup({
      cleanupPersistedPipelineRuns: async () => {
        events.push('cleanup-started')
        await cleanupGate
        events.push('cleanup-completed')
      },
      registerBusinessIpc: () => {
        events.push('ipc-registered')
      },
      createWindow: () => {
        events.push('window-created')
      },
    })

    await Promise.resolve()
    expect(events).toEqual(['cleanup-started'])

    finishCleanup?.()
    await initialization

    expect(events).toEqual([
      'cleanup-started',
      'cleanup-completed',
      'ipc-registered',
      'window-created',
    ])
  })

  it('quits immediately when another instance already owns the lock', () => {
    const { app } = createMockApp()
    app.requestSingleInstanceLock.mockReturnValue(false)

    const locked = installSingleInstanceLock({
      app,
      getWindows: () => [],
    })

    expect(locked).toBe(false)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('focuses and restores the existing main window on a second instance', () => {
    const { app, handlers } = createMockApp()
    const window = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      focus: vi.fn(),
    }

    const locked = installSingleInstanceLock({
      app,
      getWindows: () => [window],
    })
    handlers.get('second-instance')?.()

    expect(locked).toBe(true)
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('counts running work across pipeline, generation, detection, and listing services', () => {
    expect(
      countRunningTasks({
        pipeline: 2,
        generation: 1,
        detection: 3,
        listing: 4,
      }),
    ).toBe(10)
  })

  it('keeps the app open when the user cancels quitting with running tasks', async () => {
    const { app, handlers } = createMockApp()
    const preventDefault = vi.fn()
    const cleanup = vi.fn()
    const interruptActiveRuns = vi.fn()

    installQuitGuard({
      app,
      dialog: {
        showMessageBox: vi.fn(async () => ({ response: 1 })),
      },
      getRunningTaskCount: () => 2,
      interruptActiveRuns,
      cleanup,
    })

    await handlers.get('before-quit')?.({ preventDefault })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(interruptActiveRuns).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('marks active runs interrupted before quitting when the user confirms', async () => {
    const { app, handlers } = createMockApp()
    const preventDefault = vi.fn()
    const cleanup = vi.fn()
    const interruptActiveRuns = vi.fn(async () => undefined)

    installQuitGuard({
      app,
      dialog: {
        showMessageBox: vi.fn(async () => ({ response: 0 })),
      },
      getRunningTaskCount: () => 1,
      interruptActiveRuns,
      cleanup,
    })

    await handlers.get('before-quit')?.({ preventDefault })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(interruptActiveRuns).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })
})
