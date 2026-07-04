'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCallback, useEffect, useState } from 'react'

type Announcement = {
  content: string
  enabled: boolean
  end_at: string | null
  id: string
  level: 'info' | 'important' | 'warning'
  start_at: string
  target_php_uids_json: string
  target_scope: 'all' | 'php_uid_list'
  title: string
}

type Draft = {
  content: string
  enabled: boolean
  end_at: string
  level: 'info' | 'important' | 'warning'
  start_at: string
  target_php_uids: string
  target_scope: 'all' | 'php_uid_list'
  title: string
}

const emptyDraft: Draft = {
  content: '',
  enabled: true,
  end_at: '',
  level: 'info',
  start_at: '',
  target_php_uids: '',
  target_scope: 'all',
  title: '',
}

function dateTimeInputValue(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 16) : ''
}

function draftFromAnnouncement(item: Announcement): Draft {
  return {
    content: item.content,
    enabled: item.enabled,
    end_at: dateTimeInputValue(item.end_at),
    level: item.level,
    start_at: dateTimeInputValue(item.start_at),
    target_php_uids: JSON.parse(item.target_php_uids_json || '[]').join(', '),
    target_scope: item.target_scope,
    title: item.title,
  }
}

function payloadFromDraft(draft: Draft) {
  return {
    ...draft,
    end_at: draft.end_at ? new Date(draft.end_at).toISOString() : null,
    start_at: draft.start_at ? new Date(draft.start_at).toISOString() : '',
  }
}

export default function AdminAnnouncementsPage() {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [items, setItems] = useState<Announcement[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadItems = useCallback(async () => {
    const response = await fetch('/admin/api/announcements')
    const result = (await response.json()) as
      | { ok: true; data: { items: Announcement[] } }
      | { ok: false; error?: { message: string } }
    if (!result.ok) {
      setMessage(result.error?.message ?? '公告加载失败')
      return
    }
    setItems(result.data.items)
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  async function save() {
    const url = selectedId
      ? `/admin/api/announcements/${encodeURIComponent(selectedId)}`
      : '/admin/api/announcements'
    const response = await fetch(url, {
      body: JSON.stringify(payloadFromDraft(draft)),
      headers: { 'content-type': 'application/json' },
      method: selectedId ? 'PATCH' : 'POST',
    })
    const result = (await response.json().catch(() => null)) as
      | { ok: true }
      | { ok: false; error?: { message: string } }
      | null
    if (!result?.ok) {
      setMessage(result?.error?.message ?? '保存失败')
      return
    }
    setMessage('公告已保存')
    setDraft(emptyDraft)
    setSelectedId(null)
    await loadItems()
  }

  return (
    <AdminShell description="发布客户端轻量公告，可按 PHP uid 白名单定向。" title="公告管理">
      <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{selectedId ? '编辑公告' : '新建公告'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
            <input
              className="h-10 w-full rounded-md border px-3 text-sm"
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="标题"
              value={draft.title}
            />
            <textarea
              className="min-h-32 w-full rounded-md border p-3 text-sm"
              onChange={(event) =>
                setDraft((current) => ({ ...current, content: event.target.value }))
              }
              placeholder="公告内容"
              value={draft.content}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    level: event.target.value as Draft['level'],
                  }))
                }
                value={draft.level}
              >
                <option value="info">info</option>
                <option value="important">important</option>
                <option value="warning">warning</option>
              </select>
              <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
                <input
                  checked={draft.enabled}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, enabled: event.target.checked }))
                  }
                  type="checkbox"
                />
                启用
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, start_at: event.target.value }))
                }
                type="datetime-local"
                value={draft.start_at}
              />
              <input
                className="h-10 rounded-md border px-3 text-sm"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, end_at: event.target.value }))
                }
                type="datetime-local"
                value={draft.end_at}
              />
            </div>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  target_scope: event.target.value as Draft['target_scope'],
                }))
              }
              value={draft.target_scope}
            >
              <option value="all">全部客户</option>
              <option value="php_uid_list">PHP uid 白名单</option>
            </select>
            {draft.target_scope === 'php_uid_list' ? (
              <textarea
                className="min-h-20 w-full rounded-md border p-3 text-sm"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, target_php_uids: event.target.value }))
                }
                placeholder="例如：123, 456"
                value={draft.target_php_uids}
              />
            ) : null}
            <div className="flex gap-2">
              <Button onClick={() => void save()} type="button">
                保存
              </Button>
              <Button
                onClick={() => {
                  setDraft(emptyDraft)
                  setSelectedId(null)
                }}
                type="button"
                variant="secondary"
              >
                新建
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>公告列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => (
              <button
                className="w-full rounded-md border p-3 text-left text-sm hover:bg-accent"
                key={item.id}
                onClick={() => {
                  setDraft(draftFromAnnouncement(item))
                  setSelectedId(item.id)
                }}
                type="button"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.enabled ? '启用' : '停用'} · {item.level}
                  </span>
                </span>
                <span className="mt-2 line-clamp-2 block text-muted-foreground">
                  {item.content}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  )
}
