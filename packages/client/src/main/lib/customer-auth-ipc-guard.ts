import { AppErrorClass, type ErrorCode } from '@tengyu-aipod/shared'
import type { CustomerAuthState } from './customer-auth'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

export type IpcMainRegistrar = {
  handle(channel: string, listener: IpcHandler): void
}

type CustomerAuthStateReader = {
  getState(): Promise<CustomerAuthState>
}

export async function assertCustomerActive(service: CustomerAuthStateReader) {
  const state = await service.getState()
  if (state.status === 'active') {
    return
  }

  throw new AppErrorClass(
    'LOGIN_REQUIRED' satisfies keyof typeof ErrorCode,
    '客户授权未通过，请重新登录',
    false,
    {
      status: state.status,
    },
  )
}

export function guardCustomerAuthHandler(
  service: CustomerAuthStateReader,
  handler: IpcHandler,
): IpcHandler {
  return async (event, ...args) => {
    await assertCustomerActive(service)
    return handler(event, ...args)
  }
}

export function withCustomerAuthorizedIpcHandlers(
  ipc: IpcMainRegistrar,
  service: CustomerAuthStateReader,
  register: () => void,
) {
  const originalHandle = ipc.handle
  ipc.handle = (channel, listener) =>
    originalHandle.call(ipc, channel, guardCustomerAuthHandler(service, listener))
  try {
    register()
  } finally {
    ipc.handle = originalHandle
  }
}
