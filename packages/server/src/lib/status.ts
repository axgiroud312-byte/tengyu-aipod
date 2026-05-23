import { db } from '@/lib/db'
import { verifyClientJwt } from '@/lib/jwt'

const DAY_MS = 24 * 60 * 60 * 1000

export type ActivationStatus = 'active' | 'expired' | 'banned'

export interface StatusResult {
  status: ActivationStatus
  days_remaining: number
  max_devices: number
  used_devices: number
  device_name: string
  customer: { name?: string; has_contact: boolean } | null
}

export class StatusAuthError extends Error {
  code: 'UNAUTHORIZED' | 'INVALID_TOKEN' | 'DEVICE_UNBOUND'

  constructor(code: StatusAuthError['code']) {
    super(code)
    this.name = 'StatusAuthError'
    this.code = code
  }
}

export function getBearerToken(authorization: string | null) {
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const token = authorization.slice('Bearer '.length).trim()
  return token || null
}

export function calculateDaysRemaining(expires_at: Date | null, now: Date) {
  if (!expires_at) {
    return 0
  }

  return Math.ceil((expires_at.getTime() - now.getTime()) / DAY_MS)
}

export async function getActivationStatus(
  authorization: string | null,
  options: { now?: Date } = {},
): Promise<StatusResult> {
  const token = getBearerToken(authorization)
  if (!token) {
    throw new StatusAuthError('UNAUTHORIZED')
  }

  const payload = await verifyClientJwt(token)
  if (!payload) {
    throw new StatusAuthError('INVALID_TOKEN')
  }

  const now = options.now ?? new Date()
  const device = await db.deviceActivation.findUnique({
    where: { id: payload.sub },
    include: {
      code: {
        include: {
          customer: true,
          devices: true,
        },
      },
    },
  })

  if (
    !device ||
    device.code_id !== payload.code ||
    device.device_fingerprint !== payload.device_fp
  ) {
    throw new StatusAuthError('DEVICE_UNBOUND')
  }

  const days_remaining = calculateDaysRemaining(device.code.expires_at, now)
  const status =
    !device.code.is_active || device.code.customer?.is_active === false
      ? 'banned'
      : days_remaining < 0
        ? 'expired'
        : 'active'

  await db.deviceActivation.update({
    where: { id: device.id },
    data: { last_active_at: now },
  })

  return {
    status,
    days_remaining,
    max_devices: device.code.max_devices,
    used_devices: device.code.devices.length,
    device_name: device.device_name ?? '',
    customer: device.code.customer
      ? {
          name: device.code.customer.name,
          has_contact: Boolean(
            device.code.customer.phone || device.code.customer.email || device.code.customer.wechat,
          ),
        }
      : null,
  }
}
