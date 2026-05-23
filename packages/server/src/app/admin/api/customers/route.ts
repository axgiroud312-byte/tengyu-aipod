import { type CustomerWithRelations, buildCustomerSummary } from '@/lib/customers'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

function getCustomerSortValue(customer: CustomerWithRelations) {
  const recentActive = customer.codes
    .flatMap((code) => code.devices.map((device) => device.last_active_at.getTime()))
    .sort((a, b) => b - a)[0]

  return recentActive ?? customer.created_at.getTime()
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? ''
  const sort = url.searchParams.get('sort') ?? 'recent_active_desc'

  const customers = await db.customer.findMany({
    include: {
      codes: {
        include: {
          devices: true,
        },
        orderBy: {
          created_at: 'desc',
        },
      },
    },
  })

  const filtered = customers.filter((customer) => {
    if (!search) {
      return true
    }

    const haystack = [customer.name, customer.phone, customer.wechat ?? ''].join(' ').toLowerCase()

    return haystack.includes(search)
  })

  filtered.sort((a, b) => {
    if (sort === 'created_at_desc') {
      return b.created_at.getTime() - a.created_at.getTime()
    }

    return getCustomerSortValue(b) - getCustomerSortValue(a)
  })

  return NextResponse.json({
    ok: true,
    data: {
      items: filtered.map((customer) => buildCustomerSummary(customer)),
      server_time: new Date().toISOString(),
    },
  })
}
