import { buildCustomerSummary } from '@/lib/customers'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? ''
  const sort = url.searchParams.get('sort') ?? 'created_at_desc'

  const customers = await db.customer.findMany({
    orderBy: { created_at: 'desc' },
  })

  const filtered = customers.filter((customer) => {
    if (!search) {
      return true
    }

    const haystack = [customer.name, customer.phone, customer.wechat ?? ''].join(' ').toLowerCase()

    return haystack.includes(search)
  })

  filtered.sort((a, b) => {
    if (sort === 'created_at_asc') {
      return a.created_at.getTime() - b.created_at.getTime()
    }

    return b.created_at.getTime() - a.created_at.getTime()
  })

  return NextResponse.json({
    ok: true,
    data: {
      items: filtered.map((customer) => buildCustomerSummary(customer)),
      server_time: new Date().toISOString(),
    },
  })
}
