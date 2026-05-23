import { db } from '@/lib/db'

export async function GET() {
  let db_ok = false

  try {
    await db.$queryRaw`SELECT 1`
    db_ok = true
  } catch {
    db_ok = false
  }

  return Response.json({
    ok: true,
    uptime: process.uptime(),
    db_ok,
    version: process.env.npm_package_version ?? '0.0.0',
  })
}
