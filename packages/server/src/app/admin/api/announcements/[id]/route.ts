import { adminPayloadFromRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { parsePhpUidAllowlistInput } from '@/lib/targeting'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const announcementSchema = z.object({
  content: z.string().min(1),
  enabled: z.boolean(),
  end_at: z.string().optional().nullable(),
  level: z.enum(['info', 'important', 'warning']),
  start_at: z.string().min(1),
  target_php_uids: z.string().optional(),
  target_scope: z.enum(['all', 'php_uid_list']),
  title: z.string().min(1),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function targetJson(scope: 'all' | 'php_uid_list', value: string | undefined) {
  if (scope === 'all') {
    return { ok: true as const, value: '[]' }
  }

  const parsed = parsePhpUidAllowlistInput(value ?? '')
  if (!parsed.ok || parsed.uids.length === 0) {
    return { ok: false as const, value: '[]' }
  }

  return { ok: true as const, value: JSON.stringify(parsed.uids) }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminPayloadFromRequest(request)
  if (!admin) {
    return errorResponse('ADMIN_AUTH_REQUIRED', '管理员登录已失效', 401)
  }

  const { id } = await params
  const parsed = announcementSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('INVALID_ANNOUNCEMENT_INPUT', '公告参数不正确', 400)
  }

  const startAt = parseDate(parsed.data.start_at)
  const endAt = parseDate(parsed.data.end_at)
  if (!startAt || (parsed.data.end_at && !endAt)) {
    return errorResponse('INVALID_ANNOUNCEMENT_TIME', '公告时间格式不正确', 400)
  }

  const target = targetJson(parsed.data.target_scope, parsed.data.target_php_uids)
  if (!target.ok) {
    return errorResponse('INVALID_TARGET_UIDS', 'PHP uid 白名单格式不正确', 400)
  }

  const item = await db.announcement.update({
    data: {
      content: parsed.data.content.trim(),
      enabled: parsed.data.enabled,
      end_at: endAt,
      level: parsed.data.level,
      start_at: startAt,
      target_php_uids_json: target.value,
      target_scope: parsed.data.target_scope,
      title: parsed.data.title.trim(),
    },
    where: { id },
  })

  return NextResponse.json({ ok: true, data: { item } })
}
