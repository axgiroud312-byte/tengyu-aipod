import {
  type CustomerAccountListFilter,
  getCustomerExpirationStats,
  listCustomerAccounts,
} from '@/lib/customer-accounts'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

const filters = new Set<CustomerAccountListFilter>([
  'all',
  'pending',
  'active',
  'expires_today',
  'expires_7d',
  'expires_30d',
  'expired',
  'disabled',
])

export async function GET(request: Request) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search') ?? ''
  const rawFilter = url.searchParams.get('filter') ?? 'all'
  const filter = filters.has(rawFilter as CustomerAccountListFilter)
    ? (rawFilter as CustomerAccountListFilter)
    : 'all'
  const now = new Date()
  const [accounts, allAccounts] = await Promise.all([
    listCustomerAccounts({ filter, now, search }),
    db.customerAccount.findMany(),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      items: accounts,
      stats: getCustomerExpirationStats(allAccounts, now),
      server_time: new Date().toISOString(),
    },
  })
}
