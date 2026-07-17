import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { progressPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  ListingItem,
  ListingPlatformKey,
  ListingProgress,
  ListingSkuMode,
  ListingSubmitMode,
  ListingTaskRecord,
  ListingTemplateConfig,
  ListingTemplateKey,
  ListingWorkspaceRecord,
} from '@tengyu-aipod/shared'
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BitBrowserProfile } from '../../../main/lib/bit-browser-client'
import type { BrowserProfileHolder } from '../../../main/lib/browser-profile-lock'
import type { ListingBatchLoadResult } from '../../../main/lib/listing-batch-loader'
import type { ListingStatusRow } from '../../../modules/listing/runner'
import { reconcileSelectedListingProfileIds } from './listing-workbench-profile-selection'
import { listingStartValidationIssues } from './listing-workbench-validation'

type WorkspaceProgress = {
  status: ListingProgress['status']
  currentSku?: string
  currentStage?: NonNullable<ListingProgress['currentStage']>
  finishedCount: number
  totalCount: number
  lastError?: string
}

type ListingStatusLabel = '等待' | '运行中' | '完成' | '失败' | '跳过'

type ListingOperationalRow = {
  key: string
  environment: string
  profileId: string
  sku: string
  stage: string
  status: ListingStatusLabel
  reason: string | null
  source: ListingStatusRow | null
}

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
  generate_sku_code: '一键生成货号',
  process_description: '处理描述',
  submit_publish: '保存草稿',
  publish_result: '验证结果',
}

const workspaceStatusLabels: Record<ListingWorkspaceRecord['status'], string> = {
  idle: '空闲',
  running: '运行中',
  paused: '已暂停',
  failed: '失败',
  completed: '完成',
}

const taskStatusLabels: Record<ListingTaskRecord['status'], string> = {
  queued: '队列',
  running: '运行中',
  paused: '已暂停',
  completed: '完成',
  failed: '失败',
}

const listingStatusLabels: Record<ListingProgress['status'], ListingStatusLabel> = {
  pending: '等待',
  uploading: '运行中',
  success: '完成',
  failed: '失败',
  skipped: '跳过',
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

function warningTitleMissing(warning: string) {
  return warning.includes('无标题')
}

function isTerminalListingStatus(status: ListingProgress['status']) {
  return status === 'success' || status === 'failed' || status === 'skipped'
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
  const [savedWorkspaces, setSavedWorkspaces] = useState<ListingWorkspaceRecord[]>([])
  const [savedTasks, setSavedTasks] = useState<ListingTaskRecord[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ListingBatchLoadResult | null>(null)
  const [statusRows, setStatusRows] = useState<ListingStatusRow[]>([])
  const [progress, setProgress] = useState<ListingProgress | null>(null)
  const [workspaceProgress, setWorkspaceProgress] = useState<Record<string, WorkspaceProgress>>({})
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [retryingSku, setRetryingSku] = useState<string | null>(null)
  const [openingEvidencePath, setOpeningEvidencePath] = useState<string | null>(null)
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
    void refreshListingPlanRecords()
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
  const activeWorkspace = savedWorkspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const activeWorkspaceTasks = savedTasks.filter((task) => task.workspace_id === activeWorkspaceId)
  const runningTasks = savedTasks.filter((task) => task.status === 'running')
  const queuedTasks = savedTasks.filter((task) => task.status === 'queued')
  const failedTasks = savedTasks.filter((task) => task.status === 'failed')
  const itemCount = scanResult?.listingItems.length ?? 0
  const warningCount = scanResult?.warnings.length ?? 0
  const titleWarningCount = scanResult?.warnings.filter(warningTitleMissing).length ?? 0
  const failedRows = useMemo(
    () => statusRows.filter((row) => row.status === 'failed'),
    [statusRows],
  )
  const workspaceByProfileId = useMemo(
    () => new Map(savedWorkspaces.map((workspace) => [workspace.profile_id, workspace])),
    [savedWorkspaces],
  )
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  )
  const unsavedProfiles = profiles.filter((profile) => !workspaceByProfileId.has(profile.id))
  const operationalRows = useMemo(() => {
    const nextRows: ListingOperationalRow[] = statusRows.map((row) => {
      const runtime = workspaceProgress[row.workspace_id]
      const isCurrentSku = runtime?.currentSku === row.sku_code
      return {
        key: `${row.workspace_id}-${row.sku_code}`,
        environment:
          workspaceByProfileId.get(row.workspace_id)?.profile_name ??
          profileById.get(row.workspace_id)?.name ??
          row.workspace_id,
        profileId: row.workspace_id,
        sku: row.sku_code,
        stage:
          isCurrentSku && runtime.currentStage
            ? (stageLabels[runtime.currentStage] ?? runtime.currentStage)
            : '—',
        status: listingStatusLabels[row.status],
        reason: row.last_error ?? (isCurrentSku ? (runtime.lastError ?? null) : null),
        source: row,
      }
    })
    const persistedKeys = new Set(nextRows.map((row) => `${row.profileId}-${row.sku}`))
    for (const [profileId, runtime] of Object.entries(workspaceProgress)) {
      if (!runtime.currentSku || persistedKeys.has(`${profileId}-${runtime.currentSku}`)) {
        continue
      }
      nextRows.unshift({
        key: `live-${profileId}-${runtime.currentSku}`,
        environment:
          workspaceByProfileId.get(profileId)?.profile_name ??
          profileById.get(profileId)?.name ??
          profileId,
        profileId,
        sku: runtime.currentSku,
        stage: runtime.currentStage
          ? (stageLabels[runtime.currentStage] ?? runtime.currentStage)
          : '—',
        status: listingStatusLabels[runtime.status],
        reason: runtime.lastError ?? null,
        source: null,
      })
    }
    return nextRows
  }, [profileById, statusRows, workspaceByProfileId, workspaceProgress])
  const estimatedMinutes = Math.max(
    0,
    Math.ceil((itemCount * 4) / Math.max(1, selectedProfileIds.length)),
  )
  const validationIssues = listingStartValidationIssues({
    batchDir,
    draftTemplateId,
    itemCount,
    selectedProfileCount: selectedProfileIds.length,
    targetShopName,
  })
  const canStart = Boolean(selectedTemplate) && validationIssues.length === 0 && !starting

  const refreshStatusRows = useCallback(async () => {
    if (!batchDir.trim()) {
      setStatusRows([])
      return
    }
    setStatusLoading(true)
    try {
      const rows = await window.api.listing.listStatus({
        batchDir: batchDir.trim(),
        platform: selectedPlatform,
      })
      setStatusRows(rows)
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setStatusLoading(false)
    }
  }, [batchDir, selectedPlatform])

  useEffect(() => {
    if (progress && isTerminalListingStatus(progress.status)) {
      void refreshStatusRows()
      void refreshListingPlanRecords()
    }
  }, [progress, refreshStatusRows])

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

  async function refreshListingPlanRecords() {
    try {
      const [workspaces, tasks] = await Promise.all([
        window.api.listing.listSavedWorkspaces(),
        window.api.listing.listTasks(),
      ])
      setSavedWorkspaces(workspaces)
      setSavedTasks(tasks)
      setActiveWorkspaceId((current) => {
        if (current && workspaces.some((workspace) => workspace.id === current)) {
          return current
        }
        return workspaces[0]?.id ?? null
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }

  async function chooseBatchDir() {
    const result = await window.api.listing.chooseBatchDir()
    if (result.ok) {
      setBatchDir(result.data.path)
      setScanResult(null)
      setStatusRows([])
    }
  }

  async function scanBatchDir() {
    if (!batchDir.trim()) {
      setError('请选择素材目录')
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
      await refreshStatusRows()
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
        return reconcileSelectedListingProfileIds(current, nextProfiles)
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoadingProfiles(false)
    }
  }

  async function startListing() {
    if (!selectedTemplate || !scanResult || !canStart) {
      setError(validationIssues[0] ?? '请先完成批次扫描，并填写店铺名')
      return
    }
    setStarting(true)
    setError(null)
    setProgress(null)
    setWorkspaceProgress({})
    setStatusRows([])
    try {
      const editUrl = editUrlFromTemplate(selectedTemplate, draftTemplateId)
      const template: ListingTemplateConfig = {
        ...selectedTemplate,
        editUrl,
        skuMode,
      }
      const orchestrationTasks = []
      for (const profile of selectedProfiles) {
        const workspace = await window.api.listing.saveWorkspace({
          profile_id: profile.id,
          profile_name: profile.name || profile.id,
          platform: template.platform,
        })
        const task = await window.api.listing.createTask({
          workspace_id: workspace.id,
          platform: template.platform,
          template_key: template.key,
          draft_template_id: draftTemplateId.trim(),
          shop_name: targetShopName.trim(),
          batch_dir: batchDir.trim(),
          sku_mode: skuMode,
          submit_mode: submitMode,
          max_attempts: parseIntInput(maxAttempts, 2, 1, 5),
          fail_streak_limit: parseIntInput(failStreakLimit, 3, 1, 10),
          resume,
        })
        orchestrationTasks.push({ task, workspace })
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
          workspaces: orchestrationTasks.map(({ task, workspace }) => ({
            profile_id: workspace.profile_id,
            task_id: task.id,
            workspace_id: workspace.id,
          })),
          submit_mode: submitMode,
          max_attempts: parseIntInput(maxAttempts, 2, 1, 5),
          fail_streak_limit: parseIntInput(failStreakLimit, 3, 1, 10),
          resume,
          timeout_ms: 30_000,
        },
        items,
      })
      setRunningTaskId(taskId)
      await refreshListingPlanRecords()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setStarting(false)
    }
  }

  async function openEvidence(row: ListingStatusRow) {
    if (!row.evidence_dir) {
      setError('这条失败记录还没有证据目录')
      return
    }
    setOpeningEvidencePath(row.evidence_dir)
    try {
      const result = await window.api.listing.openPath({ path: row.evidence_dir })
      setError(result.ok ? null : result.error.message)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setOpeningEvidencePath(null)
    }
  }

  async function retryFailedRows(rows: ListingStatusRow[], retryLabel: string) {
    if (!selectedTemplate || !scanResult) {
      setError('请先扫描批次，再重试失败货号')
      return
    }
    if (!targetShopName.trim() || !draftTemplateId.trim()) {
      setError('请先填写店铺名和模板编号，再重试失败货号')
      return
    }
    const itemBySku = new Map(scanResult.listingItems.map((item) => [item.sku, item]))
    const rowsByWorkspace = new Map<string, ListingStatusRow[]>()
    for (const row of rows) {
      if (!itemBySku.has(row.sku_code)) {
        continue
      }
      rowsByWorkspace.set(row.workspace_id, [...(rowsByWorkspace.get(row.workspace_id) ?? []), row])
    }
    const retryWorkspaceIds = Array.from(rowsByWorkspace.keys())
    if (retryWorkspaceIds.length === 0) {
      setError('没有匹配当前批次的失败货号')
      return
    }

    setRetryingSku(retryLabel)
    setStarting(true)
    setError(null)
    setProgress(null)
    setWorkspaceProgress({})
    try {
      setSelectedProfileIds((current) => Array.from(new Set([...current, ...retryWorkspaceIds])))
      const template: ListingTemplateConfig = {
        ...selectedTemplate,
        editUrl: editUrlFromTemplate(selectedTemplate, draftTemplateId),
        skuMode,
      }
      const taskIds: string[] = []
      for (const [profileId, workspaceRows] of rowsByWorkspace.entries()) {
        const retryItems: ListingItem[] = workspaceRows
          .map((row) => itemBySku.get(row.sku_code))
          .filter((item): item is ListingItem => Boolean(item))
          .map((item) => ({
            ...item,
            platform: template.platform,
            templateKey: template.key,
            editUrl: template.editUrl,
            targetShopName: targetShopName.trim(),
          }))
        const taskId = await window.api.listing.run({
          config: {
            batch_dir: batchDir.trim(),
            platform: template.platform,
            template,
            workspaces: [{ profile_id: profileId }],
            submit_mode: submitMode,
            max_attempts: parseIntInput(maxAttempts, 2, 1, 5),
            fail_streak_limit: parseIntInput(failStreakLimit, 3, 1, 10),
            resume: true,
            retry_failed_only: true,
            timeout_ms: 30_000,
          },
          items: retryItems,
        })
        taskIds.push(taskId)
      }
      setRunningTaskId(taskIds.join(', '))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setStarting(false)
      setRetryingSku(null)
    }
  }

  function applyTaskToForm(task: ListingTaskRecord) {
    setTemplateKey(task.template_key)
    setBatchDir(task.batch_dir)
    setDraftTemplateId(task.draft_template_id)
    setTargetShopName(task.shop_name)
    setSkuMode(task.sku_mode)
    setSubmitMode(task.submit_mode)
    setMaxAttempts(String(task.max_attempts))
    setFailStreakLimit(String(task.fail_streak_limit))
    setResume(task.resume)
    const workspace = savedWorkspaces.find((item) => item.id === task.workspace_id)
    if (workspace) {
      setSelectedProfileIds([workspace.profile_id])
      setActiveWorkspaceId(workspace.id)
    }
    setScanResult(null)
    setStatusRows([])
  }

  async function deleteTask(task: ListingTaskRecord) {
    try {
      await window.api.listing.deleteTask({ taskId: task.id })
      await refreshListingPlanRecords()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
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
    setStatusRows([])
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
    setStatusRows([])
  }

  function toggleProfile(profileId: string) {
    setSelectedProfileIds((current) =>
      current.includes(profileId)
        ? current.filter((candidate) => candidate !== profileId)
        : [...current, profileId],
    )
  }

  return (
    <section aria-label="上架生产工作区" className="space-y-6">
      <section aria-label="店铺环境状态" className="rounded-md border bg-background p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-balance">店铺环境</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              一个店铺环境绑定一个比特浏览器档案，跨店铺并行，单店铺内任务串行。
            </p>
          </div>
          <Button
            onClick={() => void refreshListingPlanRecords()}
            type="button"
            variant="secondary"
          >
            刷新编排
          </Button>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {savedWorkspaces.length || unsavedProfiles.length ? (
            <>
              {savedWorkspaces.map((workspace) => {
                const profile = profileById.get(workspace.profile_id)
                const profileStatus = profile
                  ? profileStatusLabel(profile, lockByProfileId.get(profile.id))
                  : '档案未载入'
                return (
                  <button
                    className={cn(
                      'min-w-52 rounded-md border px-3 py-2 text-left text-sm',
                      activeWorkspaceId === workspace.id
                        ? 'border-primary bg-muted'
                        : 'bg-background',
                    )}
                    key={workspace.id}
                    onClick={() => setActiveWorkspaceId(workspace.id)}
                    type="button"
                  >
                    <span className="block truncate font-medium">{workspace.profile_name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {platformLabels[workspace.platform]} ·{' '}
                      {workspaceStatusLabels[workspace.status]}
                    </span>
                    <span className="mt-2 inline-flex rounded-md border px-2 py-0.5 text-xs">
                      {profileStatus}
                    </span>
                  </button>
                )
              })}
              {unsavedProfiles.map((profile) => (
                <div
                  className="min-w-52 rounded-md border bg-background px-3 py-2 text-sm"
                  key={profile.id}
                >
                  <span className="block truncate font-medium">{profile.name}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    尚未创建上架任务 · {profile.id}
                  </span>
                  <span className="mt-2 inline-flex rounded-md border px-2 py-0.5 text-xs">
                    {profileStatusLabel(profile, lockByProfileId.get(profile.id))}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
              还没有保存的店铺环境。选择浏览器档案并开始上架后会自动保存。
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 min-[1800px]:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-w-0 flex-col gap-6">
          <section
            aria-label="上架批次与设置"
            className="rounded-md border bg-background p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-balance">上架任务配置</h2>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">
                  选择货号批次、店小秘模板和比特浏览器档案后启动批量上架。
                </p>
              </div>
              <Button onClick={() => void refreshProfiles()} type="button" variant="secondary">
                {loadingProfiles ? (
                  <Loader2 className="mr-2 size-4" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                刷新档案
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
                      setStatusRows([])
                    }}
                    placeholder="/Users/.../04-上架工作区/套版-20260531-120000"
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
                  <span>草稿模板编号</span>
                  <input
                    className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setDraftTemplateId(event.target.value)}
                    placeholder="店小秘编辑页地址里的编号"
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
                  <legend className="px-1 text-sm font-medium">货号编码策略</legend>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        checked={skuMode === 'one-click-generate'}
                        onChange={() => setSkuMode('one-click-generate')}
                        type="radio"
                      />
                      一键生成货号
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

              {!error && validationIssues.length ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {validationIssues[0]}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <div className="text-sm text-muted-foreground">
                  预估 {itemCount} 个货号，约{' '}
                  <span className="tabular-nums">{estimatedMinutes}</span> 分钟
                </div>
                <Button disabled={!canStart} onClick={() => void startListing()} type="button">
                  {starting ? (
                    <Loader2 className="mr-2 size-4" />
                  ) : (
                    <Play className="mr-2 size-4" />
                  )}
                  开始上架
                </Button>
              </div>
            </div>
          </section>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-balance">任务编排</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeWorkspace
                    ? `${activeWorkspace.profile_name} 的任务队列`
                    : '选择上方店铺环境后查看任务队列'}
                </p>
              </div>
              <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">
                {activeWorkspaceTasks.length} 个任务
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {activeWorkspaceTasks.length ? (
                activeWorkspaceTasks.map((task) => (
                  <div className="rounded-md border p-3 text-sm" key={task.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">
                        {platformLabels[task.platform]} · {task.template_key}
                      </div>
                      <span className="rounded-full border px-2 py-0.5 text-xs">
                        {taskStatusLabels[task.status]}
                      </span>
                    </div>
                    <dl className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <div>
                        <dt>平台模板</dt>
                        <dd className="mt-0.5 text-foreground">{task.template_key}</dd>
                      </div>
                      <div>
                        <dt>草稿模板编号</dt>
                        <dd className="mt-0.5 text-foreground">{task.draft_template_id}</dd>
                      </div>
                      <div>
                        <dt>店铺名</dt>
                        <dd className="mt-0.5 text-foreground">{task.shop_name}</dd>
                      </div>
                      <div className="md:col-span-2">
                        <dt>批次目录</dt>
                        <dd className="mt-0.5 truncate text-foreground">{task.batch_dir}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>货号：{task.sku_mode === 'manual' ? '保留货号' : '一键生成'}</span>
                      <span>提交：{task.submit_mode === 'publish' ? '发布' : '保存草稿'}</span>
                      <span>重试：{task.max_attempts}</span>
                      <span>{task.resume ? '断点续传' : '不续传'}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        className="h-8 px-2"
                        onClick={() => applyTaskToForm(task)}
                        type="button"
                        variant="secondary"
                      >
                        复制参数
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            className="h-8 px-2"
                            disabled={task.status === 'running'}
                            type="button"
                            variant="secondary"
                          >
                            删除
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>删除上架任务</AlertDialogTitle>
                            <AlertDialogDescription>
                              将删除这条上架任务记录，已写入工作区的图片和标题文件不会被删除。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void deleteTask(task)}>
                              删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                  暂无任务。配置批次、模板、店铺和浏览器档案后点击开始上架，会自动写入任务队列。
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-balance">比特浏览器环境</h2>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">
                  不默认预选浏览器档案，开始前请手动选择要使用的店铺环境。
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
                      className={cn(
                        'flex items-start gap-3 rounded-md border p-3 text-sm',
                        selected ? 'border-primary bg-muted' : 'bg-background',
                        locked ? 'opacity-70' : null,
                      )}
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
                  暂无浏览器档案，点击刷新读取比特浏览器。
                </div>
              )}
            </div>
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-balance">执行中店铺环境</h2>
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
                  选择浏览器档案后显示每个店铺环境进度。
                </div>
              )}
            </div>
          </div>

          <section
            aria-label="上架运行状态"
            className="order-first rounded-md border bg-background p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-balance">店铺环境与货号状态</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {operationalRows.length
                    ? `当前显示 ${operationalRows.length} 条状态，失败 ${failedRows.length} 条`
                    : '运行开始后按店铺环境逐行显示当前阶段和结果'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={statusLoading || !batchDir.trim()}
                  onClick={() => void refreshStatusRows()}
                  type="button"
                  variant="secondary"
                >
                  {statusLoading ? (
                    <Loader2 className="mr-2 size-4" />
                  ) : (
                    <RefreshCw className="mr-2 size-4" />
                  )}
                  刷新
                </Button>
                <Button
                  disabled={!failedRows.length || starting || retryingSku !== null}
                  onClick={() => void retryFailedRows(failedRows, '全部失败货号')}
                  type="button"
                  variant="secondary"
                >
                  {retryingSku === '全部失败货号' ? (
                    <Loader2 className="mr-2 size-4" />
                  ) : (
                    <RotateCcw className="mr-2 size-4" />
                  )}
                  全部重试失败
                </Button>
              </div>
            </div>

            <div className="mt-4 max-h-[520px] overflow-auto rounded-md border">
              <table className="w-full min-w-[820px] table-fixed text-left text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="w-40 px-3 py-2 font-medium">店铺环境</th>
                    <th className="w-28 px-3 py-2 font-medium">货号</th>
                    <th className="w-32 px-3 py-2 font-medium">当前阶段</th>
                    <th className="w-20 px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">失败原因</th>
                    <th className="w-52 px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {operationalRows.length ? (
                    operationalRows.map((row) => (
                      <tr className="border-t align-top" key={row.key}>
                        <td className="px-3 py-3">
                          <div className="truncate font-medium">{row.environment}</div>
                          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                            {row.profileId}
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs">{row.sku}</td>
                        <td className="px-3 py-3 text-muted-foreground">{row.stage}</td>
                        <td className="px-3 py-3">
                          <span className="inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-xs">
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div
                            className={cn(
                              'max-h-16 overflow-y-auto break-words text-muted-foreground',
                              row.reason ? 'text-red-700' : null,
                            )}
                          >
                            {row.reason ?? '—'}
                          </div>
                          {row.source?.last_error_code ? (
                            <div className="mt-1 font-mono text-xs text-red-700">
                              {row.source.last_error_code}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              className="h-8 whitespace-nowrap px-2"
                              disabled={
                                !row.source?.evidence_dir ||
                                openingEvidencePath === row.source.evidence_dir
                              }
                              onClick={() => {
                                if (row.source) void openEvidence(row.source)
                              }}
                              type="button"
                              variant="secondary"
                            >
                              查看证据
                            </Button>
                            <Button
                              className="h-8 whitespace-nowrap px-2"
                              disabled={
                                row.source?.status !== 'failed' || starting || retryingSku !== null
                              }
                              onClick={() => {
                                if (row.source) {
                                  void retryFailedRows([row.source], row.sku)
                                }
                              }}
                              type="button"
                              variant="secondary"
                            >
                              {retryingSku === row.sku ? (
                                <Loader2 className="mr-2 size-3.5" />
                              ) : (
                                <RotateCcw className="mr-2 size-3.5" />
                              )}
                              重试该货号
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                        colSpan={6}
                      >
                        暂无运行明细。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="space-y-6 min-[1800px]:sticky min-[1800px]:top-24 min-[1800px]:self-start">
          <div className="rounded-md border bg-background p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-balance">当前运行</h2>
            {runningTasks.length ? (
              <div className="mt-4 space-y-3">
                {runningTasks.map((task) => (
                  <div className="rounded-md border px-3 py-2 text-sm" key={task.id}>
                    <div className="truncate font-medium">{task.shop_name}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {platformLabels[task.platform]} · {task.template_key}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {progress?.currentSku ? `当前货号：${progress.currentSku}` : '等待进度'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">暂无运行中的上架任务。</p>
            )}
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-balance">队列</h2>
            {queuedTasks.length ? (
              <div className="mt-4 space-y-2">
                {queuedTasks.slice(0, 5).map((task) => (
                  <button
                    className="block w-full rounded-md border px-3 py-2 text-left text-sm"
                    key={task.id}
                    onClick={() => setActiveWorkspaceId(task.workspace_id)}
                    type="button"
                  >
                    <span className="block truncate font-medium">{task.shop_name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {task.batch_dir}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">暂无等待任务。</p>
            )}
          </div>

          <div className="rounded-md border bg-background p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-balance">失败队列</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {failedTasks.length} 个失败任务，{failedRows.length} 个失败货号。
            </p>
            <Button
              className="mt-4 w-full"
              disabled={!failedRows.length || starting || retryingSku !== null}
              onClick={() => void retryFailedRows(failedRows, '全部失败货号')}
              type="button"
              variant="secondary"
            >
              {retryingSku === '全部失败货号' ? (
                <Loader2 className="mr-2 size-4" />
              ) : (
                <RotateCcw className="mr-2 size-4" />
              )}
              全部重试
            </Button>
          </div>

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
              {['替换店铺名称', '替换标题', '替换图片', '一键生成货号', '一键上传视频'].map(
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
              <span>上传图片、上传视频、生成货号只会在真实运行守护允许时执行。</span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
