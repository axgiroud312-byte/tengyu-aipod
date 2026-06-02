import {
  type SerializedCustomerAccount,
  verifyAndSyncCustomerAccount,
} from '@/lib/customer-accounts'
import { phpAuthVerifyInputSchema } from '@/lib/php-auth'
import { NextResponse } from 'next/server'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function publicCustomer(account: SerializedCustomerAccount) {
  return {
    account: account.account,
    avatar_url: account.avatar_url,
    expires_at: account.expires_at,
    id: account.id,
    nickname: account.nickname,
    phone: account.phone,
    php_uid: account.php_uid,
  }
}

export async function POST(request: Request) {
  const parsed = phpAuthVerifyInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('INVALID_CUSTOMER_AUTH_INPUT', '客户登录校验参数不正确', 400)
  }

  try {
    const result = await verifyAndSyncCustomerAccount(parsed.data)
    if (!result.ok) {
      if (result.reason === 'nologin') {
        return NextResponse.json(
          {
            ok: false,
            error: { code: 'CUSTOMER_LOGIN_EXPIRED', message: result.message },
            status: 'nologin',
          },
          { status: 401 },
        )
      }

      return errorResponse('PHP_AUTH_FAILED', result.message, 401)
    }

    const customer = publicCustomer(result.customer)

    return NextResponse.json({
      ok: true,
      customer,
      data: {
        customer,
        server_time: new Date().toISOString(),
        status: result.status,
      },
      status: result.status,
    })
  } catch {
    return errorResponse('PHP_AUTH_UNAVAILABLE', '旧登录服务暂不可用，请稍后重试', 502)
  }
}
