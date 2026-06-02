'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { use, useCallback, useEffect, useState } from 'react'

type CustomerAuthorizationStatus = 'pending' | 'active' | 'disabled' | 'expired'
type CustomerDatabaseStatus = 'pending' | 'active' | 'disabled'

type CustomerAccount = {
  account: string | null
  approved_at: string | null
  approved_by_admin_id: string | null
  avatar_url: string | null
  created_at: string
  database_status: CustomerDatabaseStatus
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

type CustomerResponse =
  | {
      data: {
        customer: CustomerAccount
      }
      ok: true
    }
  | {
      error?: { message: string }
      ok: false
    }

function formatDateTime(value: string | null) {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleString('zh-CN')
}

function statusLabel(status: CustomerAuthorizationStatus) {
  const labels: Record<CustomerAuthorizationStatus, string> = {
    active: '已授权',
    disabled: '已禁用',
    expired: '已到期',
    pending: '待开通',
  }
  return labels[status]
}

function dateInputValue(value: string | null) {
  if (!value) {
    return ''
  }
  return new Date(value).toISOString().slice(0, 10)
}

function localDateEndIso(value: string) {
  const [yearText, monthText, dayText] = value.split('-')
  return new Date(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    23,
    59,
    59,
    999,
  ).toISOString()
}

function promptExpiresAt(defaultValue: string | null) {
  const value = window.prompt('到期日（YYYY-MM-DD）', dateInputValue(defaultValue))
  if (value === null) {
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    window.alert('请填写 YYYY-MM-DD 格式的到期日')
    return null
  }
  return localDateEndIso(value)
}

export default function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: accountId } = use(params)
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadAccount = useCallback(async (id: string) => {
    setIsLoading(true)
    const response = await fetch(`/admin/api/customer-accounts/${id}`)
    const result = (await response.json()) as CustomerResponse
    setIsLoading(false)
    if (!result.ok) {
      setMessage(result.error?.message ?? '客户账号不存在')
      return
    }
    setAccount(result.data.customer)
  }, [])

  useEffect(() => {
    void loadAccount(accountId)
  }, [accountId, loadAccount])

  async function submitJson(url: string, init: RequestInit) {
    const response = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json' },
    })
    const result = (await response.json()) as {
      error?: { message: string }
      ok: boolean
    }
    if (!result.ok) {
      setMessage(result.error?.message ?? '操作失败')
      return false
    }
    return true
  }

  async function approve() {
    if (!account) {
      return
    }
    const expires_at = promptExpiresAt(account.expires_at)
    if (!expires_at) {
      return
    }
    const notes = window.prompt('备注', account.notes ?? '') ?? account.notes ?? ''
    const ok = await submitJson(`/admin/api/customer-accounts/${account.id}/approve`, {
      body: JSON.stringify({ expires_at, notes }),
      method: 'POST',
    })
    if (ok) {
      setMessage('客户账号已授权')
      await loadAccount(accountId)
    }
  }

  async function updateAccount() {
    if (!account) {
      return
    }
    const expires_at = promptExpiresAt(account.expires_at)
    if (!expires_at) {
      return
    }
    const notes = window.prompt('备注', account.notes ?? '') ?? account.notes ?? ''
    const ok = await submitJson(`/admin/api/customer-accounts/${account.id}`, {
      body: JSON.stringify({ expires_at, notes }),
      method: 'PATCH',
    })
    if (ok) {
      setMessage('客户账号已更新')
      await loadAccount(accountId)
    }
  }

  async function disable() {
    if (!account || !window.confirm(`确认禁用 uid ${account.php_uid}？`)) {
      return
    }
    const ok = await submitJson(`/admin/api/customer-accounts/${account.id}/disable`, {
      body: JSON.stringify({}),
      method: 'POST',
    })
    if (ok) {
      setMessage('客户账号已禁用')
      await loadAccount(accountId)
    }
  }

  async function enable() {
    if (!account) {
      return
    }
    const expires_at = promptExpiresAt(account.expires_at)
    if (!expires_at) {
      return
    }
    const notes = window.prompt('备注', account.notes ?? '') ?? account.notes ?? ''
    const ok = await submitJson(`/admin/api/customer-accounts/${account.id}/enable`, {
      body: JSON.stringify({ expires_at, notes }),
      method: 'POST',
    })
    if (ok) {
      setMessage('客户账号已重新启用')
      await loadAccount(accountId)
    }
  }

  if (isLoading && !account) {
    return (
      <AdminShell description="读取客户账号授权信息。" title="客户账号详情">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </AdminShell>
    )
  }

  if (!account) {
    return (
      <AdminShell description="读取客户账号授权信息。" title="客户账号详情">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{message ?? '客户账号不存在'}</p>
          <Button asChild variant="secondary">
            <a href="/admin/customers">返回客户列表</a>
          </Button>
        </div>
      </AdminShell>
    )
  }

  return (
    <AdminShell description="客户账号授权、到期日、禁用状态和备注。" title="客户账号详情">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">PHP uid：{account.php_uid}</p>
        <Button asChild variant="secondary">
          <a href="/admin/customers">返回列表</a>
        </Button>
      </section>

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{account.nickname ?? `uid ${account.php_uid}`}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div>
              <div className="text-muted-foreground">状态</div>
              <div>{statusLabel(account.status)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">账号</div>
              <div>{account.account ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">手机</div>
              <div>{account.phone ?? '-'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">到期日</div>
              <div>{formatDateTime(account.expires_at)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">最后登录</div>
              <div>{formatDateTime(account.last_login_at)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">授权时间</div>
              <div>{formatDateTime(account.approved_at)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">禁用时间</div>
              <div>{formatDateTime(account.disabled_at)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">创建时间</div>
              <div>{formatDateTime(account.created_at)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">更新时间</div>
              <div>{formatDateTime(account.updated_at)}</div>
            </div>
            <div className="md:col-span-3">
              <div className="text-muted-foreground">备注</div>
              <div>{account.notes ?? '-'}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {account.status === 'pending' ? (
              <Button onClick={() => void approve()} type="button">
                授权
              </Button>
            ) : null}
            {account.status === 'active' || account.status === 'expired' ? (
              <Button onClick={() => void updateAccount()} type="button" variant="secondary">
                修改到期日和备注
              </Button>
            ) : null}
            {account.status === 'disabled' ? (
              <Button onClick={() => void enable()} type="button" variant="secondary">
                重新启用
              </Button>
            ) : null}
            {account.database_status !== 'disabled' ? (
              <Button onClick={() => void disable()} type="button" variant="secondary">
                禁用账号
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  )
}
