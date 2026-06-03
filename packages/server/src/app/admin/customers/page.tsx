'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCallback, useEffect, useMemo, useState } from 'react'

type CustomerAuthorizationStatus = 'pending' | 'active' | 'disabled' | 'expired'
type CustomerDatabaseStatus = 'pending' | 'active' | 'disabled'

type CustomerAccount = {
  account: string | null
  avatar_url: string | null
  created_at: string
  database_status: CustomerDatabaseStatus
  expires_at: string | null
  id: string
  last_login_at: string | null
  nickname: string | null
  notes: string | null
  phone: string | null
  php_uid: number
  status: CustomerAuthorizationStatus
}

type CustomerAccountsResponse =
  | {
      data: {
        items: CustomerAccount[]
      }
      ok: true
    }
  | {
      error?: { message: string }
      ok: false
    }

type AccountEdit = {
  expires_at: string
  notes: string
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

function statusClassName(status: CustomerAuthorizationStatus) {
  const classes: Record<CustomerAuthorizationStatus, string> = {
    active: 'bg-green-50 text-green-700 ring-green-200',
    disabled: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
    expired: 'bg-amber-50 text-amber-700 ring-amber-200',
    pending: 'bg-blue-50 text-blue-700 ring-blue-200',
  }
  return classes[status]
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

function accountEdit(account: CustomerAccount): AccountEdit {
  return {
    expires_at: dateInputValue(account.expires_at),
    notes: account.notes ?? '',
  }
}

function hasValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function payloadFromEdit(edit: AccountEdit) {
  const value = edit.expires_at.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  return {
    expires_at: localDateEndIso(value),
    notes: edit.notes,
  }
}

export default function AdminCustomersPage() {
  const [accounts, setAccounts] = useState<CustomerAccount[]>([])
  const [edits, setEdits] = useState<Record<string, AccountEdit>>({})
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) {
      params.set('search', search.trim())
    }
    return params
  }, [search])

  const loadAccounts = useCallback(async () => {
    setIsLoading(true)
    const response = await fetch(`/admin/api/customer-accounts?${query.toString()}`)
    const result = (await response.json()) as CustomerAccountsResponse
    setIsLoading(false)
    if (!result.ok) {
      setMessage(result.error?.message ?? '客户账号加载失败')
      return
    }
    setAccounts(result.data.items)
    setEdits(
      Object.fromEntries(result.data.items.map((account) => [account.id, accountEdit(account)])),
    )
  }, [query])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

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

  function currentEdit(account: CustomerAccount) {
    return edits[account.id] ?? accountEdit(account)
  }

  function updateEdit(id: string, patch: Partial<AccountEdit>) {
    setEdits((current) => ({
      ...current,
      [id]: {
        expires_at: current[id]?.expires_at ?? '',
        notes: current[id]?.notes ?? '',
        ...patch,
      },
    }))
  }

  function actionPayload(account: CustomerAccount) {
    const payload = payloadFromEdit(currentEdit(account))
    if (!payload) {
      setMessage('请填写 YYYY-MM-DD 格式的到期日')
    }
    return payload
  }

  async function approve(account: CustomerAccount) {
    const payload = actionPayload(account)
    if (!payload) {
      return
    }
    const ok = await submitJson(`/admin/api/customer-accounts/${account.id}/approve`, {
      body: JSON.stringify(payload),
      method: 'POST',
    })
    if (ok) {
      setMessage(`已授权 uid ${account.php_uid}`)
      await loadAccounts()
    }
  }

  async function updateAccount(account: CustomerAccount) {
    const payload = actionPayload(account)
    if (!payload) {
      return
    }
    const ok = await submitJson(`/admin/api/customer-accounts/${account.id}`, {
      body: JSON.stringify(payload),
      method: 'PATCH',
    })
    if (ok) {
      setMessage(`已更新 uid ${account.php_uid}`)
      await loadAccounts()
    }
  }

  async function disable(account: CustomerAccount) {
    if (!window.confirm(`确认禁用 uid ${account.php_uid}？`)) {
      return
    }
    const ok = await submitJson(`/admin/api/customer-accounts/${account.id}/disable`, {
      body: JSON.stringify({}),
      method: 'POST',
    })
    if (ok) {
      setMessage(`已禁用 uid ${account.php_uid}`)
      await loadAccounts()
    }
  }

  async function enable(account: CustomerAccount) {
    const payload = actionPayload(account)
    if (!payload) {
      return
    }
    const ok = await submitJson(`/admin/api/customer-accounts/${account.id}/enable`, {
      body: JSON.stringify(payload),
      method: 'POST',
    })
    if (ok) {
      setMessage(`已重新启用 uid ${account.php_uid}`)
      await loadAccounts()
    }
  }

  return (
    <AdminShell
      description="按 PHP uid 管理客户授权、到期日、禁用状态和备注。"
      title="客户账号授权"
    >
      <section className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">共 {accounts.length} 个客户账号</p>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>授权列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(260px,1fr)_auto]">
            <input
              className="h-10 rounded-md border px-3 text-sm"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索 uid / 昵称 / 手机号"
              value={search}
            />
            <Button disabled={isLoading} onClick={() => void loadAccounts()} type="button">
              {isLoading ? '加载中...' : '刷新'}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  {['客户', 'PHP uid', '手机', '状态', '到期日', '最后登录', '备注', '操作'].map(
                    (header) => (
                      <th className="px-3 py-2 font-medium" key={header}>
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr className="border-b align-top" key={account.id}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        {account.avatar_url ? (
                          <img
                            alt="头像"
                            className="h-10 w-10 rounded-md object-cover"
                            src={account.avatar_url}
                          />
                        ) : (
                          <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-xs text-muted-foreground">
                            -
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium">{account.nickname ?? '-'}</div>
                          <div className="text-xs text-muted-foreground">
                            {account.account ?? '-'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{account.php_uid}</td>
                    <td className="px-3 py-3">{account.phone ?? '-'}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ring-1 ${statusClassName(
                          account.status,
                        )}`}
                      >
                        {statusLabel(account.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3">{formatDateTime(account.expires_at)}</td>
                    <td className="px-3 py-3">{formatDateTime(account.last_login_at)}</td>
                    <td className="max-w-[220px] px-3 py-3 text-muted-foreground">
                      <span className="line-clamp-2">{account.notes ?? '-'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="grid min-w-80 gap-2">
                        <div className="grid gap-2 md:grid-cols-[150px_minmax(160px,1fr)]">
                          <input
                            aria-label={`uid ${account.php_uid} 到期日`}
                            className="h-9 rounded-md border px-2 text-sm"
                            onChange={(event) =>
                              updateEdit(account.id, { expires_at: event.target.value })
                            }
                            type="date"
                            value={currentEdit(account).expires_at}
                          />
                          <input
                            aria-label={`uid ${account.php_uid} 备注`}
                            className="h-9 rounded-md border px-2 text-sm"
                            onChange={(event) =>
                              updateEdit(account.id, { notes: event.target.value })
                            }
                            placeholder="备注"
                            value={currentEdit(account).notes}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!hasValidDate(currentEdit(account).expires_at) ? (
                            <span className="self-center text-xs text-amber-700">需填写到期日</span>
                          ) : null}
                          {account.status === 'pending' ? (
                            <Button
                              className="h-8 px-3"
                              onClick={() => void approve(account)}
                              type="button"
                            >
                              授权
                            </Button>
                          ) : null}
                          {account.status === 'active' || account.status === 'expired' ? (
                            <Button
                              className="h-8 px-3"
                              onClick={() => void updateAccount(account)}
                              type="button"
                              variant="secondary"
                            >
                              修改
                            </Button>
                          ) : null}
                          {account.status === 'disabled' ? (
                            <Button
                              className="h-8 px-3"
                              onClick={() => void enable(account)}
                              type="button"
                              variant="secondary"
                            >
                              启用
                            </Button>
                          ) : null}
                          {account.database_status !== 'disabled' ? (
                            <Button
                              className="h-8 px-3"
                              onClick={() => void disable(account)}
                              type="button"
                              variant="secondary"
                            >
                              禁用
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
                {!accounts.length ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-muted-foreground" colSpan={8}>
                      暂无客户账号
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
