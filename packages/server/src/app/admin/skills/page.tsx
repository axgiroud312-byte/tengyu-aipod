'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'

type SkillSlot = {
  id: string
  title: string
  description: string
}

type SkillListResponse = {
  ok: true
  data: { items: SkillSummary[] }
}

type SkillDetailResponse = {
  ok: true
  data: Skill
}

const skillSlots: SkillSlot[] = [
  {
    id: 'txt2img-local-print',
    title: '文生图局部印花',
    description: '用于无参考图生成局部独立印花提示词。',
  },
  {
    id: 'txt2img-full-print',
    title: '文生图满印',
    description: '用于无参考图生成满版连续图案提示词。',
  },
  {
    id: 'img2img-local-reference',
    title: '图生图局部参考图',
    description: '用于有参考图时提炼局部独立印花提示词。',
  },
  {
    id: 'img2img-full-reference',
    title: '图生图满印参考图',
    description: '用于有参考图时生成满版连续图案提示词。',
  },
]
const defaultSkillSlot = skillSlots[0]!

function slotNotes(slot: SkillSlot) {
  return `${slot.title}：${slot.description}`
}

function skillPayload(slot: SkillSlot, systemPrompt: string, enabled: boolean) {
  return {
    id: slot.id,
    module: 'generation',
    category: slot.id,
    platform: null,
    language: null,
    version: '1.0.0',
    enabled,
    system_prompt: systemPrompt,
    variables_json: '[]',
    recommended_model: null,
    notes: slotNotes(slot),
  }
}

async function submitJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json' },
  })
  return (await response.json()) as { ok: boolean; error?: { message?: string } }
}

export default function AdminSkillsPage() {
  const [skills, setSkills] = useState<Record<string, SkillSummary>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [selectedSlotId, setSelectedSlotId] = useState(defaultSkillSlot.id)
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null)

  const selectedSlot = useMemo(
    () => skillSlots.find((slot) => slot.id === selectedSlotId) ?? defaultSkillSlot,
    [selectedSlotId],
  )
  const selectedSkill = skills[selectedSlot.id]
  const selectedPrompt = drafts[selectedSlot.id] ?? ''
  const selectedEnabled = enabled[selectedSlot.id] ?? true

  const loadSkills = useCallback(async () => {
    setIsLoading(true)
    setMessage(null)
    const response = await fetch('/admin/api/skills?module=generation')
    const result = (await response.json()) as SkillListResponse | { ok: false }
    if (!result.ok) {
      setIsLoading(false)
      setMessage('Skill 读取失败')
      return
    }

    const nextSkills: Record<string, SkillSummary> = {}
    const nextDrafts: Record<string, string> = {}
    const nextEnabled: Record<string, boolean> = {}

    for (const slot of skillSlots) {
      const summary = result.data.items.find((item) => item.id === slot.id)
      if (!summary) {
        nextDrafts[slot.id] = ''
        nextEnabled[slot.id] = true
        continue
      }

      nextSkills[slot.id] = summary
      nextEnabled[slot.id] = summary.enabled
      const detailResponse = await fetch(
        `/admin/api/skills/${encodeURIComponent(summary.id)}?version=${encodeURIComponent(
          summary.version,
        )}`,
      )
      const detail = (await detailResponse.json()) as SkillDetailResponse | { ok: false }
      nextDrafts[slot.id] = detail.ok ? detail.data.systemPrompt : ''
    }

    setSkills(nextSkills)
    setDrafts(nextDrafts)
    setEnabled(nextEnabled)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  async function saveSlot(slot: SkillSlot) {
    const systemPrompt = drafts[slot.id]?.trim() ?? ''
    if (!systemPrompt) {
      setMessage('System Prompt 不能为空')
      return
    }

    setSavingSlotId(slot.id)
    setMessage(null)
    const existing = skills[slot.id]
    const payload = skillPayload(slot, systemPrompt, enabled[slot.id] ?? true)
    const result = existing
      ? await submitJson(`/admin/api/skills/${encodeURIComponent(slot.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, save_mode: 'overwrite' }),
        })
      : await submitJson('/admin/api/skills', {
          method: 'POST',
          body: JSON.stringify(payload),
        })

    setSavingSlotId(null)
    if (!result.ok) {
      setMessage(result.error?.message ?? '保存失败')
      return
    }

    setMessage(`${slot.title} 已保存`)
    await loadSkills()
  }

  return (
    <AdminShell
      description="这里只配置 4 个固定生图 Skill 的系统提示词；模型、密钥和 Workflow 都在客户端本地设置。"
      title="Skill 管理"
    >
      <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Skill 槽位</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {skillSlots.map((slot) => {
              const active = selectedSlot.id === slot.id
              const configured = Boolean(skills[slot.id])
              return (
                <button
                  className={[
                    'w-full rounded-md border px-3 py-3 text-left text-sm transition-colors',
                    active
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'bg-card hover:bg-accent',
                  ].join(' ')}
                  key={slot.id}
                  onClick={() => setSelectedSlotId(slot.id)}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-medium">{slot.title}</span>
                    <span
                      className={
                        configured
                          ? 'text-xs text-green-700'
                          : 'text-xs text-muted-foreground'
                      }
                    >
                      {configured ? '已配置' : '未配置'}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {slot.description}
                  </span>
                </button>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{selectedSlot.title}</CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">{selectedSlot.description}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={selectedEnabled}
                  onChange={(event) =>
                    setEnabled((current) => ({
                      ...current,
                      [selectedSlot.id]: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                启用
              </label>
            </div>
          </CardHeader>
          <CardContent>
            {message ? <p className="mb-4 text-sm text-muted-foreground">{message}</p> : null}
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                <p>Skill 需要自己写明模型返回 JSON，例如：{`{ "prompts": ["..."] }`}。</p>
                <p>客户端会按 prompts 字符串数组拆分后逐条发给 Grsai 生图。</p>
              </div>
              <textarea
                className="min-h-[420px] w-full resize-y rounded-md border bg-background p-3 font-mono text-sm leading-6 outline-none focus:border-primary"
                disabled={isLoading}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [selectedSlot.id]: event.target.value }))
                }
                placeholder="在这里输入这个 Skill 的 system prompt..."
                value={selectedPrompt}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  ID：<span className="font-mono">{selectedSlot.id}</span>
                  {selectedSkill ? ` · 当前版本 ${selectedSkill.version}` : ' · 尚未创建'}
                </p>
                <Button
                  disabled={isLoading || savingSlotId === selectedSlot.id}
                  onClick={() => void saveSlot(selectedSlot)}
                  type="button"
                >
                  {savingSlotId === selectedSlot.id ? '保存中...' : '保存提交'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  )
}
