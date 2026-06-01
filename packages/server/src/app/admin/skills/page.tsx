'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'

type SkillSlot = {
  id: string
  module: 'generation' | 'detection' | 'title'
  category: string | null
  title: string
  description: string
  recommendedModel: string | null
  returnHint: string
}

const EXTRACT_SKILL_CATEGORY = 'extract-paid-model'
const LEGACY_COMFYUI_EXTRACT_CATEGORY = 'extract-comfyui-workflow'

type SkillListResponse = {
  ok: true
  data: { items: SkillSummary[] }
}

type SkillDetailResponse = {
  ok: true
  data: Skill
}

const promptDefaultSkillSlots: [SkillSlot, ...SkillSlot[]] = [
  {
    id: 'txt2img-local-print',
    module: 'generation',
    category: 'txt2img-local-print',
    title: '文生图局部印花',
    description: '用于无参考图生成局部独立印花提示词。',
    recommendedModel: 'qwen3-vl-plus',
    returnHint: '要求返回 JSON：{ "prompts": ["..."] }。',
  },
  {
    id: 'txt2img-full-print',
    module: 'generation',
    category: 'txt2img-full-print',
    title: '文生图满印',
    description: '用于无参考图生成满版连续图案提示词。',
    recommendedModel: 'qwen3-vl-plus',
    returnHint: '要求返回 JSON：{ "prompts": ["..."] }。',
  },
  {
    id: 'img2img-local-reference',
    module: 'generation',
    category: 'img2img-local-reference',
    title: '图生图局部参考图',
    description: '用于有参考图时提炼局部独立印花提示词。',
    recommendedModel: 'qwen3-vl-plus',
    returnHint: '要求返回 JSON：{ "prompts": ["..."] }。',
  },
  {
    id: 'img2img-full-reference',
    module: 'generation',
    category: 'img2img-full-reference',
    title: '图生图满印参考图',
    description: '用于有参考图时生成满版连续图案提示词。',
    recommendedModel: 'qwen3-vl-plus',
    returnHint: '要求返回 JSON：{ "prompts": ["..."] }。',
  },
]

const detectionSkillSlot: SkillSlot = {
  id: 'infringement-detection',
  module: 'detection',
  category: 'infringement',
  title: '侵权检测提示词',
  description: '用于侵权检测：把印花图像和这段系统提示词发送给百炼视觉模型。',
  recommendedModel: 'qwen3-vl-flash',
  returnHint: '要求返回 JSON：{ "risk_score": 0-100, "reason": "..." }。',
}

const fixedSkillSlots: [SkillSlot, ...SkillSlot[]] = [
  ...promptDefaultSkillSlots,
  detectionSkillSlot,
]
const promptSkillGroups = promptDefaultSkillSlots.map((slot) => ({ defaultSlot: slot }))
const promptSkillCategories = new Set(
  promptDefaultSkillSlots
    .map((slot) => slot.category)
    .filter((category): category is string => Boolean(category)),
)
const defaultSkillSlot = promptDefaultSkillSlots[0]

function isExtractSkillSummary(skill: SkillSummary) {
  return (
    skill.module === 'generation' &&
    (skill.category === EXTRACT_SKILL_CATEGORY ||
      skill.category === LEGACY_COMFYUI_EXTRACT_CATEGORY)
  )
}

function promptGroupForCategory(category: string | null) {
  return promptSkillGroups.find((group) => group.defaultSlot.category === category) ?? null
}

function isPromptCustomSkillSummary(skill: SkillSummary) {
  const group = promptGroupForCategory(skill.category)
  return Boolean(skill.module === 'generation' && group && skill.id !== group.defaultSlot.id)
}

function isPromptSlot(slot: SkillSlot) {
  return Boolean(
    slot.module === 'generation' && slot.category && promptSkillCategories.has(slot.category),
  )
}

function isPromptDefaultSlot(slot: SkillSlot) {
  const group = promptGroupForCategory(slot.category)
  return group?.defaultSlot.id === slot.id
}

function isPromptCustomSlot(slot: SkillSlot) {
  return isPromptSlot(slot) && !isPromptDefaultSlot(slot)
}

function isExtractSlot(slot: SkillSlot) {
  return (
    slot.module === 'generation' &&
    (slot.category === EXTRACT_SKILL_CATEGORY || slot.category === LEGACY_COMFYUI_EXTRACT_CATEGORY)
  )
}

function newPromptSlot(
  group: (typeof promptSkillGroups)[number],
  id: string,
  title: string,
): SkillSlot {
  return {
    ...group.defaultSlot,
    id,
    title,
  }
}

function promptSkillTitle(skill: SkillSummary, group: (typeof promptSkillGroups)[number]) {
  const noteTitle = skill.notes?.split('：')[0]?.trim()
  if (!noteTitle || noteTitle.startsWith('用于')) {
    return group.defaultSlot.title
  }
  return noteTitle
}

function promptSlotFromSkill(skill: SkillSummary): SkillSlot | null {
  const group = promptGroupForCategory(skill.category)
  return group ? newPromptSlot(group, skill.id, promptSkillTitle(skill, group)) : null
}

function newExtractSlot(id: string, title = '提取提示词'): SkillSlot {
  return {
    id,
    module: 'generation',
    category: EXTRACT_SKILL_CATEGORY,
    title,
    description:
      '用于提取能力：付费模型和 ComfyUI 都把这段 system prompt 作为每张源图的提取提示词。',
    recommendedModel: null,
    returnHint: '不要求 JSON，一张源图对应一次提取运行；区别只在用户选择的生图渠道。',
  }
}

function extractSkillTitle(skill: SkillSummary) {
  const noteTitle = skill.notes?.split('：')[0]?.trim()
  if (!noteTitle || noteTitle.startsWith('用于')) {
    return '提取提示词'
  }
  if (noteTitle.includes('付费模型提取') || noteTitle.includes('ComfyUI 提取')) {
    return '提取提示词'
  }
  return noteTitle
}

function extractSlotFromSkill(skill: SkillSummary) {
  return newExtractSlot(skill.id, extractSkillTitle(skill))
}

function slotNotes(slot: SkillSlot) {
  return `${slot.title}：${slot.description}`
}

function skillPayload(slot: SkillSlot, systemPrompt: string, enabled: boolean) {
  return {
    id: slot.id,
    module: slot.module,
    category: slot.category,
    platform: null,
    language: null,
    version: '1.0.0',
    enabled,
    system_prompt: systemPrompt,
    variables_json: '[]',
    recommended_model: slot.recommendedModel,
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
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [customPromptSlots, setCustomPromptSlots] = useState<SkillSlot[]>([])
  const [customExtractSlots, setCustomExtractSlots] = useState<SkillSlot[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState(defaultSkillSlot.id)
  const [message, setMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null)

  const extractSlots = useMemo(
    () =>
      Object.values(skills)
        .filter(isExtractSkillSummary)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(extractSlotFromSkill),
    [skills],
  )
  const promptSlots = useMemo(
    () =>
      Object.values(skills)
        .filter(isPromptCustomSkillSummary)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(promptSlotFromSkill)
        .filter((slot): slot is SkillSlot => Boolean(slot)),
    [skills],
  )
  const allSlots = useMemo(
    () => [
      ...fixedSkillSlots,
      ...promptSlots,
      ...customPromptSlots,
      ...extractSlots,
      ...customExtractSlots,
    ],
    [customExtractSlots, customPromptSlots, extractSlots, promptSlots],
  )
  const selectedSlot = useMemo(
    () => allSlots.find((slot) => slot.id === selectedSlotId) ?? defaultSkillSlot,
    [allSlots, selectedSlotId],
  )
  const selectedSkill = skills[selectedSlot.id]
  const selectedPrompt = drafts[selectedSlot.id] ?? ''
  const selectedEnabled = enabled[selectedSlot.id] ?? true
  const selectedTitle = titles[selectedSlot.id] ?? selectedSlot.title
  const selectedHasEditableTitle = isExtractSlot(selectedSlot) || isPromptCustomSlot(selectedSlot)

  const loadSkills = useCallback(async () => {
    setIsLoading(true)
    setMessage(null)
    const response = await fetch('/admin/api/skills')
    const result = (await response.json()) as SkillListResponse | { ok: false }
    if (!result.ok) {
      setIsLoading(false)
      setMessage('Skill 读取失败')
      return
    }

    const nextSkills: Record<string, SkillSummary> = {}
    const nextDrafts: Record<string, string> = {}
    const nextEnabled: Record<string, boolean> = {}
    const nextTitles: Record<string, string> = {}
    const loadedSlots = [
      ...fixedSkillSlots,
      ...result.data.items
        .filter(isPromptCustomSkillSummary)
        .map(promptSlotFromSkill)
        .filter((slot): slot is SkillSlot => Boolean(slot)),
      ...result.data.items.filter(isExtractSkillSummary).map(extractSlotFromSkill),
    ]

    for (const summary of result.data.items) {
      nextSkills[summary.id] = summary
    }

    for (const slot of loadedSlots) {
      const summary = nextSkills[slot.id]
      if (!summary) {
        nextDrafts[slot.id] = ''
        nextEnabled[slot.id] = true
        nextTitles[slot.id] = slot.title
        continue
      }

      nextSkills[slot.id] = summary
      nextEnabled[slot.id] = summary.enabled
      nextTitles[slot.id] = slot.title
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
    setTitles(nextTitles)
    setCustomPromptSlots([])
    setCustomExtractSlots([])
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
    const slotWithTitle = { ...slot, title: (titles[slot.id] ?? slot.title).trim() || slot.title }
    const payload = skillPayload(slotWithTitle, systemPrompt, enabled[slot.id] ?? true)
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

    setMessage(`${slotWithTitle.title} 已保存`)
    await loadSkills()
  }

  function addPromptSlot(group: (typeof promptSkillGroups)[number]) {
    const id = `${group.defaultSlot.category ?? group.defaultSlot.id}-${Date.now()}`
    const slot = newPromptSlot(group, id, `新的${group.defaultSlot.title}`)
    setCustomPromptSlots((current) => [...current, slot])
    setDrafts((current) => ({ ...current, [id]: '' }))
    setEnabled((current) => ({ ...current, [id]: true }))
    setTitles((current) => ({ ...current, [id]: slot.title }))
    setSelectedSlotId(id)
    setMessage(null)
  }

  function addExtractSlot() {
    const id = `extract-paid-model-${Date.now()}`
    const slot = newExtractSlot(id, '新的提取提示词')
    setCustomExtractSlots((current) => [...current, slot])
    setDrafts((current) => ({ ...current, [id]: '' }))
    setEnabled((current) => ({ ...current, [id]: true }))
    setTitles((current) => ({ ...current, [id]: slot.title }))
    setSelectedSlotId(id)
    setMessage(null)
  }

  function renderSlotButton(slot: SkillSlot) {
    const active = selectedSlot.id === slot.id
    const configured = Boolean(skills[slot.id])
    return (
      <button
        className={[
          'w-full rounded-md border px-3 py-3 text-left text-sm transition-colors',
          active ? 'border-primary bg-primary/5 text-foreground' : 'bg-card hover:bg-accent',
        ].join(' ')}
        key={slot.id}
        onClick={() => setSelectedSlotId(slot.id)}
        type="button"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="font-medium">{titles[slot.id] ?? slot.title}</span>
          <span className={configured ? 'text-xs text-green-700' : 'text-xs text-muted-foreground'}>
            {configured ? '已配置' : '未配置'}
          </span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {slot.description}
        </span>
      </button>
    )
  }

  function renderPromptGroup(group: (typeof promptSkillGroups)[number]) {
    const slots = [...promptSlots, ...customPromptSlots].filter(
      (slot) => slot.category === group.defaultSlot.category,
    )
    return (
      <div className="border-t pt-3" key={group.defaultSlot.id}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{group.defaultSlot.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              默认 Skill 保持兼容，也可新增多条给客户端选择。
            </p>
          </div>
          <Button
            className="h-8 px-3"
            disabled={isLoading}
            onClick={() => addPromptSlot(group)}
            type="button"
            variant="outline"
          >
            + 新增
          </Button>
        </div>
        <div className="space-y-3">
          {renderSlotButton(group.defaultSlot)}
          {slots.map(renderSlotButton)}
        </div>
      </div>
    )
  }

  return (
    <AdminShell
      description="这里只配置业务 Skill 的系统提示词；模型、密钥和 Workflow 都在客户端本地设置。"
      title="Skill 管理"
    >
      <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Skill 槽位</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {promptSkillGroups.map(renderPromptGroup)}
            <div className="border-t pt-3">{renderSlotButton(detectionSkillSlot)}</div>
            <div className="border-t pt-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">提取提示词</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    付费模型和 ComfyUI 共用，可配置多条给客户端选择。
                  </p>
                </div>
                <Button
                  className="h-8 px-3"
                  disabled={isLoading}
                  onClick={addExtractSlot}
                  type="button"
                  variant="outline"
                >
                  + 新增
                </Button>
              </div>
              <div className="space-y-3">
                {[...extractSlots, ...customExtractSlots].length ? (
                  [...extractSlots, ...customExtractSlots].map(renderSlotButton)
                ) : (
                  <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                    暂无提取 Skill
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{selectedTitle}</CardTitle>
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
                <p>{selectedSlot.returnHint}</p>
                <p>后台只保存 system prompt，不保存用户 API Key、模型密钥或图片。</p>
              </div>
              {selectedHasEditableTitle ? (
                <label className="block space-y-2 text-sm font-medium">
                  <span>显示名称</span>
                  <input
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
                    disabled={isLoading}
                    onChange={(event) =>
                      setTitles((current) => ({
                        ...current,
                        [selectedSlot.id]: event.target.value,
                      }))
                    }
                    placeholder={
                      isExtractSlot(selectedSlot)
                        ? '例如：常规提取 / 文字 Logo 提取 / 只提主图案'
                        : '例如：圣诞局部 / 欧美满印 / 潮牌参考图'
                    }
                    value={selectedTitle}
                  />
                </label>
              ) : null}
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
