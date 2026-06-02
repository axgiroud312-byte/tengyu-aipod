import { db } from '@/lib/db'
import { type PhpAuthVerifyInput, type PhpUserInfoResult, fetchPhpUserInfo } from '@/lib/php-auth'
import type { CustomerAccount, CustomerAccountStatus, Prisma } from '@prisma/client'

export type CustomerAuthorizationStatus = CustomerAccountStatus | 'expired'

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

export async function listCustomerAccounts(search: string) {
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

  return accounts.map((account) => serializeCustomerAccount(account))
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
