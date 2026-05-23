import { db } from '@/lib/db'
import { ClientAuthError, getBearerToken, requireClientAuth } from './client-auth'

export { getBearerToken } from './client-auth'

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

export class StatusAuthError extends ClientAuthError {
  constructor(code: StatusAuthError['code']) {
    super(code)
    this.name = 'StatusAuthError'
  }
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
  const now = options.now ?? new Date()
  let auth: Awaited<ReturnType<typeof requireClientAuth>>
  try {
    auth = await requireClientAuth(authorization, { now })
  } catch (error) {
    if (error instanceof ClientAuthError) {
      throw new StatusAuthError(error.code)
    }
    throw error
  }
  if (!auth) {
    throw new StatusAuthError('UNAUTHORIZED')
  }

  const device = await db.deviceActivation.findUnique({
    where: { id: auth.device.id },
    include: { code: { include: { customer: true, devices: true } } },
  })
  if (!device) {
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
