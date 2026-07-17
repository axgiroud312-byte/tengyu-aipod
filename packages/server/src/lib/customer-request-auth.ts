import { verifyAndSyncCustomerAccount } from '@/lib/customer-accounts'
import { phpAuthVerifyInputSchema } from '@/lib/php-auth'

export type CustomerRequestAuthResult =
  | { ok: true; phpUid: number }
  | { code: string; message: string; ok: false; status: number }

export async function authorizeCustomerRequest(
  request: Request,
): Promise<CustomerRequestAuthResult> {
  const authorization = request.headers.get('authorization')
  if (!authorization) {
    return {
      code: 'CUSTOMER_AUTH_REQUIRED',
      message: '请先登录并完成客户授权',
      ok: false,
      status: 401,
    }
  }

  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)
  const finger = request.headers.get('x-tengyu-finger')
  if (!match?.[1] || !finger || authorization.length > 4096) {
    return invalidCredentials()
  }

  let decoded: string
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8')
  } catch {
    return invalidCredentials()
  }

  const separatorIndex = decoded.indexOf(':')
  const parsed = phpAuthVerifyInputSchema.safeParse({
    finger,
    secret: separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '',
    uid: separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '',
  })
  if (!parsed.success) {
    return invalidCredentials()
  }

  try {
    const result = await verifyAndSyncCustomerAccount(parsed.data)
    if (!result.ok) {
      return {
        code: result.reason === 'nologin' ? 'CUSTOMER_LOGIN_EXPIRED' : 'CUSTOMER_AUTH_INVALID',
        message: result.message,
        ok: false,
        status: 401,
      }
    }
    if (result.status !== 'active') {
      return {
        code: 'CUSTOMER_NOT_ACTIVE',
        message: '客户账号未授权、已禁用或已到期',
        ok: false,
        status: 403,
      }
    }

    return { ok: true, phpUid: result.customer.php_uid }
  } catch (error) {
    console.error('Customer request authorization failed', error)
    return {
      code: 'CUSTOMER_AUTH_UNAVAILABLE',
      message: '客户授权服务暂不可用，请稍后重试',
      ok: false,
      status: 502,
    }
  }
}

function invalidCredentials(): CustomerRequestAuthResult {
  return {
    code: 'CUSTOMER_AUTH_INVALID',
    message: '客户登录凭证无效',
    ok: false,
    status: 401,
  }
}
