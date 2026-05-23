import { db } from '@/lib/db'
import { signClientJwt } from '@/lib/jwt'

const DAY_MS = 24 * 60 * 60 * 1000
const CLIENT_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export type ActivateErrorCode =
  | 'INVALID_CODE'
  | 'CODE_BANNED'
  | 'CUSTOMER_BANNED'
  | 'CODE_EXPIRED'
  | 'ALREADY_ACTIVATED_BY_OTHER'
  | 'DEVICE_LIMIT_REACHED'

const activateErrorStatus: Record<ActivateErrorCode, number> = {
  INVALID_CODE: 404,
  CODE_BANNED: 403,
  CUSTOMER_BANNED: 403,
  CODE_EXPIRED: 403,
  ALREADY_ACTIVATED_BY_OTHER: 403,
  DEVICE_LIMIT_REACHED: 403,
}

const activateErrorMessage: Record<ActivateErrorCode, string> = {
  INVALID_CODE: '激活码不存在',
  CODE_BANNED: '激活码已被封禁',
  CUSTOMER_BANNED: '客户已被封禁',
  CODE_EXPIRED: '激活码已过期',
  ALREADY_ACTIVATED_BY_OTHER: '该设备已绑定其他激活码',
  DEVICE_LIMIT_REACHED: '激活设备数已达上限',
}

export class ActivateError extends Error {
  code: ActivateErrorCode
  status: number

  constructor(code: ActivateErrorCode) {
    super(activateErrorMessage[code])
    this.name = 'ActivateError'
    this.code = code
    this.status = activateErrorStatus[code]
  }
}

export interface ActivateInput {
  code: string
  device_fingerprint: string
  device_name: string | null
}

export interface ActivateResult {
  activation_token: string
  expires_at: number
  max_devices: number
  used_devices: number
  device_name: string
}

function tokenExpiresAtSeconds(now: Date) {
  return Math.floor(now.getTime() / 1000) + CLIENT_TOKEN_TTL_SECONDS
}

export async function activateDevice(
  input: ActivateInput,
  options: { now?: Date } = {},
): Promise<ActivateResult> {
  const now = options.now ?? new Date()

  const result = await db.$transaction(async (transaction) => {
    const activationCode = await transaction.activationCode.findUnique({
      where: { code: input.code },
      include: { customer: true, devices: true },
    })

    if (!activationCode) {
      throw new ActivateError('INVALID_CODE')
    }
    if (!activationCode.is_active) {
      throw new ActivateError('CODE_BANNED')
    }
    if (activationCode.customer && !activationCode.customer.is_active) {
      throw new ActivateError('CUSTOMER_BANNED')
    }
    if (activationCode.expires_at && activationCode.expires_at.getTime() <= now.getTime()) {
      throw new ActivateError('CODE_EXPIRED')
    }

    const existingOtherDevice = await transaction.deviceActivation.findFirst({
      where: {
        device_fingerprint: input.device_fingerprint,
        code_id: { not: input.code },
      },
      select: { id: true },
    })
    if (existingOtherDevice) {
      throw new ActivateError('ALREADY_ACTIVATED_BY_OTHER')
    }

    const currentDevice = activationCode.devices.find(
      (device) => device.device_fingerprint === input.device_fingerprint,
    )
    if (!currentDevice && activationCode.devices.length >= activationCode.max_devices) {
      throw new ActivateError('DEVICE_LIMIT_REACHED')
    }

    const expires_at =
      activationCode.expires_at ?? new Date(now.getTime() + activationCode.days_total * DAY_MS)

    if (!activationCode.activated_at || !activationCode.expires_at) {
      await transaction.activationCode.update({
        where: { code: input.code },
        data: {
          activated_at: activationCode.activated_at ?? now,
          expires_at,
        },
      })
    }

    const device = await transaction.deviceActivation.upsert({
      where: {
        code_id_device_fingerprint: {
          code_id: input.code,
          device_fingerprint: input.device_fingerprint,
        },
      },
      update: {
        device_name: input.device_name,
        last_active_at: now,
      },
      create: {
        code_id: input.code,
        device_fingerprint: input.device_fingerprint,
        device_name: input.device_name,
        activated_at: now,
        last_active_at: now,
      },
    })

    const used_devices = currentDevice
      ? activationCode.devices.length
      : activationCode.devices.length + 1

    return {
      code: input.code,
      device,
      expires_at,
      max_devices: activationCode.max_devices,
      used_devices,
    }
  })

  const exp = tokenExpiresAtSeconds(now)
  const activation_token = await signClientJwt({
    sub: result.device.id,
    code: result.code,
    device_fp: input.device_fingerprint,
    exp,
  })

  return {
    activation_token,
    expires_at: result.expires_at.getTime(),
    max_devices: result.max_devices,
    used_devices: result.used_devices,
    device_name: result.device.device_name ?? '',
  }
}
