import { describe, expect, it } from 'vitest'
import { ActivateError } from './activate'

describe('ActivateError', () => {
  it.each([
    ['INVALID_CODE', 404, '激活码不存在'],
    ['CODE_BANNED', 403, '激活码已被封禁'],
    ['CUSTOMER_BANNED', 403, '客户已被封禁'],
    ['CODE_EXPIRED', 403, '激活码已过期'],
    ['ALREADY_ACTIVATED_BY_OTHER', 403, '该设备已绑定其他激活码'],
    ['DEVICE_LIMIT_REACHED', 403, '激活设备数已达上限'],
  ] as const)('maps %s to stable status and message', (code, status, message) => {
    const error = new ActivateError(code)

    expect(error.code).toBe(code)
    expect(error.status).toBe(status)
    expect(error.message).toBe(message)
  })
})
