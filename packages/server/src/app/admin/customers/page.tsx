'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCallback, useEffect, useMemo, useState } from 'react'

type CustomerAuthorizationStatus = 'pending' | 'active' | 'disabled' | 'expired'
type CustomerDatabaseStatus = 'pending' | 'active' | 'disabled'
type CustomerFilter =
  | 'all'
  | 'pending'
  | 'active'
  | 'expires_today'
  | 'expires_7d'
  | 'expires_30d'
  | 'expired'
  | 'disabled'
type CustomerBulkAction = 'approve' | 'set_expires_at' | 'append_note' | 'disable' | 'enable'

type CustomerExpirationStats = {
  disabled: number
  expired: number
  expires_7d: number
  expires_30d: number
  expires_today: number
  pending: number
}

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
        stats: CustomerExpirationStats
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

const emptyStats: CustomerExpirationStats = {
  disabled: 0,
  expired: 0,
  expires_7d: 0,
  expires_30d: 0,
  expires_today: 0,
  pending: 0,
}

const filters: Array<{ key: CustomerFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待开通' },
  { key: 'active', label: '已授权' },
  { key: 'expires_today', label: '今日到期' },
  { key: 'expires_7d', label: '7 天内到期' },
  { key: 'expires_30d', label: '30 天内到期' },
  { key: 'expired', label: '已到期' },
  { key: 'disabled', label: '已禁用' },
]

const bulkActions: Array<{ key: CustomerBulkAction; label: string }> = [
  { key: 'approve', label: '批量授权' },
  { key: 'set_expires_at', label: '设置到期日' },
  { key: 'append_note', label: '追加备注' },
  { key: 'disable', label: '禁用' },
  { key: 'enable', label: '启用' },
]

const bulkActionsRequiringDate = new Set<CustomerBulkAction>([
  'approve',
  'set_expires_at',
  'enable',
])

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
  const [bulkAction, setBulkAction] = useState<CustomerBulkAction>('approve')
  const [bulkExpiresAt, setBulkExpiresAt] = useState('')
  const [bulkNote, setBulkNote] = useState('')
  const [edits, setEdits] = useState<Record<string, AccountEdit>>({})
  const [filter, setFilter] = useState<CustomerFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [stats, setStats] = useState<CustomerExpirationStats>(emptyStats)
  const [isLoading, setIsLoading] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) {
      params.set('search', search.trim())
    }
    if (filter !== 'all') {
      params.set('filter', filter)
    }
    return params
  }, [filter, search])

  const loadAccounts = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/admin/api/customer-accounts?${query.toString()}`)
      const result = (await response.json().catch(() => null)) as CustomerAccountsResponse | null
      if (!result?.ok) {
        setMessage(result?.error?.message ?? '客户账号加载失败')
        return
      }
      setAccounts(result.data.items)
      setStats(result.data.stats)
      setSelectedIds((current) => {
        const loadedIds = new Set(result.data.items.map((account) => account.id))
        return new Set(Array.from(current).filter((id) => loadedIds.has(id)))
      })
      setEdits(
        Object.fromEntries(result.data.items.map((account) => [account.id, accountEdit(account)])),
      )
    } catch {
      setMessage('客户账号加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [query])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  async function submitJson(url: string, init: RequestInit) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { 'content-type': 'application/json' },
      })
      const result = (await response.json().catch(() => null)) as {
        error?: { message: string }
        ok?: boolean
      } | null
      if (!result?.ok) {
        setMessage(result?.error?.message ?? '操作失败')
        return false
      }
      return true
    } catch {
      setMessage('操作失败')
      return false
    }
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

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(accounts.map((account) => account.id)) : new Set())
  }

  async function submitBulkAction() {
    const ids = Array.from(selectedIds)
    if (!ids.length) {
      setMessage('请先选择客户账号')
      return
    }
    const payload: {
      action: CustomerBulkAction
      expires_at?: string
      ids: string[]
      note?: string
    } = {
      action: bulkAction,
      ids,
    }
    if (bulkActionsRequiringDate.has(bulkAction)) {
      if (!hasValidDate(bulkExpiresAt)) {
        setMessage('请填写 YYYY-MM-DD 格式的批量到期日')
        return
      }
      payload.expires_at = localDateEndIso(bulkExpiresAt)
    }
    if (bulkNote.trim()) {
      payload.note = bulkNote
    }

    const ok = await submitJson('/admin/api/customer-accounts/bulk', {
      body: JSON.stringify(payload),
      method: 'POST',
    })
    if (ok) {
      setMessage('批量操作已提交，无法更新的客户会在接口结果中返回跳过原因')
      await loadAccounts()
    }
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

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: '待开通', value: stats.pending },
          { label: '已到期', value: stats.expired },
          { label: '今日到期', value: stats.expires_today },
          { label: '7 天内到期', value: stats.expires_7d },
          { label: '30 天内到期', value: stats.expires_30d },
          { label: '已禁用', value: stats.disabled },
        ].map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular-nums text-2xl font-semibold">{item.value}</p>
            </CardContent>
          </Card>
        ))}
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
          <div className="mb-4 flex flex-wrap gap-2">
            {filters.map((item) => (
              <Button
                key={item.key}
                onClick={() => setFilter(item.key)}
                type="button"
                variant={filter === item.key ? 'default' : 'secondary'}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <div className="mb-4 grid gap-3 rounded-md border bg-muted/30 p-3 xl:grid-cols-[160px_160px_minmax(220px,1fr)_auto]">
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              onChange={(event) => setBulkAction(event.target.value as CustomerBulkAction)}
              value={bulkAction}
            >
              {bulkActions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              onChange={(event) => setBulkExpiresAt(event.target.value)}
              type="date"
              value={bulkExpiresAt}
            />
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              onChange={(event) => setBulkNote(event.target.value)}
              placeholder="批量追加备注，可选"
              value={bulkNote}
            />
            <Button
              disabled={selectedIds.size === 0}
              onClick={() => void submitBulkAction()}
              type="button"
            >
              对 {selectedIds.size} 个客户执行
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2">
                    <input
                      aria-label="选择当前列表全部客户"
                      checked={accounts.length > 0 && selectedIds.size === accounts.length}
                      onChange={(event) => toggleAll(event.target.checked)}
                      type="checkbox"
                    />
                  </th>
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
                      <input
                        aria-label={`选择 uid ${account.php_uid}`}
                        checked={selectedIds.has(account.id)}
                        onChange={(event) => toggleSelected(account.id, event.target.checked)}
                        type="checkbox"
                      />
                    </td>
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
                    <td className="px-3 py-8 text-center text-muted-foreground" colSpan={9}>
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
