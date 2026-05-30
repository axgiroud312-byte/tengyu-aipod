'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/relative-time'
import { use, useCallback, useEffect, useMemo, useState } from 'react'

type CodeStatus = 'activated' | 'not_activated' | 'banned' | 'expired'

interface CustomerCodeItem {
  code: string
  days_total: number
  max_devices: number
  used_devices: number
  remaining_days: number | null
  batch_id: string | null
  is_active: boolean
  activated_at: string | null
  expires_at: string | null
  created_at: string
  status: CodeStatus
}

interface CustomerDeviceItem {
  id: string
  code: string
  device_fingerprint: string
  device_name: string | null
  activated_at: string
  last_active_at: string
}

interface CustomerDetail {
  id: string
  name: string
  phone: string
  email: string | null
  wechat: string | null
  notes: string | null
  is_active: boolean
  status: 'active' | 'banned'
  code_count: number
  total_devices: number
  total_device_slots: number
  recent_active_at: string | null
  created_at: string
  codes: CustomerCodeItem[]
  devices: CustomerDeviceItem[]
}

interface CustomerResponse {
  ok: true
  data: {
    customer: CustomerDetail
  }
}

const statusLabels: Record<CodeStatus, string> = {
  activated: '已激活',
  not_activated: '未激活',
  banned: '已封号',
  expired: '已过期',
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

function formatDate(value: string | null) {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleDateString('zh-CN')
}

function customerCodeUrl(customer: CustomerDetail) {
  const params = new URLSearchParams({
    name: customer.name,
    phone: customer.phone,
  })
  if (customer.email) {
    params.set('email', customer.email)
  }
  if (customer.wechat) {
    params.set('wechat', customer.wechat)
  }
  if (customer.notes) {
    params.set('notes', customer.notes)
  }
  return `/admin/codes/new?${params.toString()}`
}

export default function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = use(params)
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const newCodeUrl = useMemo(
    () => (customer ? customerCodeUrl(customer) : '/admin/codes/new'),
    [customer],
  )

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
    const wechat = window.prompt('微信', customer.wechat ?? '') ?? ''
    const notes = window.prompt('备注', customer.notes ?? '') ?? ''

    const ok = await submitJson(`/admin/api/customers/${customerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, phone, wechat, notes }),
    })
    if (ok) {
      setMessage('客户信息已更新')
      await loadCustomer(customerId)
    }
  }

  async function banCustomer() {
    if (!window.confirm('确认封号该客户？该客户所有激活码也会被封号。')) {
      return
    }

    const ok = await submitJson(`/admin/api/customers/${customerId}/ban`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (ok) {
      setMessage('客户已封号，名下激活码已同步封号')
      await loadCustomer(customerId)
    }
  }

  async function updateCode(code: string, payload: Record<string, unknown>) {
    const ok = await submitJson(`/admin/api/codes/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    if (ok) {
      setMessage('激活码已更新')
      await loadCustomer(customerId)
    }
  }

  async function unbindDevice(code: string, deviceId: string) {
    const ok = await submitJson(`/admin/api/codes/${code}/unbind-device`, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
    })
    if (ok) {
      setMessage('设备已解绑')
      await loadCustomer(customerId)
    }
  }

  if (isLoading && !customer) {
    return (
      <AdminShell description="读取客户设备和激活码明细。" title="客户详情">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </AdminShell>
    )
  }

  if (!customer) {
    return (
      <AdminShell description="读取客户设备和激活码明细。" title="客户详情">
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
    <AdminShell
      description={`${customer.total_devices}/${customer.total_device_slots} 台设备，最近活跃 ${formatRelativeTime(customer.recent_active_at)}`}
      title={`客户详情：${customer.name}`}
    >
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">客户、激活码和设备明细</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <a href="/admin/customers">返回列表</a>
          </Button>
          <Button asChild>
            <a href={newCodeUrl}>+ 给该客户发新激活码</a>
          </Button>
        </div>
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
                <div className="text-muted-foreground">微信</div>
                <div>{customer.wechat ?? '-'}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-muted-foreground">备注</div>
                <div>{customer.notes ?? '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">状态 / 创建时间</div>
                <div>
                  {customer.is_active ? '激活' : '已封号'} / {formatDate(customer.created_at)}
                </div>
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

        <Card>
          <CardHeader>
            <CardTitle>激活码（{customer.codes.length} 个）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b">
                    {['码', '天数', '设备', '已激活', '剩余', '状态', '操作'].map((header) => (
                      <th className="px-3 py-2 font-medium" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customer.codes.map((code) => (
                    <tr className="border-b align-top" key={code.code}>
                      <td className="px-3 py-3 font-mono">{code.code}</td>
                      <td className="px-3 py-3">{code.days_total}</td>
                      <td className="px-3 py-3">{code.max_devices}</td>
                      <td className="px-3 py-3">
                        {code.used_devices}/{code.max_devices}
                      </td>
                      <td className="px-3 py-3">{remainingLabel(code.remaining_days)}</td>
                      <td className="px-3 py-3">{statusLabels[code.status]}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            onClick={() => void updateCode(code.code, { add_days: 30 })}
                            type="button"
                            variant="secondary"
                          >
                            +30天
                          </Button>
                          <Button
                            onClick={() => {
                              const maxDevices = Number(
                                window.prompt('设备数', String(code.max_devices)),
                              )
                              if (Number.isFinite(maxDevices) && maxDevices > 0) {
                                void updateCode(code.code, { max_devices: maxDevices })
                              }
                            }}
                            type="button"
                            variant="secondary"
                          >
                            改设备数
                          </Button>
                          <Button
                            onClick={() => void updateCode(code.code, { is_active: false })}
                            type="button"
                            variant="secondary"
                          >
                            封号
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!customer.codes.length ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>
                        暂无激活码
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>所有设备（{customer.devices.length} 台）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b">
                    {['码', '设备名', '指纹', '激活时间', '最近活跃', '操作'].map((header) => (
                      <th className="px-3 py-2 font-medium" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customer.devices.map((device) => (
                    <tr className="border-b align-top" key={device.id}>
                      <td className="px-3 py-3 font-mono">{device.code}</td>
                      <td className="px-3 py-3">{device.device_name ?? '-'}</td>
                      <td className="px-3 py-3 font-mono">{device.device_fingerprint}</td>
                      <td className="px-3 py-3">{formatDate(device.activated_at)}</td>
                      <td className="px-3 py-3">{formatRelativeTime(device.last_active_at)}</td>
                      <td className="px-3 py-3">
                        <Button
                          onClick={() => void unbindDevice(device.code, device.id)}
                          type="button"
                          variant="secondary"
                        >
                          解绑
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!customer.devices.length ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>
                        暂无设备
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
