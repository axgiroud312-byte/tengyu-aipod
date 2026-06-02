import { listCustomerAccounts } from '@/lib/customer-accounts'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const search = url.searchParams.get('search') ?? ''
  const accounts = await listCustomerAccounts(search)

  return NextResponse.json({
    ok: true,
    data: {
      items: accounts,
      server_time: new Date().toISOString(),
    },
  })
}
