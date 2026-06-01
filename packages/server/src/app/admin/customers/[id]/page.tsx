'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { use, useCallback, useEffect, useState } from 'react'

interface CustomerDetail {
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

interface CustomerResponse {
  ok: true
  data: {
    customer: CustomerDetail
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN')
}

export default function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = use(params)
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadCustomer = useCallback(async (id: string) => {
    setIsLoading(true)
    const response = await fetch(`/admin/api/customers/${id}`)
    const result = (await response.json()) as CustomerResponse | { ok: false }
    setIsLoading(false)
    if (!result.ok) {
      setMessage('客户不存在')
      return
    }
    setCustomer(result.data.customer)
  }, [])

  useEffect(() => {
    void loadCustomer(customerId)
  }, [customerId, loadCustomer])

  async function submitJson(url: string, init: RequestInit) {
    const response = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json' },
    })
    const result = (await response.json()) as {
      ok: boolean
      error?: { message: string }
    }
    if (!result.ok) {
      setMessage(result.error?.message ?? '操作失败')
      return false
    }
    return true
  }

  async function updateCustomer() {
    if (!customer) {
      return
    }

    const name = window.prompt('客户姓名', customer.name)
    if (!name) {
      return
    }
    const phone = window.prompt('手机号', customer.phone)
    if (!phone) {
      return
    }
    const email = window.prompt('邮箱', customer.email ?? '') ?? ''
    const wechat = window.prompt('微信', customer.wechat ?? '') ?? ''
    const notes = window.prompt('备注', customer.notes ?? '') ?? ''

    const ok = await submitJson(`/admin/api/customers/${customerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, phone, email, wechat, notes }),
    })
    if (ok) {
      setMessage('客户信息已更新')
      await loadCustomer(customerId)
    }
  }

  async function banCustomer() {
    if (!window.confirm('确认封号该客户？')) {
      return
    }

    const ok = await submitJson(`/admin/api/customers/${customerId}/ban`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (ok) {
      setMessage('客户已封号')
      await loadCustomer(customerId)
    }
  }

  if (isLoading && !customer) {
    return (
      <AdminShell description="读取客户记录。" title="客户详情">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </AdminShell>
    )
  }

  if (!customer) {
    return (
      <AdminShell description="读取客户记录。" title="客户详情">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{message ?? '客户不存在'}</p>
          <Button asChild variant="secondary">
            <a href="/admin/customers">返回客户列表</a>
          </Button>
        </div>
      </AdminShell>
    )
  }

  return (
    <AdminShell description="客户记录和封号状态。" title={`客户详情：${customer.name}`}>
      <section className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">客户基本信息</p>
        <Button asChild variant="secondary">
          <a href="/admin/customers">返回列表</a>
        </Button>
      </section>

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div>
              <div className="text-muted-foreground">姓名</div>
              <div>{customer.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground">手机</div>
              <div>{customer.phone}</div>
            </div>
            <div>
              <div className="text-muted-foreground">邮箱</div>
              <div>{customer.email ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">微信</div>
              <div>{customer.wechat ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">状态 / 创建时间</div>
              <div>
                {customer.is_active ? '正常' : '已封号'} / {formatDate(customer.created_at)}
              </div>
            </div>
            <div className="md:col-span-3">
              <div className="text-muted-foreground">备注</div>
              <div>{customer.notes ?? '-'}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void updateCustomer()} type="button" variant="secondary">
              编辑
            </Button>
            <Button onClick={() => void banCustomer()} type="button" variant="secondary">
              封号该客户
            </Button>
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  )
}
