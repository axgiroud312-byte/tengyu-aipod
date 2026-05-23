import { verifyAdminJwt } from '@/lib/jwt'
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

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
