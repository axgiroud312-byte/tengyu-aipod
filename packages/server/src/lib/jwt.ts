const ADMIN_JWT_ISSUER = 'tengyu-pod-admin'
const ADMIN_JWT_TTL_SECONDS = 7 * 24 * 60 * 60

export interface AdminJwtPayload {
  sub: string
  role: string
  exp: number
  iss: typeof ADMIN_JWT_ISSUER
  iat: number
}

function getAdminJwtSecret() {
  const secret = process.env.JWT_SECRET_ADMIN
  if (!secret) {
    throw new Error('JWT_SECRET_ADMIN is required')
  }
  return secret
}

function base64UrlEncode(input: string | Uint8Array) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlDecode(input: string) {
  const padded = input
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new TextDecoder().decode(bytes)
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signAdminJwt(payload: { sub: string; role: string }) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64UrlEncode(
    JSON.stringify({
      sub: payload.sub,
      role: payload.role,
      iss: ADMIN_JWT_ISSUER,
      iat: now,
      exp: now + ADMIN_JWT_TTL_SECONDS,
    }),
  )
  const data = `${header}.${body}`
  const key = await importHmacKey(getAdminJwtSecret())
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))

  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`
}

export async function verifyAdminJwt(token: string | null | undefined) {
  if (!token) {
    return null
  }

  try {
    const [header, body, signature] = token.split('.')
    if (!header || !body || !signature) {
      return null
    }

    const decodedHeader = JSON.parse(base64UrlDecode(header)) as { alg?: string; typ?: string }
    if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') {
      return null
    }

    const key = await importHmacKey(getAdminJwtSecret())
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      Uint8Array.from(
        atob(
          signature
            .replaceAll('-', '+')
            .replaceAll('_', '/')
            .padEnd(Math.ceil(signature.length / 4) * 4, '='),
        ),
        (char) => char.charCodeAt(0),
      ),
      new TextEncoder().encode(`${header}.${body}`),
    )
    if (!isValid) {
      return null
    }

    const payload = JSON.parse(base64UrlDecode(body)) as AdminJwtPayload
    const now = Math.floor(Date.now() / 1000)
    if (payload.iss !== ADMIN_JWT_ISSUER || payload.exp <= now || !payload.sub || !payload.role) {
      return null
    }

    return payload
  } catch {
    return null
  }
}
