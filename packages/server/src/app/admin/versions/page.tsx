'use client'

import { AdminShell } from '@/components/admin/admin-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCallback, useEffect, useState } from 'react'

type ClientVersion = {
  channel: 'stable' | 'beta'
  changelog: string
  download_url_mac: string | null
  download_url_win: string | null
  enabled: boolean
  force_upgrade: boolean
  platform: 'windows' | 'macos'
  published_at: string
  target_php_uids_json: string
  target_scope: 'all' | 'php_uid_list'
  version: string
}

type Draft = {
  channel: 'stable' | 'beta'
  changelog: string
  download_url: string
  enabled: boolean
  force_upgrade: boolean
  platform: 'windows' | 'macos'
  published_at: string
  target_php_uids: string
  target_scope: 'all' | 'php_uid_list'
  version: string
}

const emptyDraft: Draft = {
  channel: 'stable',
  changelog: '',
  download_url: '',
  enabled: true,
  force_upgrade: false,
  platform: 'windows',
  published_at: '',
  target_php_uids: '',
  target_scope: 'all',
  version: '',
}

function dateTimeInputValue(value: string) {
  return new Date(value).toISOString().slice(0, 16)
}

function draftFromVersion(item: ClientVersion): Draft {
  return {
    channel: item.channel,
    changelog: item.changelog,
    download_url:
      item.platform === 'macos' ? (item.download_url_mac ?? '') : (item.download_url_win ?? ''),
    enabled: item.enabled,
    force_upgrade: item.force_upgrade,
    platform: item.platform,
    published_at: dateTimeInputValue(item.published_at),
    target_php_uids: JSON.parse(item.target_php_uids_json || '[]').join(', '),
    target_scope: item.target_scope,
    version: item.version,
  }
}

function payloadFromDraft(draft: Draft) {
  return {
    ...draft,
    published_at: draft.published_at ? new Date(draft.published_at).toISOString() : '',
  }
}

export default function AdminVersionsPage() {
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [items, setItems] = useState<ClientVersion[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const loadItems = useCallback(async () => {
    const response = await fetch('/admin/api/client-versions')
    const result = (await response.json()) as
      | { ok: true; data: { items: ClientVersion[] } }
      | { ok: false; error?: { message: string } }
    if (!result.ok) {
      setMessage(result.error?.message ?? '版本加载失败')
      return
    }
    setItems(result.data.items)
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  async function save() {
    const response = await fetch('/admin/api/client-versions', {
      body: JSON.stringify(payloadFromDraft(draft)),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const result = (await response.json().catch(() => null)) as
      | { ok: true }
      | { ok: false; error?: { message: string } }
      | null
    if (!result?.ok) {
      setMessage(result?.error?.message ?? '保存失败')
      return
    }
    setMessage('版本已保存')
    setDraft(emptyDraft)
    await loadItems()
  }

  return (
    <AdminShell description="维护客户端版本、下载地址和强制升级策略。" title="版本管理">
      <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>版本配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
            <input
              className="h-10 w-full rounded-md border px-3 text-sm"
              onChange={(event) =>
                setDraft((current) => ({ ...current, version: event.target.value }))
              }
              placeholder="版本号，例如 1.0.1"
              value={draft.version}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    platform: event.target.value as Draft['platform'],
                  }))
                }
                value={draft.platform}
              >
                <option value="windows">windows</option>
                <option value="macos">macos</option>
              </select>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    channel: event.target.value as Draft['channel'],
                  }))
                }
                value={draft.channel}
              >
                <option value="stable">stable</option>
                <option value="beta">beta</option>
              </select>
            </div>
            <input
              className="h-10 w-full rounded-md border px-3 text-sm"
              onChange={(event) =>
                setDraft((current) => ({ ...current, download_url: event.target.value }))
              }
              placeholder="下载 URL"
              value={draft.download_url}
            />
            <textarea
              className="min-h-32 w-full rounded-md border p-3 text-sm"
              onChange={(event) =>
                setDraft((current) => ({ ...current, changelog: event.target.value }))
              }
              placeholder="更新说明"
              value={draft.changelog}
            />
            <input
              className="h-10 w-full rounded-md border px-3 text-sm"
              onChange={(event) =>
                setDraft((current) => ({ ...current, published_at: event.target.value }))
              }
              type="datetime-local"
              value={draft.published_at}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
                <input
                  checked={draft.force_upgrade}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, force_upgrade: event.target.checked }))
                  }
                  type="checkbox"
                />
                强制升级
              </label>
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
              <Button onClick={() => setDraft(emptyDraft)} type="button" variant="secondary">
                新建
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>版本列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => (
              <button
                className="w-full rounded-md border p-3 text-left text-sm hover:bg-accent"
                key={`${item.version}-${item.platform}-${item.channel}`}
                onClick={() => setDraft(draftFromVersion(item))}
                type="button"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {item.version} · {item.platform} · {item.channel}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.enabled ? '启用' : '停用'} · {item.force_upgrade ? '强制' : '可选'}
                  </span>
                </span>
                <span className="mt-2 line-clamp-2 block text-muted-foreground">
                  {item.changelog}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  )
}
