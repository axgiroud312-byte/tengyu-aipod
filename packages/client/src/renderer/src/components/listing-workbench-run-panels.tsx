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
import { t } from '@/locale/t'
import type {
  ListingProgress,
  ListingTaskRecord,
  ListingWorkspaceRecord,
} from '@tengyu-aipod/shared'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, Square } from 'lucide-react'
import type { BitBrowserProfile } from '../../../main/lib/bit-browser-client'
import type { BrowserProfileHolder } from '../../../main/lib/browser-profile-lock'
import type { ListingBatchLoadResult } from '../../../main/lib/listing-batch-loader'
import type { ListingStatusRow } from '../../../modules/listing/runner'
import {
  type ListingOperationalRow,
  type WorkspaceProgress,
  listingPlatformLabels,
  listingStageLabels,
  listingTaskStatusLabels,
  profileStatusLabel,
} from './listing-workbench-view-model'

type AsyncAction = () => void | Promise<void>

export function ListingTaskPlanPanel({
  activeWorkspace,
  activeWorkspaceTasks,
  onApplyTask,
  onDeleteTask,
}: {
  activeWorkspace: ListingWorkspaceRecord | undefined
  activeWorkspaceTasks: ListingTaskRecord[]
  onApplyTask: (task: ListingTaskRecord) => void
  onDeleteTask: (task: ListingTaskRecord) => void | Promise<void>
}) {
  return (
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
                  {listingPlatformLabels[task.platform]} · {task.template_key}
                </div>
                <span className="rounded-full border px-2 py-0.5 text-xs">
                  {listingTaskStatusLabels[task.status]}
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
                  onClick={() => onApplyTask(task)}
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
                      <AlertDialogAction onClick={() => void onDeleteTask(task)}>
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
  )
}

export function ListingProfileSelectionPanel({
  lockByProfileId,
  onToggleProfile,
  profiles,
  selectedProfileIds,
}: {
  lockByProfileId: ReadonlyMap<string, BrowserProfileHolder>
  onToggleProfile: (profileId: string) => void
  profiles: BitBrowserProfile[]
  selectedProfileIds: string[]
}) {
  return (
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
                  onChange={() => onToggleProfile(profile.id)}
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
  )
}

export function ListingRunProgressPanel({
  onStop,
  progress,
  runningTaskId,
  selectedProfiles,
  stopping,
  workspaceProgress,
}: {
  onStop: AsyncAction
  progress: ListingProgress | null
  runningTaskId: string | null
  selectedProfiles: BitBrowserProfile[]
  stopping: boolean
  workspaceProgress: Record<string, WorkspaceProgress>
}) {
  return (
    <div className="rounded-md border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-balance">执行中店铺环境</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {runningTaskId ? `任务 ${runningTaskId}` : '尚未开始'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">
            {progressPercent(progress)}%
          </span>
          {runningTaskId ? (
            <Button
              disabled={stopping}
              onClick={() => void onStop()}
              type="button"
              variant="destructive"
            >
              {stopping ? (
                <Loader2 className="mr-2 size-4" />
              ) : (
                <Square className="mr-2 size-3.5 fill-current" />
              )}
              {stopping ? t('正在停止') : t('停止上架')}
            </Button>
          ) : null}
        </div>
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
                      {row.currentStage ? listingStageLabels[row.currentStage] : '—'}
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
  )
}

export function ListingStatusTable({
  batchDir,
  failedRows,
  onOpenEvidence,
  onRefresh,
  onRetry,
  openingEvidencePath,
  rows,
  retryingSku,
  starting,
  statusLoading,
}: {
  batchDir: string
  failedRows: ListingStatusRow[]
  onOpenEvidence: (row: ListingStatusRow) => void | Promise<void>
  onRefresh: AsyncAction
  onRetry: (rows: ListingStatusRow[], retryLabel: string) => void | Promise<void>
  openingEvidencePath: string | null
  rows: ListingOperationalRow[]
  retryingSku: string | null
  starting: boolean
  statusLoading: boolean
}) {
  return (
    <section
      aria-label="上架运行状态"
      className="order-first rounded-md border bg-background p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-balance">店铺环境与货号状态</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length
              ? `当前显示 ${rows.length} 条状态，失败 ${failedRows.length} 条`
              : '运行开始后按店铺环境逐行显示当前阶段和结果'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={statusLoading || !batchDir.trim()}
            onClick={() => void onRefresh()}
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
            onClick={() => void onRetry(failedRows, '全部失败货号')}
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
            {rows.length ? (
              rows.map((row) => (
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
                          if (row.source) void onOpenEvidence(row.source)
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
                          if (row.source) void onRetry([row.source], row.sku)
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
                <td className="px-3 py-10 text-center text-sm text-muted-foreground" colSpan={6}>
                  暂无运行明细。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ListingRunSidebar({
  failedRows,
  failedTasks,
  itemCount,
  onRetry,
  onSelectWorkspace,
  progress,
  queuedTasks,
  retryingSku,
  runningTasks,
  scanResult,
  starting,
  titleWarningCount,
  warningCount,
}: {
  failedRows: ListingStatusRow[]
  failedTasks: ListingTaskRecord[]
  itemCount: number
  onRetry: (rows: ListingStatusRow[], retryLabel: string) => void | Promise<void>
  onSelectWorkspace: (workspaceId: string) => void
  progress: ListingProgress | null
  queuedTasks: ListingTaskRecord[]
  retryingSku: string | null
  runningTasks: ListingTaskRecord[]
  scanResult: ListingBatchLoadResult | null
  starting: boolean
  titleWarningCount: number
  warningCount: number
}) {
  return (
    <aside className="space-y-6 min-[1800px]:sticky min-[1800px]:top-24 min-[1800px]:self-start">
      <div className="rounded-md border bg-background p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-balance">当前运行</h2>
        {runningTasks.length ? (
          <div className="mt-4 space-y-3">
            {runningTasks.map((task) => (
              <div className="rounded-md border px-3 py-2 text-sm" key={task.id}>
                <div className="truncate font-medium">{task.shop_name}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {listingPlatformLabels[task.platform]} · {task.template_key}
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
                onClick={() => onSelectWorkspace(task.workspace_id)}
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
          onClick={() => void onRetry(failedRows, '全部失败货号')}
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
          {['替换店铺名称', '替换标题', '替换图片', '一键生成货号', '一键上传视频'].map((item) => (
            <li className="flex items-center gap-2" key={item}>
              <CheckCircle2 className="size-4 text-emerald-700" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>上传图片、上传视频、生成货号只会在真实运行守护允许时执行。</span>
        </div>
      </div>
    </aside>
  )
}
