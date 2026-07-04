import { adminPayloadFromRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { parsePhpUidAllowlistInput } from '@/lib/targeting'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const versionSchema = z.object({
  channel: z.enum(['stable', 'beta']),
  changelog: z.string().min(1),
  download_url: z.string().url(),
  enabled: z.boolean(),
  force_upgrade: z.boolean(),
  platform: z.enum(['windows', 'macos']),
  published_at: z.string().min(1),
  target_php_uids: z.string().optional(),
  target_scope: z.enum(['all', 'php_uid_list']),
  version: z.string().min(1),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
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

export async function GET(request: Request) {
  void request
  const items = await db.clientVersion.findMany({
    orderBy: [{ published_at: 'desc' }],
  })

  return NextResponse.json({ ok: true, data: { items } })
}

export async function POST(request: Request) {
  const admin = await adminPayloadFromRequest(request)
  if (!admin) {
    return errorResponse('ADMIN_AUTH_REQUIRED', '管理员登录已失效', 401)
  }

  const parsed = versionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('INVALID_CLIENT_VERSION_INPUT', '客户端版本参数不正确', 400)
  }

  const publishedAt = new Date(parsed.data.published_at)
  if (Number.isNaN(publishedAt.getTime())) {
    return errorResponse('INVALID_PUBLISHED_AT', '发布时间格式不正确', 400)
  }

  const target = targetJson(parsed.data.target_scope, parsed.data.target_php_uids)
  if (!target.ok) {
    return errorResponse('INVALID_TARGET_UIDS', 'PHP uid 白名单格式不正确', 400)
  }

  const data = {
    channel: parsed.data.channel,
    changelog: parsed.data.changelog,
    download_url_mac: parsed.data.platform === 'macos' ? parsed.data.download_url : null,
    download_url_win: parsed.data.platform === 'windows' ? parsed.data.download_url : null,
    enabled: parsed.data.enabled,
    force_upgrade: parsed.data.force_upgrade,
    platform: parsed.data.platform,
    published_at: publishedAt,
    target_php_uids_json: target.value,
    target_scope: parsed.data.target_scope,
    version: parsed.data.version.trim(),
  }

  const item = await db.clientVersion.upsert({
    create: data,
    update: data,
    where: {
      version_platform_channel: {
        channel: data.channel,
        platform: data.platform,
        version: data.version,
      },
    },
  })

  return NextResponse.json({ ok: true, data: { item } })
}
