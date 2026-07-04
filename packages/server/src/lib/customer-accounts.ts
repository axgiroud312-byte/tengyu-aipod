import { db } from '@/lib/db'
import { type PhpAuthVerifyInput, type PhpUserInfoResult, fetchPhpUserInfo } from '@/lib/php-auth'
import type { CustomerAccount, CustomerAccountStatus, Prisma } from '@prisma/client'

export type CustomerAuthorizationStatus = CustomerAccountStatus | 'expired'
export type CustomerAccountListFilter =
  | 'all'
  | 'pending'
  | 'active'
  | 'expires_today'
  | 'expires_7d'
  | 'expires_30d'
  | 'expired'
  | 'disabled'

export type CustomerExpirationStats = {
  disabled: number
  expired: number
  expires_7d: number
  expires_30d: number
  expires_today: number
  pending: number
}
export type CustomerBulkAction = 'approve' | 'set_expires_at' | 'append_note' | 'disable' | 'enable'

export type CustomerBulkUpdateResult = {
  skipped: Array<{ id: string; reason: string }>
  updated_count: number
}

export type SerializedCustomerAccount = {
  account: string | null
  approved_at: string | null
  approved_by_admin_id: string | null
  avatar_url: string | null
  created_at: string
  database_status: CustomerAccountStatus
  disabled_at: string | null
  expires_at: string | null
  id: string
  last_login_at: string | null
  nickname: string | null
  notes: string | null
  phone: string | null
  php_uid: number
  status: CustomerAuthorizationStatus
  updated_at: string
}

export type CustomerVerifyResult =
  | {
      customer: SerializedCustomerAccount
      ok: true
      status: CustomerAuthorizationStatus
    }
  | {
      message: string
      ok: false
      reason: 'nologin' | 'failed'
    }

function iso(value: Date | null) {
  return value ? value.toISOString() : null
}

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function appendedNotes(current: string | null, note: string | null | undefined) {
  const trimmed = nullableText(note)
  if (!trimmed) {
    return current
  }

  return current ? `${current}\n${trimmed}` : trimmed
}

function endOfLocalDay(value: Date, daysFromNow = 0) {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate() + daysFromNow,
    23,
    59,
    59,
    999,
  )
}

export function parseExpiresAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function resolveCustomerAuthorizationStatus(
  account: Pick<CustomerAccount, 'expires_at' | 'status'>,
  now = new Date(),
): CustomerAuthorizationStatus {
  if (account.status !== 'active') {
    return account.status
  }

  if (!account.expires_at || account.expires_at.getTime() <= now.getTime()) {
    return 'expired'
  }

  return 'active'
}

export function serializeCustomerAccount(
  account: CustomerAccount,
  now = new Date(),
): SerializedCustomerAccount {
  return {
    account: account.account,
    approved_at: iso(account.approved_at),
    approved_by_admin_id: account.approved_by_admin_id,
    avatar_url: account.avatar_url,
    created_at: account.created_at.toISOString(),
    database_status: account.status,
    disabled_at: iso(account.disabled_at),
    expires_at: iso(account.expires_at),
    id: account.id,
    last_login_at: iso(account.last_login_at),
    nickname: account.nickname,
    notes: account.notes,
    phone: account.phone,
    php_uid: account.php_uid,
    status: resolveCustomerAuthorizationStatus(account, now),
    updated_at: account.updated_at.toISOString(),
  }
}

function isActiveAndExpiresBy(account: CustomerAccount, now: Date, daysFromNow: number) {
  if (resolveCustomerAuthorizationStatus(account, now) !== 'active' || !account.expires_at) {
    return false
  }

  return account.expires_at.getTime() <= endOfLocalDay(now, daysFromNow).getTime()
}

function customerUrgencyRank(account: CustomerAccount, now: Date) {
  const status = resolveCustomerAuthorizationStatus(account, now)
  if (status === 'expired') {
    return 0
  }
  if (isActiveAndExpiresBy(account, now, 0)) {
    return 1
  }
  if (isActiveAndExpiresBy(account, now, 7)) {
    return 2
  }
  if (isActiveAndExpiresBy(account, now, 30)) {
    return 3
  }
  if (status === 'pending') {
    return 4
  }
  if (status === 'active') {
    return 5
  }
  return 6
}

function matchesCustomerFilter(
  account: CustomerAccount,
  filter: CustomerAccountListFilter,
  now: Date,
) {
  const status = resolveCustomerAuthorizationStatus(account, now)
  if (filter === 'all') {
    return true
  }
  if (filter === 'active') {
    return status === 'active'
  }
  if (filter === 'expires_today') {
    return isActiveAndExpiresBy(account, now, 0)
  }
  if (filter === 'expires_7d') {
    return isActiveAndExpiresBy(account, now, 7)
  }
  if (filter === 'expires_30d') {
    return isActiveAndExpiresBy(account, now, 30)
  }
  return status === filter
}

export function getCustomerExpirationStats(
  accounts: CustomerAccount[],
  now = new Date(),
): CustomerExpirationStats {
  return accounts.reduce<CustomerExpirationStats>(
    (stats, account) => {
      const status = resolveCustomerAuthorizationStatus(account, now)
      if (status === 'pending') {
        stats.pending += 1
      } else if (status === 'expired') {
        stats.expired += 1
      } else if (status === 'disabled') {
        stats.disabled += 1
      }

      if (isActiveAndExpiresBy(account, now, 0)) {
        stats.expires_today += 1
      }
      if (isActiveAndExpiresBy(account, now, 7)) {
        stats.expires_7d += 1
      }
      if (isActiveAndExpiresBy(account, now, 30)) {
        stats.expires_30d += 1
      }

      return stats
    },
    {
      disabled: 0,
      expired: 0,
      expires_7d: 0,
      expires_30d: 0,
      expires_today: 0,
      pending: 0,
    },
  )
}

export async function verifyAndSyncCustomerAccount(
  input: PhpAuthVerifyInput,
  options: {
    now?: Date
    verifyPhpUserInfo?: (input: PhpAuthVerifyInput) => Promise<PhpUserInfoResult>
  } = {},
): Promise<CustomerVerifyResult> {
  const verifyPhpUserInfo = options.verifyPhpUserInfo ?? fetchPhpUserInfo
  const phpResult = await verifyPhpUserInfo(input)
  if (!phpResult.ok) {
    return phpResult
  }

  const now = options.now ?? new Date()
  const account = await db.customerAccount.upsert({
    create: {
      account: nullableText(phpResult.user.account),
      avatar_url: nullableText(phpResult.user.avatar_url),
      last_login_at: now,
      nickname: nullableText(phpResult.user.nickname),
      phone: nullableText(phpResult.user.phone),
      php_uid: phpResult.user.php_uid,
      status: 'pending',
    },
    update: {
      account: nullableText(phpResult.user.account),
      avatar_url: nullableText(phpResult.user.avatar_url),
      last_login_at: now,
      nickname: nullableText(phpResult.user.nickname),
      phone: nullableText(phpResult.user.phone),
    },
    where: { php_uid: phpResult.user.php_uid },
  })

  const status = resolveCustomerAuthorizationStatus(account, now)

  return {
    customer: serializeCustomerAccount(account, now),
    ok: true,
    status,
  }
}

export async function listCustomerAccounts(
  input:
    | string
    | {
        filter?: CustomerAccountListFilter
        now?: Date
        search?: string
      },
) {
  const search = typeof input === 'string' ? input : (input.search ?? '')
  const filter = typeof input === 'string' ? 'all' : (input.filter ?? 'all')
  const now = typeof input === 'string' ? new Date() : (input.now ?? new Date())
  const trimmed = search.trim()
  const numericUid = Number(trimmed)
  const orFilters: Prisma.CustomerAccountWhereInput[] = []

  if (trimmed && Number.isInteger(numericUid) && numericUid > 0) {
    orFilters.push({ php_uid: numericUid })
  }

  if (trimmed) {
    orFilters.push(
      { nickname: { contains: trimmed, mode: 'insensitive' } },
      { phone: { contains: trimmed, mode: 'insensitive' } },
    )
  }

  const query: Prisma.CustomerAccountFindManyArgs = {
    orderBy: { created_at: 'desc' },
  }
  if (orFilters.length > 0) {
    query.where = { OR: orFilters }
  }

  const accounts = await db.customerAccount.findMany(query)
  const filtered = accounts
    .filter((account) => matchesCustomerFilter(account, filter, now))
    .sort((left, right) => {
      const rankDiff = customerUrgencyRank(left, now) - customerUrgencyRank(right, now)
      if (rankDiff !== 0) {
        return rankDiff
      }

      return right.created_at.getTime() - left.created_at.getTime()
    })

  return filtered.map((account) => serializeCustomerAccount(account, now))
}

export async function getCustomerAccount(id: string) {
  const account = await db.customerAccount.findUnique({ where: { id } })
  return account ? serializeCustomerAccount(account) : null
}

export async function approveCustomerAccount(input: {
  adminId: string
  expiresAt: Date
  id: string
  notes?: string | null
}) {
  const current = await db.customerAccount.findUnique({ where: { id: input.id } })
  if (!current) {
    return null
  }

  const account = await db.customerAccount.update({
    data: {
      approved_at: new Date(),
      approved_by_admin_id: input.adminId,
      disabled_at: null,
      expires_at: input.expiresAt,
      ...(input.notes !== undefined ? { notes: nullableText(input.notes) } : {}),
      status: 'active',
    },
    where: { id: input.id },
  })

  return serializeCustomerAccount(account)
}

export async function updateCustomerAccount(input: {
  expiresAt?: Date
  id: string
  notes?: string | null
}) {
  const current = await db.customerAccount.findUnique({ where: { id: input.id } })
  if (!current) {
    return null
  }

  const account = await db.customerAccount.update({
    data: {
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
      ...(input.notes !== undefined ? { notes: nullableText(input.notes) } : {}),
    },
    where: { id: input.id },
  })

  return serializeCustomerAccount(account)
}

export async function disableCustomerAccount(id: string) {
  const current = await db.customerAccount.findUnique({ where: { id } })
  if (!current) {
    return null
  }

  const account = await db.customerAccount.update({
    data: {
      disabled_at: new Date(),
      status: 'disabled',
    },
    where: { id },
  })

  return serializeCustomerAccount(account)
}

export async function enableCustomerAccount(input: {
  adminId: string
  expiresAt?: Date
  id: string
  notes?: string | null
}) {
  const current = await db.customerAccount.findUnique({ where: { id: input.id } })
  if (!current) {
    return { account: null, error: null }
  }

  const expiresAt = input.expiresAt ?? current.expires_at
  if (!expiresAt) {
    return { account: null, error: 'expires_at_required' as const }
  }

  const account = await db.customerAccount.update({
    data: {
      approved_at: current.approved_at ?? new Date(),
      approved_by_admin_id: current.approved_by_admin_id ?? input.adminId,
      disabled_at: null,
      expires_at: expiresAt,
      ...(input.notes !== undefined ? { notes: nullableText(input.notes) } : {}),
      status: 'active',
    },
    where: { id: input.id },
  })

  return { account: serializeCustomerAccount(account), error: null }
}

export async function bulkUpdateCustomerAccounts(input: {
  action: CustomerBulkAction
  adminId: string
  expiresAt?: Date
  ids: string[]
  note?: string | null
  now?: Date
}): Promise<CustomerBulkUpdateResult> {
  const now = input.now ?? new Date()
  const uniqueIds = Array.from(new Set(input.ids))
  const accounts = await db.customerAccount.findMany({
    where: { id: { in: uniqueIds } },
  })
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  const result: CustomerBulkUpdateResult = { skipped: [], updated_count: 0 }

  for (const id of uniqueIds) {
    const account = accountsById.get(id)
    if (!account) {
      result.skipped.push({ id, reason: '客户账号不存在' })
      continue
    }

    const status = resolveCustomerAuthorizationStatus(account, now)

    if (input.action === 'approve') {
      if (!input.expiresAt) {
        result.skipped.push({ id, reason: '批量授权必须填写到期日' })
        continue
      }
      if (status !== 'pending') {
        result.skipped.push({ id, reason: '只有待开通客户可批量授权' })
        continue
      }

      await db.customerAccount.update({
        data: {
          approved_at: now,
          approved_by_admin_id: input.adminId,
          disabled_at: null,
          expires_at: input.expiresAt,
          notes: appendedNotes(account.notes, input.note),
          status: 'active',
        },
        where: { id },
      })
      result.updated_count += 1
      continue
    }

    if (input.action === 'set_expires_at') {
      if (!input.expiresAt) {
        result.skipped.push({ id, reason: '设置到期日必须填写到期日' })
        continue
      }
      if (status !== 'active' && status !== 'expired') {
        result.skipped.push({ id, reason: '只有已授权或已到期客户可设置到期日' })
        continue
      }

      await db.customerAccount.update({
        data: { expires_at: input.expiresAt },
        where: { id },
      })
      result.updated_count += 1
      continue
    }

    if (input.action === 'append_note') {
      const notes = appendedNotes(account.notes, input.note)
      if (notes === account.notes) {
        result.skipped.push({ id, reason: '追加备注不能为空' })
        continue
      }

      await db.customerAccount.update({
        data: { notes },
        where: { id },
      })
      result.updated_count += 1
      continue
    }

    if (input.action === 'disable') {
      if (status === 'disabled') {
        result.skipped.push({ id, reason: '客户账号已禁用' })
        continue
      }

      await db.customerAccount.update({
        data: { disabled_at: now, status: 'disabled' },
        where: { id },
      })
      result.updated_count += 1
      continue
    }

    if (!input.expiresAt) {
      result.skipped.push({ id, reason: '启用客户必须填写到期日' })
      continue
    }
    if (status !== 'disabled') {
      result.skipped.push({ id, reason: '只有已禁用客户可重新启用' })
      continue
    }

    await db.customerAccount.update({
      data: {
        approved_at: account.approved_at ?? now,
        approved_by_admin_id: account.approved_by_admin_id ?? input.adminId,
        disabled_at: null,
        expires_at: input.expiresAt,
        notes: appendedNotes(account.notes, input.note),
        status: 'active',
      },
      where: { id },
    })
    result.updated_count += 1
  }

  return result
}
