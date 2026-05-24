'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PlatformRuleCategory, PlatformRuleItem } from '@/lib/platform-rules'
import { useCallback, useEffect, useMemo, useState } from 'react'

type CategoryFilter = 'all' | PlatformRuleCategory

type PlatformRuleListResponse = {
  ok: true
  data: { items: PlatformRuleItem[] }
}

type PlatformRuleDetailResponse = {
  ok: true
  data: PlatformRuleItem
}

type PlatformRuleFormState = {
  key: string
  name: string
  category: PlatformRuleCategory
  rules_json: string
  enabled: boolean
  version: string
}

const platformRuleCategories: PlatformRuleCategory[] = ['collection', 'listing']

const collectionTemplate = {
  allowed_domains: ['temu.com', '*.temu.com'],
  entry_url: 'https://www.temu.com',
  goods_url_patterns: ['/goods\\.html/', '/product/'],
  login_check: {
    indicators: ['Sign in', '登录'],
    inverse: ['Account', 'Orders'],
  },
  original_image_resolver: {
    type: 'src_replace',
    config: { from: '_thumbnail', to: '' },
  },
}

const listingTemplate = {
  allowed_domains: ['seller.temu.com', '*.seller.temu.com'],
  entry_url: 'https://seller.temu.com',
  login_check: {
    indicators: ['Sign in', '登录'],
    inverse: ['Seller Center', '店铺'],
  },
  form_selectors: {
    title: 'input[name="title"]',
    description: 'textarea[name="description"]',
    price: 'input[name="price"]',
    images: 'input[type="file"]',
  },
  submit_selectors: {
    save_draft: 'button[data-action="save-draft"]',
    publish: 'button[data-action="publish"]',
  },
}

const emptyForm: PlatformRuleFormState = {
  key: '',
  name: '',
  category: 'collection',
  rules_json: jsonText(collectionTemplate),
  enabled: true,
  version: '20260524-01',
}

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function formFromRule(rule: PlatformRuleItem): PlatformRuleFormState {
  return {
    key: rule.key,
    name: rule.name,
    category: rule.category as PlatformRuleCategory,
    rules_json: jsonText(rule.rules_json),
    enabled: rule.enabled,
    version: rule.version,
  }
}

function payloadFromForm(form: PlatformRuleFormState) {
  return {
    key: form.key.trim(),
    name: form.name.trim(),
    category: form.category,
    rules_json: form.rules_json,
    enabled: form.enabled,
    version: form.version.trim(),
  }
}

function copyKey(key: string) {
  return `${key}-copy`
}

export default function AdminPlatformRulesPage() {
  const [rules, setRules] = useState<PlatformRuleItem[]>([])
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [form, setForm] = useState<PlatformRuleFormState>(emptyForm)
  const [mode, setMode] = useState<'new' | 'edit'>('new')
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (categoryFilter !== 'all') {
      params.set('category', categoryFilter)
    }
    return params.toString()
  }, [categoryFilter])

  const loadRules = useCallback(async () => {
    setIsLoading(true)
    const response = await fetch(`/admin/api/platform-rules${query ? `?${query}` : ''}`)
    const result = (await response.json()) as PlatformRuleListResponse | { ok: false }
    setIsLoading(false)
    if (result.ok) {
      setRules(result.data.items)
    }
  }, [query])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  async function loadRule(key: string) {
    const response = await fetch(`/admin/api/platform-rules/${key}`)
    const result = (await response.json()) as PlatformRuleDetailResponse | { ok: false }
    if (!result.ok) {
      setMessage('平台规则不存在')
      return
    }
    setForm(formFromRule(result.data))
    setMode('edit')
  }

  async function submitJson(url: string, init: RequestInit) {
    const response = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json' },
    })
    const result = (await response.json()) as { ok: boolean; error?: { message: string } }
    if (!result.ok) {
      setMessage(result.error?.message ?? '操作失败')
      return false
    }
    return true
  }

  async function createRule() {
    const ok = await submitJson('/admin/api/platform-rules', {
      method: 'POST',
      body: JSON.stringify(payloadFromForm(form)),
    })
    if (ok) {
      setMessage('平台规则已创建')
      await loadRules()
      await loadRule(form.key.trim())
    }
  }

  async function saveRule() {
    const ok = await submitJson(`/admin/api/platform-rules/${form.key}`, {
      method: 'PATCH',
      body: JSON.stringify(payloadFromForm(form)),
    })
    if (ok) {
      setMessage('平台规则已保存')
      await loadRules()
      await loadRule(form.key)
    }
  }

  async function setRuleEnabled(rule: PlatformRuleItem, enabled: boolean) {
    const ok = await submitJson(`/admin/api/platform-rules/${rule.key}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...formFromRule(rule),
        enabled,
      }),
    })
    if (ok) {
      setMessage(enabled ? '平台规则已启用' : '平台规则已禁用')
      await loadRules()
    }
  }

  function resetForm(category: PlatformRuleCategory = 'collection') {
    setMode('new')
    setMessage(null)
    setForm({
      ...emptyForm,
      category,
      rules_json: jsonText(category === 'collection' ? collectionTemplate : listingTemplate),
    })
  }

  function applyTemplate(category: PlatformRuleCategory) {
    setForm((current) => ({
      ...current,
      category,
      rules_json: jsonText(category === 'collection' ? collectionTemplate : listingTemplate),
    }))
  }

  function copyRule(rule: PlatformRuleItem) {
    setMode('new')
    setMessage(null)
    setForm({
      ...formFromRule(rule),
      key: copyKey(rule.key),
      name: `${rule.name} Copy`,
      enabled: false,
    })
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">平台规则管理</h1>
            <p className="text-sm text-muted-foreground">共 {rules.length} 条平台规则</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => resetForm('collection')} type="button">
              + 新建采集规则
            </Button>
            <Button onClick={() => resetForm('listing')} type="button" variant="secondary">
              + 新建上架规则
            </Button>
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>规则列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <select
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
                value={categoryFilter}
              >
                <option value="all">全部类别</option>
                {platformRuleCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <Button
                disabled={isLoading}
                onClick={() => void loadRules()}
                type="button"
                variant="secondary"
              >
                {isLoading ? '加载中...' : '刷新'}
              </Button>
            </div>
            {message ? <p className="mb-4 text-sm text-muted-foreground">{message}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b">
                    {['Key', '名称', '类别', '版本', '启用', '操作'].map((header) => (
                      <th className="px-3 py-2 font-medium" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr className="border-b align-top" key={rule.key}>
                      <td className="px-3 py-3 font-mono">{rule.key}</td>
                      <td className="px-3 py-3">{rule.name}</td>
                      <td className="px-3 py-3">{rule.category}</td>
                      <td className="px-3 py-3">{rule.version}</td>
                      <td className="px-3 py-3">{rule.enabled ? '启用' : '禁用'}</td>
                      <td className="flex flex-wrap gap-2 px-3 py-3">
                        <Button
                          onClick={() => void loadRule(rule.key)}
                          type="button"
                          variant="secondary"
                        >
                          编辑
                        </Button>
                        <Button onClick={() => copyRule(rule)} type="button" variant="secondary">
                          复制
                        </Button>
                        <Button
                          onClick={() => void setRuleEnabled(rule, !rule.enabled)}
                          type="button"
                          variant="secondary"
                        >
                          {rule.enabled ? '禁用' : '启用'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!rules.length ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>
                        暂无平台规则
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
            <CardTitle>{mode === 'new' ? '新建平台规则' : `编辑 ${form.key}`}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => event.preventDefault()}
            >
              <label className="space-y-1 text-sm">
                <span>Key</span>
                <input
                  className="h-10 w-full rounded-md border px-3 font-mono"
                  disabled={mode === 'edit'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, key: event.target.value }))
                  }
                  value={form.key}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>名称</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  value={form.name}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>类别</span>
                <select
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category: event.target.value as PlatformRuleCategory,
                    }))
                  }
                  value={form.category}
                >
                  {platformRuleCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>版本</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, version: event.target.value }))
                  }
                  value={form.version}
                />
              </label>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, enabled: event.target.checked }))
                  }
                  type="checkbox"
                />
                启用
              </label>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button
                  onClick={() => applyTemplate('collection')}
                  type="button"
                  variant="secondary"
                >
                  使用采集模板
                </Button>
                <Button onClick={() => applyTemplate('listing')} type="button" variant="secondary">
                  使用上架模板
                </Button>
              </div>
              <JsonEditor
                label="rules_json"
                onChange={(value) => setForm((current) => ({ ...current, rules_json: value }))}
                value={form.rules_json}
              />
              <div className="flex flex-wrap gap-2 md:col-span-2">
                {mode === 'new' ? (
                  <Button onClick={() => void createRule()} type="button">
                    创建平台规则
                  </Button>
                ) : (
                  <Button onClick={() => void saveRule()} type="button">
                    保存平台规则
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function JsonEditor({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-sm md:col-span-2">
      <span>{label}</span>
      <textarea
        className="min-h-80 w-full rounded-md border p-3 font-mono text-sm"
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={value}
      />
    </label>
  )
}
