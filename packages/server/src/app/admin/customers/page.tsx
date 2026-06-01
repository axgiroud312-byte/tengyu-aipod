'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  created_at: string
}

interface CustomersResponse {
  ok: true
  data: {
    items: CustomerListItem[]
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN')
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('created_at_desc')
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
    <AdminShell description="查看客户记录、联系方式和封号状态。" title="客户管理">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">共 {customers.length} 个客户</p>
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
              <option value="created_at_desc">创建时间倒序</option>
              <option value="created_at_asc">创建时间正序</option>
            </select>
            <Button disabled={isLoading} type="button" variant="secondary">
              {isLoading ? '加载中...' : '已同步'}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  {['客户名', '手机', '微信', '邮箱', '创建时间', '状态', '操作'].map((header) => (
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
                    <td className="px-3 py-3">{customer.email ?? '-'}</td>
                    <td className="px-3 py-3">{formatDate(customer.created_at)}</td>
                    <td className="px-3 py-3">
                      {customer.status === 'active' ? '正常' : '已封号'}
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
                    <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>
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
