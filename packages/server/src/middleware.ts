import { db } from '@/lib/db'
import { verifyAdminJwt } from '@/lib/jwt'
import { ErrorCode } from '@tengyu-aipod/shared'
import { type NextRequest, NextResponse } from 'next/server'

const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/admin/api/login', '/admin/api/logout'])

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (!pathname.startsWith('/admin') || PUBLIC_ADMIN_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get('admin_token')?.value
  const payload = await verifyAdminJwt(token)
  if (!payload) {
    return NextResponse.redirect(new URL('/admin/login', request.url))
  }

  let admin: { is_active: boolean; role: string } | null
  try {
    admin = await db.admin.findUnique({
      where: { id: payload.sub },
      select: { is_active: true, role: true },
    })
  } catch (error) {
    console.error('Admin session validation failed', error)
    return NextResponse.json(
      {
        error: {
          code: ErrorCode.HTTP_5XX,
          message: '管理员会话校验暂不可用，请稍后重试',
          retryable: true,
        },
        ok: false,
      },
      { status: 503 },
    )
  }
  if (!admin?.is_active || admin.role !== payload.role) {
    return NextResponse.redirect(new URL('/admin/login', request.url))
  }

  return NextResponse.next()
}

export const runtime = 'nodejs'

export const config = {
  matcher: ['/admin/:path*'],
}
