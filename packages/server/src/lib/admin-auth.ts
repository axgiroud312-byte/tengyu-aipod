import { verifyAdminJwt } from '@/lib/jwt'

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return null
  }

  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join('='))
    }
  }

  return null
}

export async function adminPayloadFromRequest(request: Request) {
  const token = cookieValue(request.headers.get('cookie'), 'admin_token')
  return verifyAdminJwt(token)
}
