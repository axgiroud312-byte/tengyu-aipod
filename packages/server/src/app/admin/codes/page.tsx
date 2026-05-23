'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useEffect, useMemo, useState } from 'react'

type CodeStatus = 'activated' | 'not_activated' | 'banned' | 'expired'

interface CodeItem {
  code: string
  customer: {
    id: string
    name: string
    phone: string
    email: string | null
    wechat: string | null
  } | null
  contact: string | null
  days_total: number
  max_devices: number
  used_devices: number
  remaining_days: number | null
  batch_id: string | null
  is_active: boolean
  expires_at: string | null
  created_at: string
  status: CodeStatus
  devices: Array<{
    id: string
    device_fingerprint: string
    device_name: string | null
    activated_at: string
    last_active_at: string
  }>
}

interface CodesResponse {
  ok: true
  data: {
    items: CodeItem[]
    pagination: {
      page: number
      page_size: number
      total: number
      total_pages: number
    }
    batches: string[]
  }
}

type Mode = 'single' | 'batch_anonymous' | 'batch_customers'

const statusLabels: Record<CodeStatus, string> = {
  activated: '已激活',
  not_activated: '未激活',
  banned: '已封号',
  expired: '已过期',
}

const filterOptions = [
  { label: '全部', value: 'all' },
  { label: '已激活', value: 'activated' },
  { label: '未激活', value: 'not_activated' },
  { label: '即将过期', value: 'expiring_soon' },
  { label: '已封号', value: 'banned' },
]

function parseCustomerCsv(csv: string) {
  return csv
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(1)
    .map((row) => {
      const [name = '', phone = '', email = '', wechat = '', notes = ''] = row
        .split(',')
        .map((cell) => cell.trim())
      return { name, phone, email, wechat, notes }
    })
    .filter((row) => row.name && row.phone)
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function AdminCodesPage() {
  const [codes, setCodes] = useState<CodeItem[]>([])
  const [batches, setBatches] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [batch, setBatch] = useState('all')
  const [sort, setSort] = useState('created_at_desc')
  const [mode, setMode] = useState<Mode>('single')
  const [message, setMessage] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<Array<{ name: string; phone: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [prefilledCustomer, setPrefilledCustomer] = useState({
    name: '',
    phone: '',
    email: '',
    wechat: '',
    notes: '',
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setPrefilledCustomer({
      name: params.get('name') ?? '',
      phone: params.get('phone') ?? '',
      email: params.get('email') ?? '',
      wechat: params.get('wechat') ?? '',
      notes: params.get('notes') ?? '',
    })
  }, [])

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: '50',
      status,
      batch,
      sort,
    })
    if (search.trim()) {
      params.set('search', search.trim())
    }
    return params
  }, [batch, page, search, sort, status])

  useEffect(() => {
    async function loadCodesForQuery() {
      setIsLoading(true)
      const response = await fetch(`/admin/api/codes?${query.toString()}`)
      const result = (await response.json()) as CodesResponse
      setIsLoading(false)
      if (!result.ok) {
        return
      }
      setCodes(result.data.items)
      setBatches(result.data.batches)
      setTotalPages(result.data.pagination.total_pages)
      setTotal(result.data.pagination.total)
    }

    void loadCodesForQuery()
  }, [query])

  async function loadCodes() {
    setIsLoading(true)
    const response = await fetch(`/admin/api/codes?${query.toString()}`)
    const result = (await response.json()) as CodesResponse
    setIsLoading(false)
    if (!result.ok) {
      return
    }
    setCodes(result.data.items)
    setBatches(result.data.batches)
    setTotalPages(result.data.pagination.total_pages)
    setTotal(result.data.pagination.total)
  }

  async function submitJson(url: string, init: RequestInit) {
    const response = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json' },
    })
    const result = (await response.json()) as {
      ok: boolean
      data?: { csv?: string }
      error?: { message: string }
    }
    if (!result.ok) {
      setMessage(result.error?.message ?? '操作失败')
      return null
    }
    return result
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const days_total = Number(form.get('days_total'))
    const max_devices = Number(form.get('max_devices'))
    let payload: unknown

    if (mode === 'single') {
      payload = {
        mode,
        days_total,
        max_devices,
        notes: form.get('notes'),
        customer: {
          name: form.get('name'),
          phone: form.get('phone'),
          email: form.get('email'),
          wechat: form.get('wechat'),
          notes: form.get('customer_notes'),
          reuse_existing: form.get('reuse_existing') === 'on',
        },
      }
    }

    if (mode === 'batch_anonymous') {
      payload = {
        mode,
        days_total,
        max_devices,
        quantity: Number(form.get('quantity')),
        batch_note: form.get('batch_note'),
      }
    }

    if (mode === 'batch_customers') {
      payload = {
        mode,
        days_total,
        max_devices,
        customers: parseCustomerCsv(String(form.get('customers_csv') ?? '')),
        batch_note: form.get('batch_note'),
      }
    }

    const result = await submitJson('/admin/api/codes', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (result?.data?.csv) {
      downloadCsv('activation-codes.csv', result.data.csv)
    }
    setMessage('激活码已生成')
    await loadCodes()
  }

  async function updateCode(code: string, payload: Record<string, unknown>) {
    const result = await submitJson(`/admin/api/codes/${code}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    if (result) {
      setMessage('操作已完成')
      await loadCodes()
    }
  }

  async function unbindDevice(code: string, deviceId: string) {
    const result = await submitJson(`/admin/api/codes/${code}/unbind-device`, {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
    })
    if (result) {
      setMessage('设备已解绑')
      await loadCodes()
    }
  }

  async function linkCustomer(code: string) {
    const name = window.prompt('客户姓名')
    const phone = window.prompt('客户手机号')
    if (!name || !phone) {
      return
    }
    const result = await submitJson(`/admin/api/codes/${code}/link-customer`, {
      method: 'POST',
      body: JSON.stringify({ customer: { name, phone } }),
    })
    if (result) {
      setMessage('客户已关联')
      await loadCodes()
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">激活码管理</h1>
            <p className="text-sm text-muted-foreground">共 {total} 个激活码</p>
          </div>
          <Button asChild>
            <a href="#new-code">+ 新建激活码</a>
          </Button>
        </section>

        <Card id="new-code">
          <CardHeader>
            <CardTitle>新建激活码</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              {[
                ['single', '单个创建'],
                ['batch_anonymous', '批量匿名'],
                ['batch_customers', '批量预绑客户'],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  onClick={() => setMode(value as Mode)}
                  type="button"
                  variant={mode === value ? 'default' : 'secondary'}
                >
                  {label}
                </Button>
              ))}
            </div>
            <form
              className="grid gap-4 md:grid-cols-4"
              key={`${prefilledCustomer.phone}:${prefilledCustomer.name}`}
              onSubmit={handleCreate}
            >
              <label className="space-y-1 text-sm">
                <span>天数</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  defaultValue={365}
                  name="days_total"
                  type="number"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>设备数</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  defaultValue={1}
                  name="max_devices"
                  type="number"
                />
              </label>
              {mode === 'single' ? (
                <>
                  <label className="space-y-1 text-sm">
                    <span>客户姓名</span>
                    <input
                      className="h-10 w-full rounded-md border px-3"
                      defaultValue={prefilledCustomer.name}
                      name="name"
                      required
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>手机号</span>
                    <input
                      className="h-10 w-full rounded-md border px-3"
                      defaultValue={prefilledCustomer.phone}
                      name="phone"
                      required
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>邮箱</span>
                    <input
                      className="h-10 w-full rounded-md border px-3"
                      defaultValue={prefilledCustomer.email}
                      name="email"
                      type="email"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>微信</span>
                    <input
                      className="h-10 w-full rounded-md border px-3"
                      defaultValue={prefilledCustomer.wechat}
                      name="wechat"
                    />
                  </label>
                  <label className="space-y-1 text-sm md:col-span-2">
                    <span>备注</span>
                    <input
                      className="h-10 w-full rounded-md border px-3"
                      defaultValue={prefilledCustomer.notes}
                      name="notes"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input defaultChecked name="reuse_existing" type="checkbox" />
                    按手机号智能匹配老客户
                  </label>
                </>
              ) : null}
              {mode === 'batch_anonymous' ? (
                <>
                  <label className="space-y-1 text-sm">
                    <span>数量</span>
                    <input
                      className="h-10 w-full rounded-md border px-3"
                      defaultValue={10}
                      name="quantity"
                      type="number"
                    />
                  </label>
                  <label className="space-y-1 text-sm md:col-span-2">
                    <span>批次备注</span>
                    <input className="h-10 w-full rounded-md border px-3" name="batch_note" />
                  </label>
                </>
              ) : null}
              {mode === 'batch_customers' ? (
                <label className="space-y-1 text-sm md:col-span-4">
                  <span>CSV：name, phone, email?, wechat?, notes?</span>
                  <textarea
                    className="min-h-32 w-full rounded-md border p-3"
                    name="customers_csv"
                    onChange={(event) => setCsvPreview(parseCustomerCsv(event.currentTarget.value))}
                    placeholder="name,phone,email,wechat,notes&#10;张三,13800138000,zhang@example.com,wx1,年费客户"
                  />
                  <span className="block text-muted-foreground">
                    预览 {csvPreview.length} 行，重复手机号会复用客户记录。
                  </span>
                </label>
              ) : null}
              <div className="md:col-span-4">
                <Button type="submit">生成激活码</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>激活码列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 md:grid-cols-5">
              <input
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => {
                  setPage(1)
                  setSearch(event.target.value)
                }}
                placeholder="搜索码 / 客户 / 手机"
                value={search}
              />
              <select
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setBatch(event.target.value)}
                value={batch}
              >
                <option value="all">全部批次</option>
                {batches.map((batchId) => (
                  <option key={batchId} value={batchId}>
                    {batchId}
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setSort(event.target.value)}
                value={sort}
              >
                <option value="created_at_desc">创建日倒序</option>
                <option value="expires_at_asc">到期日升序</option>
                <option value="expires_at_desc">到期日倒序</option>
              </select>
              <Button
                disabled={isLoading}
                onClick={() => void loadCodes()}
                type="button"
                variant="secondary"
              >
                刷新
              </Button>
            </div>
            {message ? <p className="mb-4 text-sm text-muted-foreground">{message}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b">
                    {[
                      '码',
                      '客户名',
                      '联系方式',
                      '天数',
                      '设备',
                      '已激活',
                      '剩余天',
                      '批次',
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
                  {codes.map((item) => (
                    <tr className="border-b align-top" key={item.code}>
                      <td className="px-3 py-3 font-mono">{item.code}</td>
                      <td className="px-3 py-3">{item.customer?.name ?? '(匿名)'}</td>
                      <td className="px-3 py-3">{item.contact ?? '-'}</td>
                      <td className="px-3 py-3">{item.days_total}</td>
                      <td className="px-3 py-3">{item.max_devices}</td>
                      <td className="px-3 py-3">
                        {item.used_devices}/{item.max_devices}
                      </td>
                      <td className="px-3 py-3">{item.remaining_days ?? '-'}</td>
                      <td className="px-3 py-3">{item.batch_id ?? '-'}</td>
                      <td className="px-3 py-3">{statusLabels[item.status]}</td>
                      <td className="space-y-2 px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {[30, 90, 365].map((days) => (
                            <Button
                              key={days}
                              onClick={() => void updateCode(item.code, { add_days: days })}
                              type="button"
                              variant="secondary"
                            >
                              +{days}天
                            </Button>
                          ))}
                          <Button
                            onClick={() => {
                              const days = Number(window.prompt('增加天数', '30'))
                              if (Number.isFinite(days) && days > 0) {
                                void updateCode(item.code, { add_days: days })
                              }
                            }}
                            type="button"
                            variant="secondary"
                          >
                            自定义
                          </Button>
                          <Button
                            onClick={() => {
                              const maxDevices = Number(
                                window.prompt('设备数', String(item.max_devices)),
                              )
                              if (Number.isFinite(maxDevices) && maxDevices > 0) {
                                if (maxDevices < item.used_devices) {
                                  setMessage(
                                    '设备数不能小于已激活设备数，请先在“解绑设备”中选择要解绑的设备。',
                                  )
                                  return
                                }
                                void updateCode(item.code, { max_devices: maxDevices })
                              }
                            }}
                            type="button"
                            variant="secondary"
                          >
                            改设备数
                          </Button>
                          <Button
                            onClick={() => void updateCode(item.code, { is_active: false })}
                            type="button"
                            variant="secondary"
                          >
                            封号
                          </Button>
                          {!item.customer ? (
                            <Button
                              onClick={() => void linkCustomer(item.code)}
                              type="button"
                              variant="secondary"
                            >
                              关联客户
                            </Button>
                          ) : null}
                        </div>
                        {item.devices.length ? (
                          <details>
                            <summary className="cursor-pointer text-muted-foreground">
                              解绑设备
                            </summary>
                            <div className="mt-2 space-y-1">
                              {item.devices.map((device) => (
                                <button
                                  className="block text-left text-xs underline"
                                  key={device.id}
                                  onClick={() => void unbindDevice(item.code, device.id)}
                                  type="button"
                                >
                                  {device.device_name ?? device.device_fingerprint}
                                </button>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span>
                第 {page} / {totalPages} 页，默认 50 行
              </span>
              <div className="flex gap-2">
                <Button
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                  type="button"
                  variant="secondary"
                >
                  上一页
                </Button>
                <Button
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                  variant="secondary"
                >
                  下一页
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
