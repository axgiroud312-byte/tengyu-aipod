import { describe, expect, it, vi } from 'vitest'
import {
  type IpcMainRegistrar,
  guardCustomerAuthHandler,
  withCustomerAuthorizedIpcHandlers,
} from './customer-auth-ipc-guard'

type IpcHandler = Parameters<IpcMainRegistrar['handle']>[1]

describe('customer auth IPC guard', () => {
  it('rejects inactive customers before invoking a guarded handler', async () => {
    const handler = vi.fn()
    const guarded = guardCustomerAuthHandler(
      {
        getState: async () => ({
          customer: null,
          message: null,
          status: 'anonymous',
        }),
      },
      handler,
    )

    await expect(guarded({}, { module: 'generation' })).rejects.toMatchObject({
      code: 'LOGIN_REQUIRED',
      message: '客户授权未通过，请重新登录',
      details: { status: 'anonymous' },
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('allows active customers to invoke a guarded handler', async () => {
    const handler = vi.fn(() => 'ok')
    const guarded = guardCustomerAuthHandler(
      {
        getState: async () => ({
          customer: null,
          message: null,
          status: 'active',
        }),
      },
      handler,
    )

    await expect(guarded({}, 'input')).resolves.toBe('ok')
    expect(handler).toHaveBeenCalledWith({}, 'input')
  })

  it('wraps scoped IPC registrations and restores the original registrar', async () => {
    const handlers = new Map<string, IpcHandler>()
    const ipc: IpcMainRegistrar = {
      handle: vi.fn((channel, listener) => {
        handlers.set(channel, listener)
      }),
    }
    const originalHandle = ipc.handle
    const handler = vi.fn(() => 'skills')

    withCustomerAuthorizedIpcHandlers(
      ipc,
      {
        getState: async () => ({
          customer: null,
          message: null,
          status: 'active',
        }),
      },
      () => {
        ipc.handle('skill:list', handler)
      },
    )

    expect(ipc.handle).toBe(originalHandle)
    await expect(handlers.get('skill:list')?.({}, {})).resolves.toBe('skills')
    expect(handler).toHaveBeenCalledOnce()
  })
})
