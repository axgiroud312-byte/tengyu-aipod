'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

type AdminItem = {
  created_at: string
  email: string
  id: string
  is_active: boolean
  last_login_at: string | null
  name: string
  role: string
}

type AdminsResponse =
  | {
      data: { admins: AdminItem[] }
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

export default function AdminAccountsPage() {
  const [admins, setAdmins] = useState<AdminItem[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'super'>('admin')
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadAdmins = useCallback(async () => {
    setIsLoading(true)
    const response = await fetch('/admin/api/admins')
    const result = (await response.json()) as AdminsResponse
    setIsLoading(false)
    if (!result.ok) {
      setMessage(result.error?.message ?? '管理员列表加载失败')
      return
    }
    setAdmins(result.data.admins)
  }, [])

  useEffect(() => {
    void loadAdmins()
  }, [loadAdmins])

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

  async function createAdminAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const ok = await submitJson('/admin/api/admins', {
      body: JSON.stringify({ email, name, password, role }),
      method: 'POST',
    })
    if (ok) {
      setEmail('')
      setName('')
      setPassword('')
      setRole('admin')
      setMessage('管理员账号已创建')
      await loadAdmins()
    }
  }

  async function updateAdmin(admin: AdminItem) {
    const nextName = window.prompt('管理员名称', admin.name)
    if (!nextName) {
      return
    }
    const nextRole = window.prompt('角色：admin / super', admin.role)
    if (nextRole !== 'admin' && nextRole !== 'super') {
      setMessage('角色只能填写 admin 或 super')
      return
    }
    const ok = await submitJson(`/admin/api/admins/${admin.id}`, {
      body: JSON.stringify({ name: nextName, role: nextRole }),
      method: 'PATCH',
    })
    if (ok) {
      setMessage('管理员账号已更新')
      await loadAdmins()
    }
  }

  async function toggleAdmin(admin: AdminItem) {
    const nextActive = !admin.is_active
    const label = nextActive ? '启用' : '禁用'
    if (!window.confirm(`确认${label} ${admin.email}？`)) {
      return
    }
    const ok = await submitJson(`/admin/api/admins/${admin.id}`, {
      body: JSON.stringify({ is_active: nextActive }),
      method: 'PATCH',
    })
    if (ok) {
      setMessage(`管理员账号已${label}`)
      await loadAdmins()
    }
  }

  return (
    <AdminShell description="创建后台管理员账号，管理登录状态和基础角色。" title="管理员账号">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">共 {admins.length} 个管理员</p>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>创建管理员</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_160px_auto]"
            onSubmit={createAdminAccount}
          >
            <input
              className="h-10 rounded-md border px-3 text-sm"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="邮箱"
              type="email"
              value={email}
            />
            <input
              className="h-10 rounded-md border px-3 text-sm"
              onChange={(event) => setName(event.target.value)}
              placeholder="名称"
              value={name}
            />
            <input
              className="h-10 rounded-md border px-3 text-sm"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="初始密码"
              type="password"
              value={password}
            />
            <select
              className="h-10 rounded-md border px-3 text-sm"
              onChange={(event) => setRole(event.target.value as 'admin' | 'super')}
              value={role}
            >
              <option value="admin">admin</option>
              <option value="super">super</option>
            </select>
            <Button disabled={isLoading} type="submit">
              创建
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>管理员列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  {['邮箱', '名称', '角色', '状态', '最后登录', '创建时间', '操作'].map(
                    (header) => (
                      <th className="px-3 py-2 font-medium" key={header}>
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr className="border-b align-top" key={admin.id}>
                    <td className="px-3 py-3">{admin.email}</td>
                    <td className="px-3 py-3">{admin.name}</td>
                    <td className="px-3 py-3">{admin.role}</td>
                    <td className="px-3 py-3">{admin.is_active ? '启用' : '禁用'}</td>
                    <td className="px-3 py-3">{formatDateTime(admin.last_login_at)}</td>
                    <td className="px-3 py-3">{formatDateTime(admin.created_at)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="h-8 px-3"
                          onClick={() => void updateAdmin(admin)}
                          type="button"
                          variant="secondary"
                        >
                          编辑
                        </Button>
                        <Button
                          className="h-8 px-3"
                          onClick={() => void toggleAdmin(admin)}
                          type="button"
                          variant="secondary"
                        >
                          {admin.is_active ? '禁用' : '启用'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!admins.length ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>
                      暂无管理员
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
