import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import type {
  ListingItem,
  ListingPlatformKey,
  ListingProgress,
  ListingSkuMode,
  ListingSubmitMode,
  ListingTemplateConfig,
  ListingTemplateKey,
} from '@tengyu-aipod/shared'
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, Play, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { BitBrowserProfile } from '../../../main/lib/bit-browser-client'
import type { BrowserProfileHolder } from '../../../main/lib/browser-profile-lock'
import type { ListingBatchLoadResult } from '../../../main/lib/listing-batch-loader'

type WorkspaceProgress = {
  status: ListingProgress['status']
  currentSku?: string
  currentStage?: string
  finishedCount: number
  totalCount: number
  lastError?: string
}

const PROFILE_TARGET = '2-1111'

const platformLabels: Record<ListingPlatformKey, string> = {
  'temu-pop': 'Temu',
  shein: 'Shein',
}

const stageLabels: Record<string, string> = {
  enter_page: '打开编辑页',
  page_ready: '等待页面可编辑',
  confirm_shop_context: '替换店铺名称',
  fill_title_and_sku: '替换标题',
  upload_material_images: '替换图片',
  replace_images: '替换图片',
  upload_video: '一键上传视频',
  generate_sku_code: '一键生成 SKU',
  process_description: '处理描述',
  submit_publish: '保存草稿',
  publish_result: '验证结果',
}

function templateIdFromUrl(url: string) {
  return new URL(url).searchParams.get('id') ?? ''
}

function editUrlFromTemplate(template: ListingTemplateConfig, draftTemplateId: string) {
  const url = new URL(template.editUrl)
  url.searchParams.set('id', draftTemplateId.trim())
  return url.toString()
}

function parseIntInput(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function profileMatchesTarget(profile: BitBrowserProfile) {
  return [profile.id, profile.name, profile.remark, profile.seq ? String(profile.seq) : '']
    .filter((value): value is string => Boolean(value))
    .some((value) => value.includes(PROFILE_TARGET))
}

function lockLabel(lock: BrowserProfileHolder | undefined) {
  if (!lock) {
    return null
  }
  return lock.module === 'collection' ? '被采集占用' : '被上架占用'
}

function profileStatusLabel(profile: BitBrowserProfile, lock: BrowserProfileHolder | undefined) {
  const locked = lockLabel(lock)
  if (locked) {
    return locked
  }
  if (profile.status === 1 || profile.status === '1') {
    return '已登录'
  }
  if (profile.status === 0 || profile.status === '0') {
    return '未登录'
  }
  return '可用'
}

function progressPercent(progress: ListingProgress | null) {
  if (!progress || progress.totalCount === 0) {
    return 0
  }
  return Math.round((progress.finishedCount / progress.totalCount) * 100)
}

function warningTitleMissing(warning: string) {
  return warning.includes('无标题')
}

export function ListingWorkbench() {
  const [templates, setTemplates] = useState<ListingTemplateConfig[]>([])
  const [templateKey, setTemplateKey] = useState<ListingTemplateKey>('temu-clothing')
  const [batchDir, setBatchDir] = useState('')
  const [draftTemplateId, setDraftTemplateId] = useState('')
  const [targetShopName, setTargetShopName] = useState('')
  const [skuMode, setSkuMode] = useState<ListingSkuMode>('one-click-generate')
  const [submitMode, setSubmitMode] = useState<ListingSubmitMode>('save-draft')
  const [maxAttempts, setMaxAttempts] = useState('2')
  const [failStreakLimit, setFailStreakLimit] = useState('3')
  const [resume, setResume] = useState(true)
  const [profiles, setProfiles] = useState<BitBrowserProfile[]>([])
  const [locks, setLocks] = useState<BrowserProfileHolder[]>([])
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([])
  const [scanResult, setScanResult] = useState<ListingBatchLoadResult | null>(null)
  const [progress, setProgress] = useState<ListingProgress | null>(null)
  const [workspaceProgress, setWorkspaceProgress] = useState<Record<string, WorkspaceProgress>>({})
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function loadTemplates() {
      const nextTemplates = await window.api.listing.listTemplates()
      if (!mounted) {
        return
      }
      setTemplates(nextTemplates)
      const firstTemplate = nextTemplates[0]
      if (firstTemplate) {
        setTemplateKey(firstTemplate.key)
        setBatchDir(firstTemplate.materialRootDir)
        setDraftTemplateId(templateIdFromUrl(firstTemplate.editUrl))
        setSkuMode(firstTemplate.skuMode)
      }
    }

    void loadTemplates().catch((nextError) => {
      if (mounted) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => window.api.listing.onProgress(handleProgress), [])

  useEffect(() => {
    void refreshProfiles()
  }, [])

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.key === templateKey) ?? templates[0] ?? null,
    [templateKey, templates],
  )
  const selectedPlatform = selectedTemplate?.platform ?? 'temu-pop'
  const platformOptions = useMemo(
    () =>
      Array.from(new Set(templates.map((template) => template.platform))).map((platform) => ({
        key: platform,
        label: platformLabels[platform],
      })),
    [templates],
  )
  const templatesForPlatform = templates.filter(
    (template) => template.platform === selectedPlatform,
  )
  const lockByProfileId = useMemo(
    () => new Map(locks.map((lock) => [lock.profileId, lock])),
    [locks],
  )
  const selectedProfiles = profiles.filter((profile) => selectedProfileIds.includes(profile.id))
  const itemCount = scanResult?.listingItems.length ?? 0
  const warningCount = scanResult?.warnings.length ?? 0
  const titleWarningCount = scanResult?.warnings.filter(warningTitleMissing).length ?? 0
  const estimatedMinutes = Math.max(
    0,
    Math.ceil((itemCount * 4) / Math.max(1, selectedProfileIds.length)),
  )
  const canStart =
    Boolean(selectedTemplate) &&
    itemCount > 0 &&
    selectedProfileIds.length > 0 &&
    targetShopName.trim().length > 0 &&
    draftTemplateId.trim().length > 0 &&
    !starting

  function handleProgress(nextProgress: ListingProgress) {
    setProgress(nextProgress)
    if (!nextProgress.profileId) {
      return
    }
    setWorkspaceProgress((current) => {
      const nextRow: WorkspaceProgress = {
        status: nextProgress.status,
        finishedCount: nextProgress.finishedCount,
        totalCount: nextProgress.totalCount,
        ...(nextProgress.currentSku ? { currentSku: nextProgress.currentSku } : {}),
        ...(nextProgress.currentStage ? { currentStage: nextProgress.currentStage } : {}),
        ...(nextProgress.lastError ? { lastError: nextProgress.lastError.message } : {}),
      }
      return {
        ...current,
        [nextProgress.profileId]: nextRow,
      }
    })
  }

  async function chooseBatchDir() {
    const result = await window.api.listing.chooseBatchDir()
    if (result.ok) {
      setBatchDir(result.data.path)
      setScanResult(null)
    }
  }

  async function scanBatchDir() {
    if (!batchDir.trim()) {
      setError('请先选择货号批次目录')
      return
    }
    setScanning(true)
    setError(null)
    try {
      const result = await window.api.listing.scanBatchDir({
        batchDir: batchDir.trim(),
        templateKey,
      })
      setScanResult(result)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setScanning(false)
    }
  }

  async function refreshProfiles() {
    setLoadingProfiles(true)
    setError(null)
    try {
      const [nextProfiles, nextLocks] = await Promise.all([
        window.api.listing.listProfiles(),
        window.api.browserProfileLock.list(),
      ])
      setProfiles(nextProfiles)
      setLocks(nextLocks)
      setSelectedProfileIds((current) => {
        if (current.length > 0) {
          return current.filter((profileId) =>
            nextProfiles.some((profile) => profile.id === profileId),
          )
        }
        const targetProfile = nextProfiles.find(profileMatchesTarget)
        return targetProfile ? [targetProfile.id] : []
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoadingProfiles(false)
    }
  }

  async function startListing() {
    if (!selectedTemplate || !scanResult || !canStart) {
      setError('请先完成批次扫描、选择 profile，并填写店铺名和模板 ID')
      return
    }
    setStarting(true)
    setError(null)
    setProgress(null)
    setWorkspaceProgress({})
    try {
      const editUrl = editUrlFromTemplate(selectedTemplate, draftTemplateId)
      const template: ListingTemplateConfig = {
        ...selectedTemplate,
        editUrl,
        skuMode,
      }
      const items: ListingItem[] = scanResult.listingItems.map((item) => ({
        ...item,
        platform: template.platform,
        templateKey: template.key,
        editUrl,
        targetShopName: targetShopName.trim(),
      }))
      const taskId = await window.api.listing.run({
        config: {
          batch_dir: batchDir.trim(),
          platform: template.platform,
          template,
          workspaces: selectedProfileIds.map((profileId) => ({ profile_id: profileId })),
          submit_mode: submitMode,
          max_attempts: parseIntInput(maxAttempts, 2, 1, 5),
          fail_streak_limit: parseIntInput(failStreakLimit, 3, 1, 10),
          resume,
          timeout_ms: 30_000,
        },
        items,
      })
      setRunningTaskId(taskId)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setStarting(false)
    }
  }

  function selectPlatform(platform: ListingPlatformKey) {
    const nextTemplate = templates.find((template) => template.platform === platform)
    if (!nextTemplate) {
      return
    }
    setTemplateKey(nextTemplate.key)
    setBatchDir(nextTemplate.materialRootDir)
    setDraftTemplateId(templateIdFromUrl(nextTemplate.editUrl))
    setSkuMode(nextTemplate.skuMode)
    setScanResult(null)
  }

  function selectTemplate(nextTemplateKey: ListingTemplateKey) {
    const nextTemplate = templates.find((template) => template.key === nextTemplateKey)
    if (!nextTemplate) {
      return
    }
    setTemplateKey(nextTemplate.key)
    setBatchDir(nextTemplate.materialRootDir)
    setDraftTemplateId(templateIdFromUrl(nextTemplate.editUrl))
    setSkuMode(nextTemplate.skuMode)
    setScanResult(null)
  }

  function toggleProfile(profileId: string) {
    setSelectedProfileIds((current) =>
      current.includes(profileId)
        ? current.filter((candidate) => candidate !== profileId)
        : [...current, profileId],
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-6">
        <div className="rounded-md border bg-background p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-balance">上架任务配置</h2>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">
                选择货号批次、店小秘模板和比特浏览器 profile 后启动批量上架。
              </p>
            </div>
            <Button onClick={() => void refreshProfiles()} type="button" variant="secondary">
              {loadingProfiles ? (
                <Loader2 className="mr-2 size-4" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              刷新 profile
            </Button>
          </div>

          <div className="mt-5 grid gap-5">
            <label className="block space-y-2 text-sm font-medium">
              <span>货号批次目录</span>
              <div className="flex gap-2">
                <input
                  className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => {
                    setBatchDir(event.target.value)
                    setScanResult(null)
                  }}
                  placeholder="/Users/.../05-货号成品/批次"
                  value={batchDir}
                />
                <Button onClick={() => void chooseBatchDir()} type="button" variant="secondary">
                  <FolderOpen className="mr-2 size-4" />
                  选择
                </Button>
                <Button
                  disabled={scanning}
                  onClick={() => void scanBatchDir()}
                  type="button"
                  variant="secondary"
                >
                  {scanning ? <Loader2 className="mr-2 size-4" /> : null}
                  扫描
                </Button>
              </div>
            </label>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="block space-y-2 text-sm font-medium">
                <span>平台</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => selectPlatform(event.target.value as ListingPlatformKey)}
                  value={selectedPlatform}
                >
                  {platformOptions.map((platform) => (
                    <option key={platform.key} value={platform.key}>
                      {platform.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>真实模板</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => selectTemplate(event.target.value as ListingTemplateKey)}
                  value={templateKey}
                >
                  {templatesForPlatform.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>草稿模板 ID</span>
                <input
                  className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setDraftTemplateId(event.target.value)}
                  placeholder="店小秘编辑页 URL 的 id"
                  value={draftTemplateId}
                />
              </label>
            </div>

            <label className="block space-y-2 text-sm font-medium">
              <span>目标店铺名称</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setTargetShopName(event.target.value)}
                placeholder="运行时替换到店小秘店铺字段"
                value={targetShopName}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">SKU 编码策略</legend>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      checked={skuMode === 'one-click-generate'}
                      onChange={() => setSkuMode('one-click-generate')}
                      type="radio"
                    />
                    一键生成 SKU
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      checked={skuMode === 'manual'}
                      onChange={() => setSkuMode('manual')}
                      type="radio"
                    />
                    保留货号
                  </label>
                </div>
              </fieldset>
              <fieldset className="rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">提交方式</legend>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      checked={submitMode === 'save-draft'}
                      onChange={() => setSubmitMode('save-draft')}
                      type="radio"
                    />
                    保存草稿
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      checked={submitMode === 'publish'}
                      onChange={() => setSubmitMode('publish')}
                      type="radio"
                    />
                    发布
                  </label>
                </div>
              </fieldset>
            </div>

            <Accordion collapsible type="single">
              <AccordionItem value="advanced">
                <AccordionTrigger>高级配置</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-4 md:grid-cols-4">
                    <label className="block space-y-2 text-sm font-medium">
                      <span>每店铺并发</span>
                      <input
                        className="h-10 w-full rounded-md border bg-muted px-3 text-sm tabular-nums outline-none"
                        disabled
                        type="number"
                        value="1"
                      />
                    </label>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>失败重试</span>
                      <input
                        className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        max={5}
                        min={1}
                        onChange={(event) => setMaxAttempts(event.target.value)}
                        type="number"
                        value={maxAttempts}
                      />
                    </label>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>连续失败暂停</span>
                      <input
                        className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        max={10}
                        min={1}
                        onChange={(event) => setFailStreakLimit(event.target.value)}
                        type="number"
                        value={failStreakLimit}
                      />
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-sm font-medium">
                      <input
                        checked={resume}
                        onChange={(event) => setResume(event.target.checked)}
                        type="checkbox"
                      />
                      断点续传
                    </label>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <div className="text-sm text-muted-foreground">
                预估 {itemCount} 个货号，约 <span className="tabular-nums">{estimatedMinutes}</span>{' '}
                分钟
              </div>
              <Button disabled={!canStart} onClick={() => void startListing()} type="button">
                {starting ? <Loader2 className="mr-2 size-4" /> : <Play className="mr-2 size-4" />}
                开始上架
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-background p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-balance">比特浏览器工作区</h2>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">
                默认优先选择名称、备注或编号包含 {PROFILE_TARGET} 的 profile。
              </p>
            </div>
            <span className="text-sm text-muted-foreground tabular-nums">
              已选 {selectedProfileIds.length}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {profiles.length ? (
              profiles.map((profile) => {
                const lock = lockByProfileId.get(profile.id)
                const locked = Boolean(lock)
                const selected = selectedProfileIds.includes(profile.id)
                return (
                  <label
                    className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
                      selected ? 'border-primary bg-muted' : 'bg-background'
                    } ${locked ? 'opacity-70' : ''}`}
                    key={profile.id}
                  >
                    <input
                      checked={selected}
                      disabled={locked}
                      onChange={() => toggleProfile(profile.id)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{profile.name}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {profile.seq ? `#${profile.seq} · ` : ''}
                        {profile.id}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs">
                      {profileStatusLabel(profile, lock)}
                    </span>
                  </label>
                )
              })
            ) : (
              <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground md:col-span-2">
                暂无 profile，点击刷新读取比特浏览器。
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border bg-background p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-balance">执行中工作区</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {runningTaskId ? `任务 ${runningTaskId}` : '尚未开始'}
              </p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {progressPercent(progress)}%
            </span>
          </div>
          <div className="mt-4 h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${progressPercent(progress)}%` }}
            />
          </div>
          <div className="mt-4 divide-y rounded-md border">
            {selectedProfiles.length ? (
              selectedProfiles.map((profile) => {
                const row = workspaceProgress[profile.id]
                return (
                  <div
                    className="grid gap-2 p-3 text-sm md:grid-cols-[160px_minmax(0,1fr)_120px]"
                    key={profile.id}
                  >
                    <div className="font-medium">{profile.name}</div>
                    <div className="min-w-0 text-muted-foreground">
                      {row?.currentSku ? (
                        <span className="truncate">
                          {row.currentSku} ·{' '}
                          {stageLabels[row.currentStage ?? ''] ?? row.currentStage}
                        </span>
                      ) : (
                        <span>等待任务</span>
                      )}
                      {row?.lastError ? (
                        <p className="mt-1 text-xs text-red-700">{row.lastError}</p>
                      ) : null}
                    </div>
                    <div className="text-right tabular-nums">
                      {row ? `${row.finishedCount}/${row.totalCount}` : '0/0'}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                选择 profile 后显示每个工作区进度。
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <div className="rounded-md border bg-background p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-balance">批次概览</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-muted p-3">
              <dt className="text-muted-foreground">货号文件夹</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {scanResult?.skuFolderCount ?? 0}
              </dd>
            </div>
            <div className="rounded-md bg-muted p-3">
              <dt className="text-muted-foreground">已有标题</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {scanResult?.titledSkuCount ?? 0}
              </dd>
            </div>
            <div className="rounded-md bg-muted p-3">
              <dt className="text-muted-foreground">可上架</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{itemCount}</dd>
            </div>
            <div className="rounded-md bg-muted p-3">
              <dt className="text-muted-foreground">警告</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{warningCount}</dd>
            </div>
          </dl>
          <div className="mt-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            缺标题警告 <span className="tabular-nums">{titleWarningCount}</span> 个
          </div>
        </div>

        <div className="rounded-md border bg-background p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-balance">真实动作覆盖</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {['替换店铺名称', '替换标题', '替换图片', '一键生成 SKU', '一键上传视频'].map(
              (item) => (
                <li className="flex items-center gap-2" key={item}>
                  <CheckCircle2 className="size-4 text-emerald-700" />
                  <span>{item}</span>
                </li>
              ),
            )}
          </ul>
          <div className="mt-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>上传图片、上传视频、生成 SKU 只会在真实运行守护允许时执行。</span>
          </div>
        </div>
      </aside>
    </div>
  )
}
