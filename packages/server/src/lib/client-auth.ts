import { db } from '@/lib/db'
import { verifyClientJwt } from '@/lib/jwt'

export class ClientAuthError extends Error {
  code: 'UNAUTHORIZED' | 'INVALID_TOKEN' | 'DEVICE_UNBOUND'

  constructor(code: ClientAuthError['code']) {
    super(code)
    this.name = 'ClientAuthError'
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

export async function requireClientAuth(
  authorization: string | null,
  options: { allowDevelopmentBypass?: boolean; now?: Date } = {},
) {
  if (
    options.allowDevelopmentBypass &&
    process.env.NODE_ENV === 'development' &&
    process.env.TENGYU_REQUIRE_CLIENT_AUTH !== '1'
  ) {
    return null
  }

  const token = getBearerToken(authorization)
  if (!token) {
    throw new ClientAuthError('UNAUTHORIZED')
  }

  const payload = await verifyClientJwt(token)
  if (!payload) {
    throw new ClientAuthError('INVALID_TOKEN')
  }

  const device = await db.deviceActivation.findUnique({
    where: { id: payload.sub },
    include: { code: { include: { customer: true } } },
  })
  if (
    !device ||
    device.code_id !== payload.code ||
    device.device_fingerprint !== payload.device_fp ||
    !device.code.is_active ||
    device.code.customer?.is_active === false ||
    (device.code.expires_at &&
      device.code.expires_at.getTime() <= (options.now ?? new Date()).getTime())
  ) {
    throw new ClientAuthError('DEVICE_UNBOUND')
  }

  await db.deviceActivation.update({
    where: { id: device.id },
    data: { last_active_at: options.now ?? new Date() },
  })

  return { device, code: device.code }
}
