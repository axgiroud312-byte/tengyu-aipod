import { DEFAULT_PHP_AUTH_BASE_URL } from '@tengyu-aipod/shared'
import { z } from 'zod'

export const phpAuthVerifyInputSchema = z.object({
  uid: z.coerce.number().int().positive(),
  secret: z.string().min(1),
  finger: z.string().min(1),
})

export type PhpAuthVerifyInput = z.infer<typeof phpAuthVerifyInputSchema>

export type PhpUserInfo = {
  account: string | null
  avatar_url: string | null
  nickname: string | null
  phone: string | null
  php_uid: number
}

export type PhpUserInfoResult =
  | { ok: true; user: PhpUserInfo }
  | { ok: false; reason: 'nologin' | 'failed'; message: string }

type Fetcher = typeof fetch

const nullableStringSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  return null
}, z.string().nullable())

const phpUserDataSchema = z
  .object({
    account: nullableStringSchema.optional(),
    avatar: nullableStringSchema.optional(),
    nickname: nullableStringSchema.optional(),
    tel: nullableStringSchema.optional(),
    uid: z.coerce.number().int().positive(),
  })
  .passthrough()

const phpInfoResponseSchema = z
  .object({
    data: z.unknown().optional(),
    info: z.string().optional(),
    nologin: z.unknown().optional(),
    status: z.unknown().optional(),
  })
  .passthrough()

function isTruthyFlag(value: unknown) {
  return value === true || value === 1 || value === '1'
}

function isSuccessStatus(value: unknown) {
  return value === 1 || value === '1'
}

export function phpAuthBaseUrl() {
  return (process.env.PHP_AUTH_BASE_URL?.trim() || DEFAULT_PHP_AUTH_BASE_URL).replace(/\/+$/, '')
}

export async function fetchPhpUserInfo(
  input: PhpAuthVerifyInput,
  options: { fetcher?: Fetcher } = {},
): Promise<PhpUserInfoResult> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`${phpAuthBaseUrl()}/user/user/info`, {
    body: JSON.stringify({
      finger: input.finger,
      secret: input.secret,
      uid: input.uid,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  const raw = (await response.json().catch(() => null)) as unknown
  const parsed = phpInfoResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('PHP_AUTH_RESPONSE_INVALID')
  }

  const message = parsed.data.info ?? '登录状态失效，请重新登录'
  if (isTruthyFlag(parsed.data.nologin)) {
    return { ok: false, reason: 'nologin', message }
  }

  if (!isSuccessStatus(parsed.data.status)) {
    return { ok: false, reason: 'failed', message }
  }

  const data = phpUserDataSchema.safeParse(parsed.data.data)
  if (!data.success) {
    throw new Error('PHP_AUTH_USER_INFO_INVALID')
  }

  if (data.data.uid !== input.uid) {
    return { ok: false, reason: 'failed', message: 'PHP 用户信息与请求 uid 不一致' }
  }

  return {
    ok: true,
    user: {
      account: data.data.account ?? null,
      avatar_url: data.data.avatar ?? null,
      nickname: data.data.nickname ?? null,
      phone: data.data.tel ?? null,
      php_uid: data.data.uid,
    },
  }
}
