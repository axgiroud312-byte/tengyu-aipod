'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  ComfyuiWorkflowContentItem,
  ComfyuiWorkflowSummaryItem,
} from '@/lib/comfyui-workflows'
import { useCallback, useEffect, useMemo, useState } from 'react'

type WorkflowCategory = 'txt2img' | 'img2img' | 'extract' | 'matting' | 'matting-mixed'
type CategoryFilter = 'all' | WorkflowCategory

type WorkflowListResponse = {
  ok: true
  data: { items: ComfyuiWorkflowSummaryItem[] }
}

type WorkflowDetailResponse = {
  ok: true
  data: ComfyuiWorkflowContentItem
}

type WorkflowVersionsResponse = {
  ok: true
  data: { items: ComfyuiWorkflowSummaryItem[] }
}

type WorkflowFormState = {
  id: string
  category: WorkflowCategory
  version: string
  workflow_json: string
  input_slots_json: string
  output_slots_json: string
  required_models_text: string
  recommended_pod_keywords_text: string
  min_vram_gb: string
  enabled: boolean
  notes: string
}

const workflowCategories: WorkflowCategory[] = [
  'txt2img',
  'img2img',
  'extract',
  'matting',
  'matting-mixed',
]

const emptyForm: WorkflowFormState = {
  id: '',
  category: 'extract',
  version: '1.0.0',
  workflow_json: '{}',
  input_slots_json: '[]',
  output_slots_json: '[]',
  required_models_text: '',
  recommended_pod_keywords_text: 'ComfyUI Default',
  min_vram_gb: '8',
  enabled: true,
  notes: '',
}

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function commaList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formFromWorkflow(workflow: ComfyuiWorkflowContentItem): WorkflowFormState {
  return {
    id: workflow.id,
    category: workflow.category as WorkflowCategory,
    version: workflow.version,
    workflow_json: jsonText(workflow.workflow_json),
    input_slots_json: jsonText(workflow.input_slots),
    output_slots_json: jsonText(workflow.output_slots),
    required_models_text: workflow.required_models.join(', '),
    recommended_pod_keywords_text: workflow.recommended_pod_keywords.join(', '),
    min_vram_gb: String(workflow.min_vram_gb),
    enabled: workflow.enabled,
    notes: workflow.notes ?? '',
  }
}

function payloadFromForm(form: WorkflowFormState) {
  const minVramGb = Number(form.min_vram_gb)
  return {
    id: form.id.trim(),
    category: form.category,
    version: form.version.trim(),
    workflow_json: form.workflow_json,
    input_slots_json: form.input_slots_json,
    output_slots_json: form.output_slots_json,
    required_models: commaList(form.required_models_text),
    recommended_pod_keywords: commaList(form.recommended_pod_keywords_text),
    min_vram_gb: Number.isFinite(minVramGb) ? Math.max(1, Math.floor(minVramGb)) : 8,
    enabled: form.enabled,
    notes: form.notes.trim() || null,
  }
}

function nodeEntries(workflow: unknown) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return []
  }
  return Object.entries(workflow as Record<string, unknown>)
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function classTypeOf(node: unknown) {
  const record = recordValue(node)
  return typeof record.class_type === 'string' ? record.class_type : ''
}

function detectSlots(workflow: unknown) {
  const inputSlots = []
  const outputSlots = []

  for (const [nodeId, node] of nodeEntries(workflow)) {
    const classType = classTypeOf(node)
    if (/loadimage/i.test(classType)) {
      inputSlots.push({
        name: `image_${inputSlots.length + 1}`,
        label: `Image ${inputSlots.length + 1}`,
        node_id: nodeId,
        field: 'image',
        image_index: inputSlots.length,
      })
    }
    if (/saveimage|previewimage/i.test(classType)) {
      outputSlots.push({
        name: `output_${outputSlots.length + 1}`,
        label: `Output ${outputSlots.length + 1}`,
        node_id: nodeId,
        field: 'images',
      })
    }
  }

  return { inputSlots, outputSlots }
}

function downloadJson(filename: string, value: string) {
  const blob = new Blob([value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function AdminComfyuiWorkflowsPage() {
  const [workflows, setWorkflows] = useState<ComfyuiWorkflowSummaryItem[]>([])
  const [versions, setVersions] = useState<ComfyuiWorkflowSummaryItem[]>([])
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [form, setForm] = useState<WorkflowFormState>(emptyForm)
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

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true)
    const response = await fetch(`/admin/api/comfyui-workflows${query ? `?${query}` : ''}`)
    const result = (await response.json()) as WorkflowListResponse | { ok: false }
    setIsLoading(false)
    if (result.ok) {
      setWorkflows(result.data.items)
    }
  }, [query])

  useEffect(() => {
    void loadWorkflows()
  }, [loadWorkflows])

  async function loadWorkflow(id: string, version?: string) {
    const params = new URLSearchParams()
    if (version) {
      params.set('version', version)
    }
    const response = await fetch(
      `/admin/api/comfyui-workflows/${id}${params.toString() ? `?${params}` : ''}`,
    )
    const result = (await response.json()) as WorkflowDetailResponse | { ok: false }
    if (!result.ok) {
      setMessage('ComfyUI 工作流不存在')
      return
    }
    setForm(formFromWorkflow(result.data))
    setMode('edit')
    await loadVersions(id)
  }

  async function loadVersions(id: string) {
    const response = await fetch(`/admin/api/comfyui-workflows/${id}/versions`)
    const result = (await response.json()) as WorkflowVersionsResponse | { ok: false }
    setVersions(result.ok ? result.data.items : [])
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

  async function createWorkflow() {
    const ok = await submitJson('/admin/api/comfyui-workflows', {
      method: 'POST',
      body: JSON.stringify(payloadFromForm(form)),
    })
    if (ok) {
      setMessage('ComfyUI 工作流已创建')
      await loadWorkflows()
      await loadWorkflow(form.id.trim(), form.version.trim())
    }
  }

  async function saveWorkflow(saveMode: 'overwrite' | 'new_version') {
    const ok = await submitJson(`/admin/api/comfyui-workflows/${form.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payloadFromForm(form), save_mode: saveMode }),
    })
    if (ok) {
      setMessage(saveMode === 'new_version' ? '新版本已保存' : '当前版本已覆盖')
      await loadWorkflows()
      await loadWorkflow(form.id)
    }
  }

  async function disableWorkflow(workflow: ComfyuiWorkflowSummaryItem) {
    const response = await fetch(
      `/admin/api/comfyui-workflows/${workflow.id}?version=${encodeURIComponent(workflow.version)}`,
    )
    const result = (await response.json()) as WorkflowDetailResponse | { ok: false }
    if (!result.ok) {
      setMessage('禁用失败')
      return
    }
    const ok = await submitJson(`/admin/api/comfyui-workflows/${workflow.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...payloadFromForm({ ...formFromWorkflow(result.data), enabled: false }),
        save_mode: 'overwrite',
      }),
    })
    if (ok) {
      setMessage('工作流已禁用')
      await loadWorkflows()
      await loadVersions(workflow.id)
    }
  }

  async function loadAndDownload(workflow: ComfyuiWorkflowSummaryItem) {
    const response = await fetch(
      `/admin/api/comfyui-workflows/${workflow.id}?version=${encodeURIComponent(workflow.version)}`,
    )
    const result = (await response.json()) as WorkflowDetailResponse | { ok: false }
    if (!result.ok) {
      setMessage('下载失败')
      return
    }
    downloadJson(`${workflow.id}-${workflow.version}.json`, jsonText(result.data.workflow_json))
  }

  async function handleWorkflowFile(file: File | null) {
    if (!file) {
      return
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      const detected = detectSlots(parsed)
      setForm((current) => ({
        ...current,
        workflow_json: jsonText(parsed),
        input_slots_json: jsonText(detected.inputSlots),
        output_slots_json: jsonText(detected.outputSlots),
      }))
      setMessage(
        `已解析 ${detected.inputSlots.length} 个输入节点、${detected.outputSlots.length} 个输出节点`,
      )
    } catch {
      setMessage('workflow.json 解析失败')
    }
  }

  function resetForm() {
    setMode('new')
    setVersions([])
    setMessage(null)
    setForm(emptyForm)
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">ComfyUI 工作流管理</h1>
            <p className="text-sm text-muted-foreground">共 {workflows.length} 个当前版本</p>
          </div>
          <Button onClick={resetForm} type="button">
            + 上传新工作流
          </Button>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>工作流列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <select
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
                value={categoryFilter}
              >
                <option value="all">全部分类</option>
                {workflowCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <Button
                disabled={isLoading}
                onClick={() => void loadWorkflows()}
                type="button"
                variant="secondary"
              >
                {isLoading ? '加载中...' : '刷新'}
              </Button>
            </div>
            {message ? <p className="mb-4 text-sm text-muted-foreground">{message}</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b">
                    {['ID', '分类', '版本', '推荐 Pod 关键词', '最小显存', '启用', '操作'].map(
                      (header) => (
                        <th className="px-3 py-2 font-medium" key={header}>
                          {header}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {workflows.map((workflow) => (
                    <tr className="border-b align-top" key={`${workflow.id}:${workflow.version}`}>
                      <td className="px-3 py-3 font-mono">{workflow.id}</td>
                      <td className="px-3 py-3">{workflow.category}</td>
                      <td className="px-3 py-3">{workflow.version}</td>
                      <td className="px-3 py-3">
                        {workflow.recommended_pod_keywords.join(', ') || '-'}
                      </td>
                      <td className="px-3 py-3 tabular-nums">{workflow.min_vram_gb}GB</td>
                      <td className="px-3 py-3">{workflow.enabled ? '启用' : '禁用'}</td>
                      <td className="flex flex-wrap gap-2 px-3 py-3">
                        <Button
                          onClick={() => void loadWorkflow(workflow.id, workflow.version)}
                          type="button"
                          variant="secondary"
                        >
                          编辑
                        </Button>
                        <Button
                          onClick={() => void loadAndDownload(workflow)}
                          type="button"
                          variant="secondary"
                        >
                          下载 JSON
                        </Button>
                        <Button
                          onClick={() => void disableWorkflow(workflow)}
                          type="button"
                          variant="secondary"
                        >
                          禁用
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!workflows.length ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={7}>
                        暂无 ComfyUI 工作流
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader>
              <CardTitle>{mode === 'new' ? '上传新工作流' : `编辑 ${form.id}`}</CardTitle>
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
                  <span>分类</span>
                  <select
                    className="h-10 w-full rounded-md border px-3"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        category: event.target.value as WorkflowCategory,
                      }))
                    }
                    value={form.category}
                  >
                    {workflowCategories.map((category) => (
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
                <label className="space-y-1 text-sm">
                  <span>最小显存 GB</span>
                  <input
                    className="h-10 w-full rounded-md border px-3 tabular-nums"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, min_vram_gb: event.target.value }))
                    }
                    type="number"
                    value={form.min_vram_gb}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span>推荐 Pod 关键词</span>
                  <input
                    className="h-10 w-full rounded-md border px-3"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        recommended_pod_keywords_text: event.target.value,
                      }))
                    }
                    value={form.recommended_pod_keywords_text}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span>必需模型</span>
                  <input
                    className="h-10 w-full rounded-md border px-3"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        required_models_text: event.target.value,
                      }))
                    }
                    value={form.required_models_text}
                  />
                </label>
                <label className="space-y-1 text-sm md:col-span-2">
                  <span>上传 workflow.json</span>
                  <input
                    accept="application/json,.json"
                    className="block w-full rounded-md border px-3 py-2 text-sm"
                    onChange={(event) => void handleWorkflowFile(event.target.files?.[0] ?? null)}
                    type="file"
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
                <label className="space-y-1 text-sm md:col-span-2">
                  <span>备注</span>
                  <input
                    className="h-10 w-full rounded-md border px-3"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    value={form.notes}
                  />
                </label>
                <JsonEditor
                  label="workflow JSON"
                  onChange={(value) => setForm((current) => ({ ...current, workflow_json: value }))}
                  value={form.workflow_json}
                />
                <JsonEditor
                  label="input_slots JSON"
                  onChange={(value) =>
                    setForm((current) => ({ ...current, input_slots_json: value }))
                  }
                  value={form.input_slots_json}
                />
                <JsonEditor
                  label="output_slots JSON"
                  onChange={(value) =>
                    setForm((current) => ({ ...current, output_slots_json: value }))
                  }
                  value={form.output_slots_json}
                />
                <div className="flex flex-wrap gap-2 md:col-span-2">
                  {mode === 'new' ? (
                    <Button onClick={() => void createWorkflow()} type="button">
                      创建工作流
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => void saveWorkflow('new_version')} type="button">
                        保存为新版本
                      </Button>
                      <Button
                        onClick={() => void saveWorkflow('overwrite')}
                        type="button"
                        variant="secondary"
                      >
                        覆盖当前版本
                      </Button>
                    </>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>版本历史</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {versions.map((version) => (
                  <button
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left"
                    key={`${version.id}:${version.version}`}
                    onClick={() => void loadWorkflow(version.id, version.version)}
                    type="button"
                  >
                    <span>{version.version}</span>
                    <span className="text-muted-foreground">
                      {version.enabled ? '启用' : '禁用'}
                    </span>
                  </button>
                ))}
                {!versions.length ? (
                  <p className="text-muted-foreground">请选择工作流查看历史版本</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
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
        className="min-h-40 w-full rounded-md border p-3 font-mono text-sm"
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={value}
      />
    </label>
  )
}
