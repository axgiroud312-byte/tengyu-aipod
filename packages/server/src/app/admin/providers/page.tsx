'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AdminProviderItem, ProviderType } from '@/lib/providers'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ProviderTypeFilter = 'all' | ProviderType

type ProviderListResponse = {
  ok: true
  data: { items: AdminProviderItem[] }
}

type ProviderDetailResponse = {
  ok: true
  data: AdminProviderItem
}

type ProviderFormState = {
  id: string
  name: string
  type: ProviderType
  base_url: string
  fallback_url: string
  api_style: string
  endpoints_json: string
  model_options_json: string
  default_params_json: string
  capabilities: string[]
  enabled: boolean
  sort_order: string
  notes: string
}

const providerTypes: ProviderType[] = ['paid-generation', 'vision-llm', 'comfyui-cloud']
const apiStyles = ['grsai-native', 'openai-images', 'openai-chat', 'dashscope-native']
const capabilities = ['txt2img', 'img2img', 'extract', 'matting']

const grsaiDefaults = {
  endpoints: { generate: '/v1/api/generate', result: '/v1/api/result' },
  models: ['nano-banana-2'],
  params: { replyType: 'json' },
}

const defaultJsonByApiStyle: Record<
  string,
  { endpoints: unknown; models: string[]; params: unknown }
> = {
  'grsai-native': {
    ...grsaiDefaults,
  },
  'openai-images': {
    endpoints: { generate: '/v1/images/generations' },
    models: ['gpt-image-2'],
    params: { size: '1024x1024' },
  },
  'openai-chat': {
    endpoints: { chat: '/compatible-mode/v1/chat/completions' },
    models: ['qwen3-vl-plus'],
    params: { temperature: 0.2 },
  },
  'dashscope-native': {
    endpoints: { chat: '/api/v1/services/aigc/multimodal-generation/generation' },
    models: ['qwen3-vl-plus'],
    params: {},
  },
}

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2)
}

const emptyForm: ProviderFormState = {
  id: '',
  name: '',
  type: 'paid-generation',
  base_url: '',
  fallback_url: '',
  api_style: 'grsai-native',
  endpoints_json: jsonText(grsaiDefaults.endpoints),
  model_options_json: jsonText(grsaiDefaults.models),
  default_params_json: jsonText(grsaiDefaults.params),
  capabilities: ['txt2img', 'img2img', 'extract'],
  enabled: true,
  sort_order: '0',
  notes: '',
}

function formFromProvider(provider: AdminProviderItem): ProviderFormState {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type as ProviderType,
    base_url: provider.base_url,
    fallback_url: provider.fallback_url ?? '',
    api_style: provider.api_style,
    endpoints_json: provider.endpoints_json,
    model_options_json: provider.model_options_json,
    default_params_json: provider.default_params_json,
    capabilities: provider.capabilities,
    enabled: provider.enabled,
    sort_order: String(provider.sort_order),
    notes: provider.notes ?? '',
  }
}

function nullable(value: string) {
  return value.trim() || null
}

function payloadFromForm(form: ProviderFormState) {
  const sortOrder = Number(form.sort_order)
  return {
    id: form.id.trim(),
    name: form.name.trim(),
    type: form.type,
    base_url: form.base_url.trim(),
    fallback_url: nullable(form.fallback_url),
    api_style: form.api_style.trim(),
    endpoints_json: form.endpoints_json,
    model_options_json: form.model_options_json,
    default_params_json: form.default_params_json,
    capabilities: form.capabilities,
    enabled: form.enabled,
    sort_order: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : 0,
    notes: nullable(form.notes),
  }
}

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<AdminProviderItem[]>([])
  const [typeFilter, setTypeFilter] = useState<ProviderTypeFilter>('all')
  const [form, setForm] = useState<ProviderFormState>(emptyForm)
  const [mode, setMode] = useState<'new' | 'edit'>('new')
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (typeFilter !== 'all') {
      params.set('type', typeFilter)
    }
    return params.toString()
  }, [typeFilter])

  const loadProviders = useCallback(async () => {
    setIsLoading(true)
    const response = await fetch(`/admin/api/providers${query ? `?${query}` : ''}`)
    const result = (await response.json()) as ProviderListResponse | { ok: false }
    setIsLoading(false)
    if (!result.ok) {
      return
    }
    setProviders(result.data.items)
  }, [query])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  async function loadProvider(id: string) {
    const response = await fetch(`/admin/api/providers/${id}`)
    const result = (await response.json()) as ProviderDetailResponse | { ok: false }
    if (!result.ok) {
      setMessage('Provider 不存在')
      return
    }
    setForm(formFromProvider(result.data))
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

  async function createProvider() {
    const ok = await submitJson('/admin/api/providers', {
      method: 'POST',
      body: JSON.stringify(payloadFromForm(form)),
    })
    if (ok) {
      setMessage('Provider 已创建')
      await loadProviders()
      await loadProvider(form.id.trim())
    }
  }

  async function saveProvider() {
    const ok = await submitJson(`/admin/api/providers/${form.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payloadFromForm(form)),
    })
    if (ok) {
      setMessage('Provider 已保存')
      await loadProviders()
      await loadProvider(form.id)
    }
  }

  function resetForm() {
    setMode('new')
    setMessage(null)
    setForm(emptyForm)
  }

  function applyApiStyleDefaults(apiStyle: string) {
    const defaults = defaultJsonByApiStyle[apiStyle] ?? grsaiDefaults
    setForm((current) => ({
      ...current,
      api_style: apiStyle,
      endpoints_json: jsonText(defaults.endpoints),
      model_options_json: jsonText(defaults.models),
      default_params_json: jsonText(defaults.params),
    }))
  }

  function toggleCapability(capability: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      capabilities: checked
        ? Array.from(new Set([...current.capabilities, capability]))
        : current.capabilities.filter((item) => item !== capability),
    }))
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Provider 管理</h1>
            <p className="text-sm text-muted-foreground">共 {providers.length} 个 Provider</p>
          </div>
          <Button onClick={resetForm} type="button">
            + 新建 Provider
          </Button>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Provider 列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <select
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setTypeFilter(event.target.value as ProviderTypeFilter)}
                value={typeFilter}
              >
                <option value="all">全部类型</option>
                {providerTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <Button
                disabled={isLoading}
                onClick={() => void loadProviders()}
                type="button"
                variant="secondary"
              >
                {isLoading ? '加载中...' : '刷新'}
              </Button>
            </div>
            {message ? <p className="mb-4 text-sm text-muted-foreground">{message}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b">
                    {['ID', '名称', '类型', 'API Style', 'Base URL', '启用', '排序', '操作'].map(
                      (header) => (
                        <th className="px-3 py-2 font-medium" key={header}>
                          {header}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {providers.map((provider) => (
                    <tr className="border-b align-top" key={provider.id}>
                      <td className="px-3 py-3 font-mono">{provider.id}</td>
                      <td className="px-3 py-3">{provider.name}</td>
                      <td className="px-3 py-3">{provider.type}</td>
                      <td className="px-3 py-3">{provider.api_style}</td>
                      <td className="max-w-64 truncate px-3 py-3">{provider.base_url}</td>
                      <td className="px-3 py-3">{provider.enabled ? '启用' : '禁用'}</td>
                      <td className="px-3 py-3 tabular-nums">{provider.sort_order}</td>
                      <td className="flex flex-wrap gap-2 px-3 py-3">
                        <Button
                          onClick={() => void loadProvider(provider.id)}
                          type="button"
                          variant="secondary"
                        >
                          编辑
                        </Button>
                        <Button
                          onClick={() => {
                            setForm(formFromProvider({ ...provider, enabled: false }))
                            setMode('edit')
                          }}
                          type="button"
                          variant="secondary"
                        >
                          禁用
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!providers.length ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={8}>
                        暂无 Provider
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
            <CardTitle>{mode === 'new' ? '新建 Provider' : `编辑 ${form.id}`}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => event.preventDefault()}
            >
              <label className="space-y-1 text-sm">
                <span>ID</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  disabled={mode === 'edit'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, id: event.target.value }))
                  }
                  value={form.id}
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
                <span>类型</span>
                <select
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, type: event.target.value as ProviderType }))
                  }
                  value={form.type}
                >
                  {providerTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>API Style</span>
                <select
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) => applyApiStyleDefaults(event.target.value)}
                  value={form.api_style}
                >
                  {apiStyles.map((style) => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Base URL</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, base_url: event.target.value }))
                  }
                  value={form.base_url}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Fallback URL</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fallback_url: event.target.value }))
                  }
                  value={form.fallback_url}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>排序</span>
                <input
                  className="h-10 w-full rounded-md border px-3 tabular-nums"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sort_order: event.target.value }))
                  }
                  type="number"
                  value={form.sort_order}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>备注</span>
                <input
                  className="h-10 w-full rounded-md border px-3"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  value={form.notes}
                />
              </label>
              <fieldset className="space-y-2 rounded-md border p-3 md:col-span-2">
                <legend className="px-1 text-sm font-medium">Capabilities</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {capabilities.map((capability) => (
                    <label className="inline-flex items-center gap-2" key={capability}>
                      <input
                        checked={form.capabilities.includes(capability)}
                        onChange={(event) => toggleCapability(capability, event.target.checked)}
                        type="checkbox"
                      />
                      {capability}
                    </label>
                  ))}
                </div>
              </fieldset>
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
              <JsonEditor
                label="端点 JSON"
                onChange={(value) => setForm((current) => ({ ...current, endpoints_json: value }))}
                value={form.endpoints_json}
              />
              <JsonEditor
                label="模型选项 JSON"
                onChange={(value) =>
                  setForm((current) => ({ ...current, model_options_json: value }))
                }
                value={form.model_options_json}
              />
              <JsonEditor
                label="默认参数 JSON"
                onChange={(value) =>
                  setForm((current) => ({ ...current, default_params_json: value }))
                }
                value={form.default_params_json}
              />
              <div className="flex flex-wrap gap-2 md:col-span-2">
                {mode === 'new' ? (
                  <Button onClick={() => void createProvider()} type="button">
                    创建 Provider
                  </Button>
                ) : (
                  <Button onClick={() => void saveProvider()} type="button">
                    保存 Provider
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
        className="min-h-36 w-full rounded-md border p-3 font-mono text-sm"
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={value}
      />
    </label>
  )
}
