/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIpcMutation, useIpcQuery } from './use-ipc'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

type TestApi = {
  test: {
    fail: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
    save: ReturnType<typeof vi.fn>
  }
}

function mockWindowApi(api: TestApi): TestApi {
  ;(window as unknown as { api: TestApi }).api = api
  return api
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useIpcMutation', () => {
  it('returns data and shows the configured success toast', async () => {
    const api = mockWindowApi({
      test: {
        fail: vi.fn(),
        load: vi.fn(),
        save: vi.fn().mockResolvedValue({ ok: true }),
      },
    })
    const { result } = renderHook(() =>
      useIpcMutation(api.test.save, { successMessage: '保存成功' }),
    )

    let saved: unknown
    await act(async () => {
      saved = await result.current.run({ id: '1' })
    })

    expect(saved).toEqual({ ok: true })
    expect(toast.success).toHaveBeenCalledWith('保存成功')
    expect(result.current.error).toBeNull()
  })

  it('formats thrown IPC errors and shows an error toast by default', async () => {
    const api = mockWindowApi({
      test: {
        fail: vi
          .fn()
          .mockRejectedValue(new Error("Error invoking remote method 'x:y': Error: 保存失败")),
        load: vi.fn(),
        save: vi.fn(),
      },
    })
    const { result } = renderHook(() => useIpcMutation(api.test.fail))

    await act(async () => {
      await result.current.run()
    })

    expect(result.current.error).toBe('保存失败')
    expect(toast.error).toHaveBeenCalledWith('保存失败')
  })

  it('keeps silent failures out of toast', async () => {
    const api = mockWindowApi({
      test: {
        fail: vi.fn().mockRejectedValue(new Error('静默失败')),
        load: vi.fn(),
        save: vi.fn(),
      },
    })
    const { result } = renderHook(() => useIpcMutation(api.test.fail, { silent: true }))

    await act(async () => {
      await result.current.run()
    })

    expect(result.current.error).toBe('静默失败')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('drops duplicate calls while a mutation is loading', async () => {
    let resolveSave: (value: string) => void = () => undefined
    const api = mockWindowApi({
      test: {
        fail: vi.fn(),
        load: vi.fn(),
        save: vi.fn(
          () =>
            new Promise<string>((resolve) => {
              resolveSave = resolve
            }),
        ),
      },
    })
    const { result } = renderHook(() => useIpcMutation<[], string>(api.test.save))

    let first: Promise<string | undefined> = Promise.resolve(undefined)
    let second: Promise<string | undefined> = Promise.resolve(undefined)
    await act(async () => {
      first = result.current.run()
      second = result.current.run()
    })

    expect(api.test.save).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave('done')
      await first
      await second
    })

    expect(await first).toBe('done')
    expect(await second).toBeUndefined()
  })
})

describe('useIpcQuery', () => {
  it('loads data on mount and exposes refetch', async () => {
    const api = mockWindowApi({
      test: {
        fail: vi.fn(),
        load: vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second'),
        save: vi.fn(),
      },
    })
    const { result } = renderHook(() => useIpcQuery<string>(api.test.load, []))

    await waitFor(() => expect(result.current.data).toBe('first'))

    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.data).toBe('second')
    expect(result.current.error).toBeNull()
  })
})
