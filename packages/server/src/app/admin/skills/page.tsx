'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Skill, SkillModule, SkillSummary } from '@tengyu-aipod/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'

type ModuleFilter = 'all' | SkillModule

interface SkillListResponse {
  ok: true
  data: { items: SkillSummary[] }
}

interface SkillDetailResponse {
  ok: true
  data: Skill
}

interface SkillVersionsResponse {
  ok: true
  data: { items: SkillSummary[] }
}

type SkillFormState = {
  id: string
  module: SkillModule
  category: string
  platform: string
  language: string
  version: string
  recommended_model: string
  system_prompt: string
  variables_json: string
  enabled: boolean
  notes: string
}

const defaultVariablesJson = JSON.stringify(
  [{ key: 'extraRequirement', label: '额外要求', type: 'textarea', required: false }],
  null,
  2,
)

const emptyForm: SkillFormState = {
  id: '',
  module: 'title',
  category: '',
  platform: 'generic',
  language: 'generic',
  version: '1.0.0',
  recommended_model: 'qwen3-vl-plus',
  system_prompt: '',
  variables_json: defaultVariablesJson,
  enabled: true,
  notes: '',
}

function formFromSkill(skill: Skill): SkillFormState {
  return {
    id: skill.id,
    module: skill.module,
    category: skill.category ?? '',
    platform: skill.platform ?? '',
    language: skill.language ?? '',
    version: skill.version,
    recommended_model: skill.recommendedModel ?? '',
    system_prompt: skill.systemPrompt,
    variables_json: JSON.stringify(skill.variables, null, 2),
    enabled: skill.enabled,
    notes: skill.notes ?? '',
  }
}

function nullable(value: string) {
  return value.trim() || null
}

function payloadFromForm(form: SkillFormState) {
  return {
    id: form.id.trim(),
    module: form.module,
    category: nullable(form.category),
    platform: nullable(form.platform),
    language: nullable(form.language),
    version: form.version.trim(),
    enabled: form.enabled,
    system_prompt: form.system_prompt,
    variables_json: form.variables_json,
    recommended_model: nullable(form.recommended_model),
    notes: nullable(form.notes),
  }
}

function renderMarkdownPreview(markdown: string) {
  if (!markdown.trim()) {
    return <p className="text-muted-foreground">暂无内容</p>
  }

  return markdown.split('\n').map((line, index) => {
    const trimmed = line.trim()
    const key = `${index}:${trimmed}`

    if (!trimmed) {
      return <div className="h-3" key={key} />
    }
    if (trimmed.startsWith('### ')) {
      return (
        <h4 className="font-semibold" key={key}>
          {trimmed.slice(4)}
        </h4>
      )
    }
    if (trimmed.startsWith('## ')) {
      return (
        <h3 className="text-base font-semibold" key={key}>
          {trimmed.slice(3)}
        </h3>
      )
    }
    if (trimmed.startsWith('# ')) {
      return (
        <h2 className="text-lg font-semibold" key={key}>
          {trimmed.slice(2)}
        </h2>
      )
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return (
        <p className="pl-4" key={key}>
          - {trimmed.slice(2)}
        </p>
      )
    }

    return <p key={key}>{line}</p>
  })
}

export default function AdminSkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [versions, setVersions] = useState<SkillSummary[]>([])
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all')
  const [form, setForm] = useState<SkillFormState>(emptyForm)
  const [mode, setMode] = useState<'new' | 'edit'>('new')
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (moduleFilter !== 'all') {
      params.set('module', moduleFilter)
    }
    return params.toString()
  }, [moduleFilter])

  const loadSkills = useCallback(async () => {
    setIsLoading(true)
    const response = await fetch(`/admin/api/skills${query ? `?${query}` : ''}`)
    const result = (await response.json()) as SkillListResponse | { ok: false }
    setIsLoading(false)
    if (!result.ok) {
      return
    }
    setSkills(result.data.items)
  }, [query])

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  async function loadSkill(id: string, version?: string) {
    const params = new URLSearchParams()
    if (version) {
      params.set('version', version)
    }
    const response = await fetch(`/admin/api/skills/${id}${params.toString() ? `?${params}` : ''}`)
    const result = (await response.json()) as SkillDetailResponse | { ok: false }
    if (!result.ok) {
      setMessage('Skill 不存在')
      return
    }
    setForm(formFromSkill(result.data))
    setMode('edit')
    await loadVersions(id)
  }

  async function loadVersions(id: string) {
    const response = await fetch(`/admin/api/skills/${id}/versions`)
    const result = (await response.json()) as SkillVersionsResponse | { ok: false }
    if (!result.ok) {
      setVersions([])
      return
    }
    setVersions(result.data.items)
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

  async function createSkill() {
    const ok = await submitJson('/admin/api/skills', {
      method: 'POST',
      body: JSON.stringify(payloadFromForm(form)),
    })
    if (ok) {
      setMessage('Skill 已创建')
      await loadSkills()
      await loadSkill(form.id.trim(), form.version.trim())
    }
  }

  async function saveSkill(saveMode: 'overwrite' | 'new_version') {
    const ok = await submitJson(`/admin/api/skills/${form.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payloadFromForm(form), save_mode: saveMode }),
    })
    if (ok) {
      setMessage(saveMode === 'new_version' ? '新版本已保存' : '当前版本已覆盖')
      await loadSkills()
      await loadSkill(form.id)
    }
  }

  function resetForm(module: SkillModule = 'title') {
    setMode('new')
    setVersions([])
    setMessage(null)
    setForm({
      ...emptyForm,
      module,
      category: module === 'generation' ? 'txt2img' : '',
      recommended_model: module === 'detection' ? 'qwen3-vl-flash' : 'qwen3-vl-plus',
      system_prompt:
        module === 'title' ? '请直接输出最终标题，不要任何解释、序号、引号、markdown。' : '',
    })
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Skill 管理</h1>
            <p className="text-sm text-muted-foreground">共 {skills.length} 个当前版本</p>
          </div>
          <Button onClick={() => resetForm()} type="button">
            + 新建 Skill
          </Button>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Skill 列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <select
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) => setModuleFilter(event.target.value as ModuleFilter)}
                value={moduleFilter}
              >
                <option value="all">全部模块</option>
                <option value="generation">generation</option>
                <option value="detection">detection</option>
                <option value="title">title</option>
              </select>
              <Button
                disabled={isLoading}
                onClick={() => void loadSkills()}
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
                    {[
                      'ID',
                      '模块',
                      '分类',
                      '平台/语言',
                      '当前版本',
                      '推荐模型',
                      '启用',
                      '操作',
                    ].map((header) => (
                      <th className="px-3 py-2 font-medium" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {skills.map((skill) => (
                    <tr className="border-b align-top" key={`${skill.id}:${skill.version}`}>
                      <td className="px-3 py-3 font-mono">{skill.id}</td>
                      <td className="px-3 py-3">{skill.module}</td>
                      <td className="px-3 py-3">{skill.category ?? '-'}</td>
                      <td className="px-3 py-3">
                        {skill.platform || skill.language
                          ? `${skill.platform ?? '-'} / ${skill.language ?? '-'}`
                          : '-'}
                      </td>
                      <td className="px-3 py-3">{skill.version}</td>
                      <td className="px-3 py-3">{skill.recommendedModel ?? '-'}</td>
                      <td className="px-3 py-3">{skill.enabled ? '启用' : '禁用'}</td>
                      <td className="flex flex-wrap gap-2 px-3 py-3">
                        <Button
                          onClick={() => void loadSkill(skill.id, skill.version)}
                          type="button"
                          variant="secondary"
                        >
                          编辑
                        </Button>
                        <Button
                          onClick={() => void loadVersions(skill.id)}
                          type="button"
                          variant="secondary"
                        >
                          版本历史
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!skills.length ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={8}>
                        暂无 Skill
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle>{mode === 'new' ? '新建 Skill' : `编辑 ${form.id}`}</CardTitle>
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
                  <span>模块</span>
                  <select
                    className="h-10 w-full rounded-md border px-3"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        module: event.target.value as SkillModule,
                      }))
                    }
                    value={form.module}
                  >
                    <option value="generation">generation</option>
                    <option value="detection">detection</option>
                    <option value="title">title</option>
                  </select>
                </label>
                {(
                  [
                    ['category', '分类'],
                    ['platform', '平台'],
                    ['language', '语言'],
                    ['version', '版本'],
                    ['recommended_model', '推荐模型'],
                    ['notes', '备注'],
                  ] satisfies Array<[keyof SkillFormState, string]>
                ).map(([key, label]) => (
                  <label className="space-y-1 text-sm" key={key}>
                    <span>{label}</span>
                    <input
                      className="h-10 w-full rounded-md border px-3"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [key]: event.target.value }))
                      }
                      value={form[key as keyof SkillFormState] as string}
                    />
                  </label>
                ))}
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
                  <span>System Prompt</span>
                  <textarea
                    className="min-h-48 w-full rounded-md border p-3 font-mono text-sm"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, system_prompt: event.target.value }))
                    }
                    value={form.system_prompt}
                  />
                </label>
                <div className="space-y-1 text-sm md:col-span-2">
                  <span>Markdown 预览</span>
                  <div className="min-h-32 whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm leading-6">
                    {renderMarkdownPreview(form.system_prompt)}
                  </div>
                </div>
                <label className="space-y-1 text-sm md:col-span-2">
                  <span>变量定义 JSON</span>
                  <textarea
                    className="min-h-40 w-full rounded-md border p-3 font-mono text-sm"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, variables_json: event.target.value }))
                    }
                    value={form.variables_json}
                  />
                </label>
                <div className="flex flex-wrap gap-2 md:col-span-2">
                  {mode === 'new' ? (
                    <Button onClick={() => void createSkill()} type="button">
                      创建 Skill
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => void saveSkill('new_version')} type="button">
                        保存为新版本
                      </Button>
                      <Button
                        onClick={() => void saveSkill('overwrite')}
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
                    onClick={() => void loadSkill(version.id, version.version)}
                    type="button"
                  >
                    <span>{version.version}</span>
                    <span className="text-muted-foreground">
                      {version.enabled ? '启用' : '禁用'}
                    </span>
                  </button>
                ))}
                {!versions.length ? (
                  <p className="text-muted-foreground">请选择 Skill 查看历史版本</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
