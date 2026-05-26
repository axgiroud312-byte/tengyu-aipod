import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  Download,
  Globe2,
  History,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  StopCircle,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CollectionRecordRow } from '../../../../main/lib/collection-record-store'
import type { CollectionSession } from '../../../../main/lib/collection-session-manager'
import type { CollectionMode } from '../../../../main/lib/collection-session-manager'
import type { CollectionPauseReason } from '../../../../main/lib/collection-session-manager'
import type { CollectionSessionStatus } from '../../../../main/lib/collection-session-manager'

export type CollectionPlatformKey = string

export interface CollectionPlatformOption {
  key: CollectionPlatformKey
  label: string
  detail: string
}

export interface CollectionProfileOption {
  id: string
  label: string
  detail: string
  online: boolean
}

export interface CollectionPageState {
  platform: CollectionPlatformKey
  profileId: string
  mode: CollectionMode
  outputDir: string
  scrollKeywords: string
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

interface CollectionPageProps {
  session: CollectionSession | null
  records: CollectionRecordRow[]
  error: string | null
  platforms: CollectionPlatformOption[]
  profiles: CollectionProfileOption[]
  state: CollectionPageState
  starting: boolean
  stopping: boolean
  resuming: boolean
  refreshingProfiles: boolean
  retryingRecordId: string | null
  deletingRecordId: string | null
  onStateChange: <K extends keyof CollectionPageState>(
    key: K,
    value: CollectionPageState[K],
  ) => void
  onRefreshProfiles: () => void
  onStartSession: () => void
  onStopSession: () => void
  onResumeSession: () => void
  onRetryRecord: (recordId: string) => void
  onDeleteRecord: (recordId: string) => void
  onRefreshRecords: () => void
  onOutputDirBrowse: () => void
}

function collectionStatusLabel(status: CollectionRecordRow['status']) {
  switch (status) {
    case 'success':
      return '成功'
    case 'skipped':
      return '跳过'
    default:
      return '失败'
  }
}

function collectionStatusClassName(status: CollectionRecordRow['status']) {
  switch (status) {
    case 'success':
      return 'text-emerald-700'
    case 'skipped':
      return 'text-amber-700'
    default:
      return 'text-red-700'
  }
}

function collectionReasonLabel(reason: string | null | undefined) {
  switch (reason) {
    case 'dedup':
      return '重复图片，已跳过'
    case 'not_goods_page':
      return '当前不是商品详情页'
    case 'sku_required':
      return '等待填写采集货号'
    default:
      return reason ?? null
  }
}

function sessionStatusLabel(status: CollectionSessionStatus | undefined) {
  switch (status) {
    case 'starting':
      return '启动中'
    case 'active':
      return '进行中'
    case 'paused':
      return '已暂停'
    case 'stopping':
      return '停止中'
    case 'completed':
      return '已完成'
    default:
      return '未开始'
  }
}

function pauseReasonLabel(reason: CollectionPauseReason | undefined) {
  switch (reason) {
    case 'manual_intervention':
      return '需要手动处理'
    case 'browser_closed':
      return '比特浏览器已关闭'
    case 'window_closed':
      return '主窗口已关闭'
    default:
      return '会话已暂停'
  }
}

function platformLabel(value: string, platforms: CollectionPlatformOption[]) {
  return platforms.find((item) => item.key === value)?.label ?? value
}

function platformEntryUrl(value: string, platforms: CollectionPlatformOption[]) {
  return platforms.find((item) => item.key === value)?.detail ?? null
}

function fileNameFromPath(path: string | null | undefined) {
  if (!path) {
    return '未保存'
  }
  return path.split(/[\\/]/).at(-1) || path
}

function sessionTone(session: CollectionSession | null) {
  if (!session) {
    return 'border-slate-200 bg-slate-50 text-slate-900'
  }
  if (session.status === 'paused') {
    return 'border-amber-200 bg-amber-50 text-amber-950'
  }
  if (session.status === 'active') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-950'
  }
  return 'border-slate-200 bg-slate-50 text-slate-900'
}

function sessionBadgeVariant(session: CollectionSession | null) {
  if (!session) {
    return 'secondary'
  }
  if (session.status === 'paused') {
    return 'destructive'
  }
  if (session.status === 'active') {
    return 'default'
  }
  return 'secondary'
}

function currentSessionSummary(
  session: CollectionSession | null,
  records: CollectionRecordRow[],
  platforms: CollectionPlatformOption[],
) {
  const failedCount = records.filter((record) => record.status === 'failed').length
  const successCount = records.filter((record) => record.status === 'success').length
  const latestUrl =
    records[0]?.pageUrl ?? (session ? platformEntryUrl(session.platform, platforms) : null) ?? '-'
  return { failedCount, successCount, latestUrl }
}

function relativeTimeLabel(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) {
    return `${seconds} 秒前`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }
  return `${Math.floor(hours / 24)} 天前`
}

function latestRecordLabel(record: CollectionRecordRow | undefined, now: number) {
  if (!record) {
    return '0 张 · 等待用户在浏览器内操作'
  }
  return `最近一张 ${relativeTimeLabel(record.createdAt, now)}`
}

function sizeThresholdFromInput(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export function CollectionPage({
  session,
  records,
  error,
  platforms,
  profiles,
  state,
  starting,
  stopping,
  resuming,
  refreshingProfiles,
  retryingRecordId,
  deletingRecordId,
  onStateChange,
  onRefreshProfiles,
  onStartSession,
  onStopSession,
  onResumeSession,
  onRetryRecord,
  onDeleteRecord,
  onRefreshRecords,
  onOutputDirBrowse,
}: CollectionPageProps) {
  const isIdle = !session
  const isPaused = session?.status === 'paused'
  const sessionId = session?.id
  const [relativeNow, setRelativeNow] = useState(() => Date.now())
  useEffect(() => {
    if (!sessionId) {
      return
    }
    const timer = window.setInterval(() => {
      setRelativeNow(Date.now())
    }, 5000)
    return () => {
      window.clearInterval(timer)
    }
  }, [sessionId])
  const summary = currentSessionSummary(session, records, platforms)
  const currentPlatformLabel = platformLabel(state.platform, platforms)
  const recentRecords = records.slice(0, 20)

  return (
    <div className="space-y-6">
      <div className={cn('rounded-lg border p-5 shadow-sm', sessionTone(session))}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant={sessionBadgeVariant(session)}>
                {isIdle ? '当前无活动会话' : sessionStatusLabel(session.status)}
              </Badge>
              {session ? (
                <span className="text-sm font-medium">
                  {platformLabel(session.platform, platforms)} ·{' '}
                  {session.mode === 'click' ? '点击采集' : '滚动采集'}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {isIdle
                ? '先完成平台、环境、模式和输出目录配置，再开始采集会话。'
                : session?.pause_reason
                  ? `暂停原因：${pauseReasonLabel(session.pause_reason)}`
                  : '会话运行中，保持浏览器页面打开即可。'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {isIdle ? (
              <Button disabled={starting} onClick={onStartSession} type="button">
                <PlayCircle className="mr-2 h-4 w-4" />
                {starting ? '启动中...' : '开始采集会话'}
              </Button>
            ) : (
              <>
                <Button onClick={onRefreshRecords} type="button" variant="secondary">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  刷新清单
                </Button>
                {isPaused ? (
                  <Button disabled={resuming} onClick={onResumeSession} type="button">
                    <PlayCircle className="mr-2 h-4 w-4" />
                    {resuming ? '恢复中...' : '恢复'}
                  </Button>
                ) : null}
                <Button disabled={stopping} onClick={onStopSession} type="button">
                  <StopCircle className="mr-2 h-4 w-4" />
                  {stopping ? '停止中...' : '停止会话'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {isIdle ? (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="shadow-sm">
                <CardHeader className="space-y-2">
                  <CardTitle className="text-lg">1. 选择采集平台</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    选择当前店铺对应的平台规则，后续会影响监听和原图提取。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {platforms.length ? (
                    <RadioGroup
                      className="grid grid-cols-2 gap-2"
                      onValueChange={(value) => onStateChange('platform', value)}
                      value={state.platform}
                    >
                      {platforms.map((item) => (
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
                            state.platform === item.key
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:bg-muted',
                          )}
                          htmlFor={`collection-platform-${item.key}`}
                          key={item.key}
                        >
                          <RadioGroupItem id={`collection-platform-${item.key}`} value={item.key} />
                          <div className="min-w-0">
                            <div className="font-medium">{item.label}</div>
                            <div className="text-xs text-muted-foreground">{item.detail}</div>
                          </div>
                        </label>
                      ))}
                    </RadioGroup>
                  ) : (
                    <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
                      暂无平台规则。
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-lg">2. 选择比特浏览器环境</CardTitle>
                    <Button
                      disabled={refreshingProfiles}
                      onClick={onRefreshProfiles}
                      type="button"
                      variant="secondary"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      {refreshingProfiles ? '刷新中...' : '刷新列表'}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    未打开的环境也可以选择，开始时只打开或前置平台采集页。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                    {profiles.length ? (
                      profiles.map((profile) => (
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 text-sm',
                            state.profileId === profile.id ? 'bg-background shadow-xs' : '',
                          )}
                          htmlFor={`collection-profile-${profile.id}`}
                          key={profile.id}
                        >
                          <Checkbox
                            checked={state.profileId === profile.id}
                            id={`collection-profile-${profile.id}`}
                            onCheckedChange={() => onStateChange('profileId', profile.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{profile.label}</span>
                              <Badge variant={profile.online ? 'default' : 'secondary'}>
                                {profile.online ? '已打开' : '未打开'}
                              </Badge>
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {profile.detail}
                            </div>
                          </div>
                        </label>
                      ))
                    ) : (
                      <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
                        暂无列表，先手动填写浏览器环境编号。
                      </div>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <label className="space-y-2 text-sm font-medium" htmlFor="profile-id">
                      <span>手动输入浏览器环境编号</span>
                      <Input
                        id="profile-id"
                        onChange={(event) => onStateChange('profileId', event.target.value)}
                        placeholder="请输入比特浏览器环境编号"
                        value={state.profileId}
                      />
                    </label>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="space-y-2">
                  <CardTitle className="text-lg">3. 采集模式</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    点击采集适合单个商品，滚动采集适合批量瀑布流页面。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RadioGroup
                    className="grid gap-2 md:grid-cols-2"
                    onValueChange={(value) => onStateChange('mode', value as CollectionMode)}
                    value={state.mode}
                  >
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm',
                        state.mode === 'click' ? 'border-primary bg-primary/5' : 'border-border',
                      )}
                      htmlFor="collection-mode-click"
                    >
                      <RadioGroupItem id="collection-mode-click" value="click" />
                      <div>
                        <div className="font-medium">点击采集</div>
                        <div className="text-xs text-muted-foreground">推荐，按商品归档</div>
                      </div>
                    </label>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm',
                        state.mode === 'scroll' ? 'border-primary bg-primary/5' : 'border-border',
                      )}
                      htmlFor="collection-mode-scroll"
                    >
                      <RadioGroupItem id="collection-mode-scroll" value="scroll" />
                      <div>
                        <div className="font-medium">滚动采集</div>
                        <div className="text-xs text-muted-foreground">瀑布流批量保存</div>
                      </div>
                    </label>
                  </RadioGroup>

                  <div className="rounded-md border bg-muted/40 p-4">
                    <div className="text-sm font-medium">尺寸过滤（0 = 不限制）</div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label
                        className="grid gap-2 text-sm font-medium"
                        htmlFor="collection-min-width"
                      >
                        <span>最小宽度</span>
                        <Input
                          id="collection-min-width"
                          min={0}
                          onChange={(event) =>
                            onStateChange('minWidth', sizeThresholdFromInput(event.target.value))
                          }
                          step={1}
                          type="number"
                          value={state.minWidth}
                        />
                      </label>
                      <label
                        className="grid gap-2 text-sm font-medium"
                        htmlFor="collection-max-width"
                      >
                        <span>最大宽度</span>
                        <Input
                          id="collection-max-width"
                          min={0}
                          onChange={(event) =>
                            onStateChange('maxWidth', sizeThresholdFromInput(event.target.value))
                          }
                          step={1}
                          type="number"
                          value={state.maxWidth}
                        />
                      </label>
                      <label
                        className="grid gap-2 text-sm font-medium"
                        htmlFor="collection-min-height"
                      >
                        <span>最小高度</span>
                        <Input
                          id="collection-min-height"
                          min={0}
                          onChange={(event) =>
                            onStateChange('minHeight', sizeThresholdFromInput(event.target.value))
                          }
                          step={1}
                          type="number"
                          value={state.minHeight}
                        />
                      </label>
                      <label
                        className="grid gap-2 text-sm font-medium"
                        htmlFor="collection-max-height"
                      >
                        <span>最大高度</span>
                        <Input
                          id="collection-max-height"
                          min={0}
                          onChange={(event) =>
                            onStateChange('maxHeight', sizeThresholdFromInput(event.target.value))
                          }
                          step={1}
                          type="number"
                          value={state.maxHeight}
                        />
                      </label>
                    </div>
                  </div>

                  {state.mode === 'scroll' ? (
                    <div className="rounded-md border bg-muted/40 p-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <Search className="h-4 w-4 text-primary" />
                        滚动过滤设置
                      </div>
                      <Input
                        value={state.scrollKeywords}
                        onChange={(event) => onStateChange('scrollKeywords', event.target.value)}
                        placeholder="输入关键词，多个请用逗号分隔"
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="space-y-2">
                  <CardTitle className="text-lg">4. 输出目录</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    建议放在素材总目录下，采集会话结束后自动导出清单。
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      className="h-11 min-w-0 flex-1"
                      id="collection-output-dir"
                      onChange={(event) => onStateChange('outputDir', event.target.value)}
                      value={state.outputDir}
                    />
                    <Button
                      className="h-11"
                      onClick={onOutputDirBrowse}
                      type="button"
                      variant="secondary"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      清空
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    留空时会使用素材总目录下的 01-采集。
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="lg:sticky lg:top-6 lg:self-start">
              <Card className="shadow-sm">
                <CardHeader className="space-y-2">
                  <CardTitle className="text-lg">开始前检查</CardTitle>
                  <p className="text-sm text-muted-foreground">主操作在首屏内可见</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 rounded-md border bg-muted/40 p-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Globe2 className="h-4 w-4 text-primary" />
                      <span className="font-medium">{currentPlatformLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-primary" />
                      <span className="truncate">{state.profileId || '未选择浏览器环境'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Download className="h-4 w-4 text-primary" />
                      <span className="truncate">{state.outputDir || '未设置输出目录'}</span>
                    </div>
                  </div>

                  <div className="grid gap-2 rounded-md border bg-background p-4 text-sm">
                    <div className="text-xs text-muted-foreground">
                      开始后只会打开或前置所选平台的采集页。
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">成功</span>
                      <span className="font-medium tabular-nums">{summary.successCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">失败</span>
                      <span className="font-medium tabular-nums">{summary.failedCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">当前页面</span>
                      <span className="truncate text-right text-xs text-muted-foreground">
                        {summary.latestUrl}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {isIdle ? (
                      <Button
                        className="h-11"
                        disabled={starting}
                        onClick={onStartSession}
                        type="button"
                      >
                        <PlayCircle className="mr-2 h-4 w-4" />
                        {starting ? '启动中...' : '开始采集会话'}
                      </Button>
                    ) : (
                      <>
                        <Button onClick={onRefreshRecords} type="button">
                          <RefreshCw className="mr-2 h-4 w-4" />
                          刷新清单
                        </Button>
                        <Button
                          disabled={stopping}
                          onClick={onStopSession}
                          type="button"
                          variant="secondary"
                        >
                          <StopCircle className="mr-2 h-4 w-4" />
                          {stopping ? '停止中...' : '停止会话'}
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {isPaused ? (
                <Card className="mt-4 border-amber-200 bg-amber-50 shadow-sm">
                  <CardHeader className="space-y-2">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <PauseCircle className="h-5 w-5 text-amber-700" />
                      会话已暂停
                    </CardTitle>
                    <p className="text-sm text-amber-950">
                      浏览器关闭、离开允许域或窗口关闭都会触发暂停。
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-md border border-amber-200 bg-background p-3 text-sm">
                      暂停后不会丢失当前会话清单，下次恢复后继续监听。
                    </div>
                    <Button
                      disabled={resuming}
                      onClick={onResumeSession}
                      type="button"
                      variant="secondary"
                    >
                      {resuming ? '恢复中...' : '恢复'}
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-6">
              <Card className="shadow-sm">
                <CardHeader className="flex-row items-start justify-between space-y-0 p-5">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">采集进度</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {session
                        ? `${platformLabel(session.platform, platforms)} · ${session.profile_id}`
                        : '无活动会话'}
                    </p>
                  </div>
                  <Badge variant={sessionBadgeVariant(session)}>
                    {sessionStatusLabel(session?.status)}
                  </Badge>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  <div className="grid gap-4 rounded-md border bg-muted/40 p-4 md:grid-cols-[180px_minmax(0,1fr)]">
                    <div>
                      <div className="text-xs text-muted-foreground">已采集</div>
                      <div className="mt-1 text-3xl font-semibold tabular-nums">
                        {records.length}
                        <span className="ml-1 text-base font-medium">张</span>
                      </div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <div className="text-sm font-medium">
                        {latestRecordLabel(records[0], relativeNow)}
                      </div>
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="break-all">{summary.latestUrl}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="flex-row items-start justify-between space-y-0 p-5">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">最近保存</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {session
                        ? `${platformLabel(session.platform, platforms)} · ${session.profile_id}`
                        : '无活动会话'}
                    </p>
                  </div>
                  <Button onClick={onRefreshRecords} type="button" variant="secondary">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    刷新
                  </Button>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  <div className="mt-4 space-y-3">
                    {recentRecords.length ? (
                      recentRecords.map((record) => (
                        <div
                          className="grid gap-3 rounded-md border px-3 py-3 text-sm md:grid-cols-[96px_minmax(0,1fr)_auto]"
                          key={record.id}
                        >
                          {record.savedPath && record.status !== 'failed' ? (
                            <img
                              alt=""
                              className="h-16 w-24 rounded-md border object-cover"
                              src={`file://${record.savedPath}`}
                            />
                          ) : (
                            <div className="flex h-16 w-24 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                              无预览
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {fileNameFromPath(record.savedPath)}
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {record.goodsLink ?? record.pageUrl}
                            </div>
                            {collectionReasonLabel(record.reason) ? (
                              <div className="mt-1 text-xs text-red-700">
                                {collectionReasonLabel(record.reason)}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2 md:justify-end">
                            <span
                              className={`text-xs font-medium ${collectionStatusClassName(record.status)}`}
                            >
                              {collectionStatusLabel(record.status)}
                            </span>
                            {record.status === 'failed' ? (
                              <Button
                                className="h-8 px-2"
                                disabled={retryingRecordId === record.id}
                                onClick={() => onRetryRecord(record.id)}
                                type="button"
                                variant="secondary"
                              >
                                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                重试
                              </Button>
                            ) : null}
                            <Button
                              className="h-8 px-2"
                              disabled={deletingRecordId === record.id}
                              onClick={() => onDeleteRecord(record.id)}
                              type="button"
                              variant="destructive"
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              {deletingRecordId === record.id ? '删除中' : '删除'}
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
                        暂无采集记录
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="sticky top-6 self-start shadow-sm">
              <CardHeader className="space-y-2">
                <CardTitle className="text-lg">当前会话</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {session
                    ? `${platformLabel(session.platform, platforms)} · ${
                        session.mode === 'click' ? '点击采集' : '滚动采集'
                      }`
                    : '当前没有活动会话'}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3 rounded-md border bg-muted/40 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">状态</span>
                    <Badge variant={session?.status === 'paused' ? 'destructive' : 'secondary'}>
                      {sessionStatusLabel(session?.status)}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">输出目录</span>
                    <span className="max-w-48 truncate text-right text-xs">
                      {session?.output_dir ?? '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">成功</span>
                    <span className="font-medium tabular-nums">{summary.successCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">失败</span>
                    <span className="font-medium tabular-nums">{summary.failedCount}</span>
                  </div>
                </div>

                <div className="rounded-md border border-dashed bg-background p-4 text-sm text-muted-foreground">
                  {isPaused ? (
                    <div className="flex items-start gap-2">
                      <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-600" />
                      <span>暂停会话不会清空记录，恢复后继续监听。</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 text-primary" />
                      <span>开始前请确认浏览器环境已登录并且输出目录可写。</span>
                    </div>
                  )}
                </div>
                {isPaused ? (
                  <Button
                    className="w-full"
                    disabled={resuming}
                    onClick={onResumeSession}
                    type="button"
                  >
                    <PlayCircle className="mr-2 h-4 w-4" />
                    {resuming ? '恢复中...' : '恢复采集'}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
