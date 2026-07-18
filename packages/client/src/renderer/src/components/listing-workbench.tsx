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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/locale/t'
import type {
  ListingDistributionMode,
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
import { AlertTriangle, FolderOpen, Loader2, Play, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BitBrowserProfile } from '../../../main/lib/bit-browser-client'
import type { BrowserProfileHolder } from '../../../main/lib/browser-profile-lock'
import type { ListingBatchLoadResult } from '../../../main/lib/listing-batch-loader'
import type { ListingStatusRow } from '../../../modules/listing/runner'
import { createListingDistributionPreview } from './listing-workbench-distribution'
import { reconcileSelectedListingProfileIds } from './listing-workbench-profile-selection'
import {
  ListingProfileSelectionPanel,
  ListingRunProgressPanel,
  ListingRunSidebar,
  ListingStatusTable,
  ListingTaskPlanPanel,
} from './listing-workbench-run-panels'
import { listingStartValidationIssues } from './listing-workbench-validation'
import {
  type WorkspaceProgress,
  createListingOperationalRows,
  listingPlatformLabels,
  listingWorkspaceStatusLabels,
  profileStatusLabel,
} from './listing-workbench-view-model'

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

function warningTitleMissing(warning: string) {
  return warning.includes('无标题')
}

function isTerminalListingStatus(status: ListingProgress['status']) {
  return (
    status === 'success' || status === 'failed' || status === 'skipped' || status === 'cancelled'
  )
}

export function ListingWorkbench() {
  const [templates, setTemplates] = useState<ListingTemplateConfig[]>([])
  const [templateKey, setTemplateKey] = useState<ListingTemplateKey>('temu-clothing')
  const [batchDir, setBatchDir] = useState('')
  const [draftTemplateId, setDraftTemplateId] = useState('')
  const [targetShopName, setTargetShopName] = useState('')
  const [skuMode, setSkuMode] = useState<ListingSkuMode>('one-click-generate')
  const [submitMode, setSubmitMode] = useState<ListingSubmitMode>('save-draft')
  const [distributionMode, setDistributionMode] =
    useState<ListingDistributionMode>('all-workspaces')
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
  const activeBatchIdsRef = useRef<Set<string>>(new Set())
  const scanRequestIdRef = useRef(0)
  const statusRequestIdRef = useRef(0)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [startConfirmationOpen, setStartConfirmationOpen] = useState(false)
  const [retryingSku, setRetryingSku] = useState<string | null>(null)
  const [openingEvidencePath, setOpeningEvidencePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
        label: listingPlatformLabels[platform],
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
  const distributionPreview = createListingDistributionPreview(
    itemCount,
    selectedProfiles.map((profile) => profile.id),
    distributionMode,
  )
  const allocationByProfileId = new Map(
    distributionPreview.allocations.map((allocation) => [allocation.profileId, allocation.count]),
  )
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
  const operationalRows = useMemo(
    () =>
      createListingOperationalRows({
        profiles,
        statusRows,
        workspaceProgress,
        workspaces: savedWorkspaces,
      }),
    [profiles, savedWorkspaces, statusRows, workspaceProgress],
  )
  const validationIssues = listingStartValidationIssues({
    batchDir,
    draftTemplateId,
    itemCount,
    selectedProfileCount: selectedProfileIds.length,
    targetShopName,
  })
  const canStart =
    Boolean(selectedTemplate) && validationIssues.length === 0 && !starting && !runningTaskId

  const refreshStatusRows = useCallback(async () => {
    const requestId = statusRequestIdRef.current + 1
    statusRequestIdRef.current = requestId
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
      if (statusRequestIdRef.current !== requestId) {
        return
      }
      setStatusRows(rows)
      setError(null)
    } catch (nextError) {
      if (statusRequestIdRef.current === requestId) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    } finally {
      if (statusRequestIdRef.current === requestId) {
        setStatusLoading(false)
      }
    }
  }, [batchDir, selectedPlatform])

  useEffect(() => {
    if (progress && isTerminalListingStatus(progress.status)) {
      void refreshStatusRows()
      void refreshListingPlanRecords()
    }
  }, [progress, refreshStatusRows])

  function handleProgress(nextProgress: ListingProgress) {
    if (!activeBatchIdsRef.current.has(nextProgress.batchId)) {
      return
    }
    setProgress(nextProgress)
    if (!nextProgress.profileId) {
      if (isTerminalListingStatus(nextProgress.status)) {
        activeBatchIdsRef.current.delete(nextProgress.batchId)
        const remainingTaskIds = Array.from(activeBatchIdsRef.current)
        setRunningTaskId(remainingTaskIds.length ? remainingTaskIds.join(', ') : null)
        if (remainingTaskIds.length === 0) {
          setStopping(false)
        }
        if (nextProgress.status === 'cancelled') {
          setNotice(t('上架任务已停止，未启动的货号已跳过'))
        }
      }
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

  function resetOperationalState() {
    activeBatchIdsRef.current.clear()
    scanRequestIdRef.current += 1
    statusRequestIdRef.current += 1
    setScanResult(null)
    setStatusRows([])
    setWorkspaceProgress({})
    setProgress(null)
    setRunningTaskId(null)
    setStopping(false)
    setStartConfirmationOpen(false)
    setNotice(null)
    setScanning(false)
    setStatusLoading(false)
  }

  async function chooseBatchDir() {
    const result = await window.api.listing.chooseBatchDir()
    if (result.ok) {
      setBatchDir(result.data.path)
      resetOperationalState()
    }
  }

  async function scanBatchDir() {
    if (!batchDir.trim()) {
      setError('请选择素材目录')
      return
    }
    const requestId = scanRequestIdRef.current + 1
    scanRequestIdRef.current = requestId
    setScanning(true)
    setError(null)
    try {
      const result = await window.api.listing.scanBatchDir({
        batchDir: batchDir.trim(),
        templateKey,
      })
      if (scanRequestIdRef.current !== requestId) {
        return
      }
      setScanResult(result)
      await refreshStatusRows()
    } catch (nextError) {
      if (scanRequestIdRef.current === requestId) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    } finally {
      if (scanRequestIdRef.current === requestId) {
        setScanning(false)
      }
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
    setStartConfirmationOpen(false)
    setError(null)
    setNotice(null)
    setProgress(null)
    setWorkspaceProgress({})
    setStatusRows([])
    activeBatchIdsRef.current.clear()
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
          distribution_mode: distributionMode,
          submit_mode: submitMode,
          max_attempts: parseIntInput(maxAttempts, 2, 1, 5),
          fail_streak_limit: parseIntInput(failStreakLimit, 3, 1, 10),
          resume,
          timeout_ms: 30_000,
        },
        items,
      })
      activeBatchIdsRef.current.add(taskId)
      setRunningTaskId(taskId)
      await refreshListingPlanRecords()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setStarting(false)
    }
  }

  function requestStartListing() {
    if (!selectedTemplate || !scanResult || !canStart) {
      setError(
        validationIssues[0] ?? (runningTaskId ? t('当前上架任务尚未结束') : t('请先完成批次扫描')),
      )
      return
    }
    if (selectedProfiles.length > 1 || submitMode === 'publish') {
      setStartConfirmationOpen(true)
      return
    }
    void startListing()
  }

  async function stopListing() {
    const taskIds = Array.from(activeBatchIdsRef.current)
    if (taskIds.length === 0) {
      setError(t('当前没有可停止的上架任务'))
      return
    }
    setStopping(true)
    setError(null)
    try {
      const results = await Promise.all(
        taskIds.map((taskId) => window.api.listing.cancel({ task_id: taskId })),
      )
      if (!results.some((result) => result.ok)) {
        setStopping(false)
        setError(t('上架任务已结束，无需再停止'))
        return
      }
      setNotice(t('已请求停止，当前货号完成后不再启动后续货号'))
    } catch (nextError) {
      setStopping(false)
      setError(nextError instanceof Error ? nextError.message : String(nextError))
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
    activeBatchIdsRef.current.clear()
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
        activeBatchIdsRef.current.add(taskId)
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
    resetOperationalState()
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
    resetOperationalState()
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
    resetOperationalState()
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
                      {listingPlatformLabels[workspace.platform]} ·{' '}
                      {listingWorkspaceStatusLabels[workspace.status]}
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
                      resetOperationalState()
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
                      {t('直接发布')}
                    </label>
                  </div>
                </fieldset>
              </div>

              <fieldset className="rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">{t('多店分配方式')}</legend>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm',
                      distributionMode === 'all-workspaces'
                        ? 'border-primary bg-muted'
                        : 'bg-background',
                    )}
                  >
                    <input
                      checked={distributionMode === 'all-workspaces'}
                      className="mt-0.5"
                      onChange={() => setDistributionMode('all-workspaces')}
                      type="radio"
                    />
                    <span>
                      <span className="block font-medium">{t('每个店铺上架全部货号')}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t('适合同一批商品同时发布到多个店铺')}
                      </span>
                    </span>
                  </label>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm',
                      distributionMode === 'round-robin'
                        ? 'border-primary bg-muted'
                        : 'bg-background',
                    )}
                  >
                    <input
                      checked={distributionMode === 'round-robin'}
                      className="mt-0.5"
                      onChange={() => setDistributionMode('round-robin')}
                      type="radio"
                    />
                    <span>
                      <span className="block font-medium">{t('货号平均分配到店铺')}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t('每个货号只进入一个店铺，按已选顺序轮询分配')}
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

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

              <section aria-label={t('上架分配预览')} className="border-y bg-muted/40 px-1 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{t('分配预览')}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {distributionMode === 'all-workspaces'
                        ? t('所有已选店铺都会收到完整货号批次')
                        : t('货号会尽量均匀地拆分到已选店铺')}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">
                    {t('共')} {distributionPreview.totalOperations} {t('次上架操作')}
                  </span>
                </div>
                {selectedProfiles.length ? (
                  <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
                    {selectedProfiles.map((profile) => (
                      <div
                        className="flex min-w-0 items-center justify-between gap-3"
                        key={profile.id}
                      >
                        <span className="truncate text-sm">{profile.name || profile.id}</span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {allocationByProfileId.get(profile.id) ?? 0} {t('个货号')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t('选择店铺环境后显示每店精确数量。')}
                  </p>
                )}
              </section>

              {error ? (
                <div
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {error}
                </div>
              ) : null}

              {notice ? (
                <output
                  aria-live="polite"
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                >
                  {notice}
                </output>
              ) : null}

              {!error && validationIssues.length ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {validationIssues[0]}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <div className="text-sm text-muted-foreground">
                  {itemCount} {t('个货号')} · {distributionPreview.totalOperations} {t('次操作')} ·{' '}
                  {t('约')}{' '}
                  <span className="tabular-nums">{distributionPreview.estimatedMinutes}</span>{' '}
                  {t('分钟')}
                </div>
                <Button disabled={!canStart} onClick={requestStartListing} type="button">
                  {starting ? (
                    <Loader2 className="mr-2 size-4" />
                  ) : (
                    <Play className="mr-2 size-4" />
                  )}
                  开始上架
                </Button>
              </div>

              <AlertDialog open={startConfirmationOpen} onOpenChange={setStartConfirmationOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('确认启动上架')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('请核对批次、店铺和提交方式。启动后会按下列分配执行。')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <dl className="divide-y rounded-md border text-sm">
                    <div className="grid gap-1 px-3 py-2 sm:grid-cols-[100px_minmax(0,1fr)]">
                      <dt className="text-muted-foreground">{t('批次')}</dt>
                      <dd className="break-all font-medium">{batchDir}</dd>
                    </div>
                    <div className="grid gap-1 px-3 py-2 sm:grid-cols-[100px_minmax(0,1fr)]">
                      <dt className="text-muted-foreground">{t('模板')}</dt>
                      <dd className="font-medium">
                        {selectedTemplate?.label ?? '—'} · {draftTemplateId.trim() || '—'}
                      </dd>
                    </div>
                    <div className="grid gap-1 px-3 py-2 sm:grid-cols-[100px_minmax(0,1fr)]">
                      <dt className="text-muted-foreground">{t('店铺分配')}</dt>
                      <dd className="space-y-1">
                        {selectedProfiles.map((profile) => (
                          <div className="flex items-center justify-between gap-3" key={profile.id}>
                            <span className="truncate font-medium">
                              {profile.name || profile.id}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {allocationByProfileId.get(profile.id) ?? 0} {t('个货号')}
                            </span>
                          </div>
                        ))}
                      </dd>
                    </div>
                    <div className="grid gap-1 px-3 py-2 sm:grid-cols-[100px_minmax(0,1fr)]">
                      <dt className="text-muted-foreground">{t('总操作数')}</dt>
                      <dd className="font-semibold tabular-nums">
                        {distributionPreview.totalOperations} {t('次')}
                      </dd>
                    </div>
                    <div className="grid gap-1 px-3 py-2 sm:grid-cols-[100px_minmax(0,1fr)]">
                      <dt className="text-muted-foreground">{t('提交方式')}</dt>
                      <dd className="font-semibold">
                        {submitMode === 'publish' ? t('直接发布') : t('保存草稿')}
                      </dd>
                    </div>
                  </dl>
                  {submitMode === 'publish' ? (
                    <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>{t('直接发布会将商品提交到目标店铺，不会停留在草稿箱。')}</span>
                    </div>
                  ) : null}
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('返回检查')}</AlertDialogCancel>
                    <AlertDialogAction
                      className={
                        submitMode === 'publish'
                          ? 'bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-700'
                          : undefined
                      }
                      onClick={() => void startListing()}
                    >
                      {submitMode === 'publish' ? t('确认直接发布') : t('确认开始')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </section>

          <ListingTaskPlanPanel
            activeWorkspace={activeWorkspace}
            activeWorkspaceTasks={activeWorkspaceTasks}
            onApplyTask={applyTaskToForm}
            onDeleteTask={deleteTask}
          />

          <ListingProfileSelectionPanel
            lockByProfileId={lockByProfileId}
            onToggleProfile={toggleProfile}
            profiles={profiles}
            selectedProfileIds={selectedProfileIds}
          />

          <ListingRunProgressPanel
            onStop={stopListing}
            progress={progress}
            runningTaskId={runningTaskId}
            selectedProfiles={selectedProfiles}
            stopping={stopping}
            workspaceProgress={workspaceProgress}
          />

          <ListingStatusTable
            batchDir={batchDir}
            failedRows={failedRows}
            onOpenEvidence={openEvidence}
            onRefresh={refreshStatusRows}
            onRetry={retryFailedRows}
            openingEvidencePath={openingEvidencePath}
            retryingSku={retryingSku}
            rows={operationalRows}
            starting={starting}
            statusLoading={statusLoading}
          />
        </section>

        <ListingRunSidebar
          failedRows={failedRows}
          failedTasks={failedTasks}
          itemCount={itemCount}
          onRetry={retryFailedRows}
          onSelectWorkspace={setActiveWorkspaceId}
          progress={progress}
          queuedTasks={queuedTasks}
          retryingSku={retryingSku}
          runningTasks={runningTasks}
          scanResult={scanResult}
          starting={starting}
          titleWarningCount={titleWarningCount}
          warningCount={warningCount}
        />
      </div>
    </section>
  )
}
