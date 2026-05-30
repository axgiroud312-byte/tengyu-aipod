'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/relative-time'
import { useEffect, useMemo, useState } from 'react'

interface CustomerListItem {
  id: string
  name: string
  phone: string
  email: string | null
  wechat: string | null
  notes: string | null
  is_active: boolean
  status: 'active' | 'banned'
  code_count: number
  max_remaining_days: number | null
  total_devices: number
  total_device_slots: number
  recent_active_at: string | null
  created_at: string
}

interface CustomersResponse {
  ok: true
  data: {
    items: CustomerListItem[]
  }
}

function remainingLabel(days: number | null) {
  if (days === null) {
    return '-'
  }
  if (days < 0) {
    return '已过期'
  }
  return `${days} 天`
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('recent_active_desc')
  const [isLoading, setIsLoading] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams({ sort })
    if (search.trim()) {
      params.set('search', search.trim())
    }
    return params
  }, [search, sort])

  useEffect(() => {
    async function loadCustomers() {
      setIsLoading(true)
      const response = await fetch(`/admin/api/customers?${query.toString()}`)
      const result = (await response.json()) as CustomersResponse | { ok: false }
      setIsLoading(false)
      if (!result.ok) {
        return
      }
      setCustomers(result.data.items)
    }

    void loadCustomers()
  }, [query])

  return (
    <AdminShell
      description="查看客户、设备使用、封号状态和客户名下激活码情况。"
      title="客户管理"
    >
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">共 {customers.length} 个客户</p>
        </div>
        <Button asChild>
          <a href="/admin/codes/new">+ 新建客户</a>
        </Button>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>客户列表</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <input
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索姓名 / 手机 / 微信"
                value={search}
              />
              <select
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setSort(event.target.value)}
                value={sort}
              >
                <option value="recent_active_desc">最近活跃倒序</option>
                <option value="created_at_desc">创建时间倒序</option>
              </select>
              <Button disabled={isLoading} type="button" variant="secondary">
                {isLoading ? '加载中...' : '已同步'}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b">
                    {[
                      '客户名',
                      '手机',
                      '微信',
                      '激活码数',
                      '最长剩余天',
                      '总设备数',
                      '最近活跃',
                      '状态',
                      '操作',
                    ].map((header) => (
                      <th className="px-3 py-2 font-medium" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr className="border-b align-top" key={customer.id}>
                      <td className="px-3 py-3">{customer.name}</td>
                      <td className="px-3 py-3">{customer.phone}</td>
                      <td className="px-3 py-3">{customer.wechat ?? '-'}</td>
                      <td className="px-3 py-3">{customer.code_count}</td>
                      <td className="px-3 py-3">{remainingLabel(customer.max_remaining_days)}</td>
                      <td className="px-3 py-3">
                        {customer.total_devices}/{customer.total_device_slots}
                      </td>
                      <td className="px-3 py-3">{formatRelativeTime(customer.recent_active_at)}</td>
                      <td className="px-3 py-3">
                        {customer.status === 'active' ? '激活' : '已封号'}
                      </td>
                      <td className="px-3 py-3">
                        <Button asChild variant="secondary">
                          <a href={`/admin/customers/${customer.id}`}>详情</a>
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!customers.length ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={9}>
                        暂无客户
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
        </CardContent>
      </Card>
    </AdminShell>
  )
}
