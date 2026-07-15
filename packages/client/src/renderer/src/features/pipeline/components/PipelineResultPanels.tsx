import { ImageLightbox, type ImageLightboxItem } from '@/components/image-lightbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  finalPipelineResult,
  pipelineResultStats,
  sectionItemsForLightbox,
  selectedPipelineResultPreview,
} from '@/features/pipeline/pipeline-result-preview'
import { fileUrlLocalPath, localImageUrl } from '@/lib/media'
import type {
  PipelineItemRecord,
  PipelineProgress,
  PipelineResultImage,
  PipelineResultSection,
  PipelineRunConfig,
  PipelineRunRecord,
} from '@tengyu-aipod/shared'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  ImageIcon,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'

function pipelineResultImageSrc(image: PipelineResultImage) {
  const localPath = image.local_path ?? image.source_path ?? fileUrlLocalPath(image.url ?? '')
  return localPath ? localImageUrl(localPath) : (image.url ?? '')
}

function pipelineResultImageRawPath(image: PipelineResultImage | null) {
  return image?.local_path ?? image?.source_path ?? image?.url ?? null
}

function pipelineResultLightboxItem(image: PipelineResultImage): ImageLightboxItem {
  const riskLabel =
    image.risk_level === 'pass'
      ? '无风险'
      : image.risk_level === 'review'
        ? '疑似'
        : image.risk_level === 'block'
          ? '高风险'
          : null
  return {
    alt: image.label,
    title: image.label,
    src: pipelineResultImageSrc(image),
    ...(riskLabel
      ? {
          eyebrow: `${image.allowed ? '通过' : '未通过'} · ${riskLabel}${
            image.risk_score === undefined ? '' : ` · 风险值 ${image.risk_score}`
          }`,
        }
      : {}),
    ...(image.prompt || image.reason
      ? {
          note: (
            <div className="space-y-3">
              {image.prompt ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">提示词</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{image.prompt}</p>
                </div>
              ) : null}
              {image.reason ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">判断原因</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{image.reason}</p>
                </div>
              ) : null}
            </div>
          ),
        }
      : {}),
    details: [
      ...(image.print_id ? [{ label: '印花 ID', value: image.print_id, mono: true }] : []),
      ...(image.artifact_id
        ? [{ label: 'Artifact ID', value: image.artifact_id, mono: true }]
        : []),
      ...(image.risk_level ? [{ label: '风险等级', value: riskLabel ?? image.risk_level }] : []),
      ...(image.risk_score === undefined ? [] : [{ label: '风险值', value: image.risk_score }]),
      ...(image.local_path ? [{ label: '图片路径', value: image.local_path, mono: true }] : []),
      ...(image.source_path ? [{ label: '来源路径', value: image.source_path, mono: true }] : []),
    ],
  }
}

function pipelineRawImageSrc(pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) {
    return undefined
  }
  if (/^(?:tengyu-local-image|file|https?):\/\//i.test(pathOrUrl)) {
    return pathOrUrl
  }
  return localImageUrl(pathOrUrl)
}

function formatPipelineLogDetails(details?: Record<string, unknown>) {
  if (!details) {
    return ''
  }
  const entries = Object.entries(details).filter(([, value]) => value !== undefined && value !== '')
  if (!entries.length) {
    return ''
  }
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' ')
}

function pipelineProgressStatusLabel(status: PipelineProgress['status'] | undefined) {
  const labels: Record<PipelineProgress['status'], string> = {
    cancelled: '已取消',
    completed: '已完成',
    failed: '失败',
    interrupted: '已中断',
    running: '运行中',
  }
  return status ? labels[status] : '未启动'
}

export function PipelineLogDialog({
  logs,
  open,
  onOpenChange,
}: {
  logs: NonNullable<PipelineProgress['logs']>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-5xl gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle className="text-base">完整任务日志</DialogTitle>
        </DialogHeader>
        <div className="max-h-[68vh] overflow-auto bg-zinc-950 p-4 font-mono text-xs text-zinc-100">
          {logs.length ? (
            logs.map((entry) => (
              <div
                className={
                  entry.level === 'error'
                    ? 'text-red-300'
                    : entry.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-zinc-100'
                }
                key={entry.id}
              >
                {new Date(entry.created_at).toLocaleTimeString()} [{entry.level.toUpperCase()}]{' '}
                {entry.step_key ? `[${entry.step_key}] ` : ''}
                {entry.message}
                {formatPipelineLogDetails(entry.details)
                  ? ` ${formatPipelineLogDetails(entry.details)}`
                  : ''}
              </div>
            ))
          ) : (
            <div className="text-zinc-500">暂无日志</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PipelineResultsPanel({
  config,
  message,
  progress,
}: {
  config: PipelineRunConfig
  message: string
  progress: PipelineProgress | null
}) {
  const sections = progress?.result_sections ?? []
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [pages, setPages] = useState<Record<string, number>>({})
  const [lightbox, setLightbox] = useState<{
    title: string
    items: ImageLightboxItem[]
    index: number
  } | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [heroImageIndex, setHeroImageIndex] = useState<number | null>(null)
  const finalResult = finalPipelineResult(config, progress)
  const stats = pipelineResultStats(config, progress)
  const selectedSection = finalResult?.section ?? null
  const resultPreview = selectedPipelineResultPreview(
    selectedSection,
    selectedGroupId,
    heroImageIndex,
  )
  const selectedGroup = resultPreview.selectedGroup
  const selectedImage = resultPreview.activeImage
  const heroImagePath =
    pipelineResultImageRawPath(selectedImage) ?? selectedGroup?.cover_path ?? null
  const heroTitle = selectedGroup?.label ?? selectedImage?.label ?? '等待结果'
  const heroImageCountLabel = resultPreview.images.length
    ? `${resultPreview.activeImageIndex + 1}/${resultPreview.images.length}`
    : null
  const heroSubtitle =
    (selectedGroup
      ? [heroImageCountLabel, selectedGroup.subtitle].filter(Boolean).join(' · ')
      : heroImageCountLabel) ??
    (selectedSection ? `${selectedSection.completed}/${selectedSection.total}` : message)

  function toggleSection(key: string) {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }))
  }

  function updatePage(key: string, delta: number, maxPage: number) {
    setPages((current) => {
      const next = Math.max(0, Math.min(maxPage, (current[key] ?? 0) + delta))
      return { ...current, [key]: next }
    })
  }

  function openLightbox(section: PipelineResultSection, image: PipelineResultImage) {
    const sectionItems = sectionItemsForLightbox(section)
    const previewItems = sectionItems.filter(
      (item) => item.status === 'success' && pipelineResultImageSrc(item),
    )
    const items = previewItems.map(pipelineResultLightboxItem)
    const index = previewItems.findIndex((item) => item.id === image.id)
    setLightbox({ title: section.title, items, index: Math.max(0, index) })
  }

  function selectGroup(groupId: string) {
    setSelectedGroupId(groupId)
    setHeroImageIndex(null)
  }

  function updateHeroImage(delta: number) {
    setHeroImageIndex((current) =>
      Math.max(
        0,
        Math.min(
          resultPreview.images.length - 1,
          (current ?? resultPreview.activeImageIndex) + delta,
        ),
      ),
    )
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/30 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg text-balance">
              <ImageIcon className="size-5" />
              最终成果
            </CardTitle>
            <CardDescription>{message}</CardDescription>
          </div>
          <Badge variant="secondary">{pipelineProgressStatusLabel(progress?.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section
            aria-label="最终成果主画布"
            className="relative min-h-[360px] max-h-[560px] aspect-video overflow-hidden rounded-md border border-zinc-800 bg-zinc-950"
          >
            {heroImagePath ? (
              <button
                aria-label={`放大查看 ${heroTitle}`}
                className="group block h-full min-h-[360px] w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                onClick={() => {
                  if (selectedSection && selectedImage) {
                    openLightbox(selectedSection, selectedImage)
                  }
                }}
                type="button"
              >
                <img
                  alt={heroTitle}
                  className="h-full min-h-[360px] w-full object-contain"
                  loading="lazy"
                  src={pipelineRawImageSrc(heroImagePath)}
                />
                <span className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-md border border-white/20 bg-black/60 text-white opacity-80 backdrop-blur transition-opacity group-hover:opacity-100">
                  <Maximize2 className="size-4" />
                </span>
              </button>
            ) : (
              <div className="flex min-h-[360px] items-center justify-center bg-muted text-sm text-muted-foreground">
                <div className="flex flex-col items-center gap-2 px-4 text-center">
                  <ImageIcon className="size-6" />
                  <span>启动完整任务后，这里会展示当前最终产物。</span>
                </div>
              </div>
            )}
            {resultPreview.images.length > 1 ? (
              <div className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
                <Button
                  aria-label="上一张"
                  className="pointer-events-auto size-9 rounded-full bg-background/90 p-0 shadow-sm backdrop-blur"
                  disabled={resultPreview.activeImageIndex <= 0}
                  onClick={() => updateHeroImage(-1)}
                  type="button"
                  variant="secondary"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  aria-label="下一张"
                  className="pointer-events-auto size-9 rounded-full bg-background/90 p-0 shadow-sm backdrop-blur"
                  disabled={resultPreview.activeImageIndex >= resultPreview.images.length - 1}
                  onClick={() => updateHeroImage(1)}
                  type="button"
                  variant="secondary"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            ) : null}
            <div className="absolute inset-x-0 bottom-0 bg-slate-950/85 p-4 text-white">
              <div className="truncate text-xl font-semibold">{heroTitle}</div>
              <div className="mt-1 truncate text-sm text-white/70">{heroSubtitle}</div>
            </div>
          </section>

          <div className="rounded-md border bg-background p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {finalResult?.mode === 'groups' ? (
                  <Folder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ImageIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold">
                    {finalResult?.mode === 'groups' ? '套版成果墙' : '成果墙'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {finalResult?.mode === 'groups'
                      ? '按模板批次和货号显示最终产物。'
                      : '展示当前任务最后阶段的产物。'}
                  </div>
                </div>
              </div>
              <Badge variant="outline">
                {resultPreview.groups.length || selectedSection?.completed || 0}
              </Badge>
            </div>

            {resultPreview.groups.length ? (
              <div className="grid max-h-[430px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                {resultPreview.groups.map((group) => (
                  <button
                    aria-pressed={group.id === selectedGroup?.id}
                    className={`min-w-0 rounded-md border p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                      group.id === selectedGroup?.id
                        ? 'border-primary bg-primary/10 shadow-sm'
                        : 'bg-muted/20'
                    }`}
                    key={group.id}
                    onClick={() => selectGroup(group.id)}
                    type="button"
                  >
                    {group.cover_path ? (
                      <img
                        alt={group.label}
                        className="aspect-[4/3] w-full rounded-sm bg-muted object-cover"
                        loading="lazy"
                        src={pipelineRawImageSrc(group.cover_path)}
                      />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center rounded-sm bg-muted text-muted-foreground">
                        <FolderOpen className="size-5" />
                      </div>
                    )}
                    <div className="mt-2 truncate text-xs font-medium">{group.label}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {group.subtitle ?? `${group.items.length} 张`}
                    </div>
                  </button>
                ))}
              </div>
            ) : selectedSection?.items.length ? (
              <div className="grid max-h-[430px] grid-cols-2 gap-3 overflow-y-auto pr-1">
                {selectedSection.items
                  .filter((item) => item.status === 'success' && pipelineResultImageSrc(item))
                  .map((image, index) => (
                    <button
                      aria-label={`查看 ${image.label}`}
                      aria-pressed={image.id === selectedImage?.id}
                      className={`min-w-0 rounded-md border p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                        image.id === selectedImage?.id
                          ? 'border-primary bg-primary/10 shadow-sm'
                          : 'bg-muted/20'
                      }`}
                      key={image.id}
                      onClick={() => setHeroImageIndex(index)}
                      type="button"
                    >
                      <img
                        alt={image.label}
                        className="aspect-[4/3] w-full rounded-sm bg-muted object-cover"
                        loading="lazy"
                        src={pipelineResultImageSrc(image)}
                      />
                      <div className="mt-2 truncate text-xs font-medium">{image.label}</div>
                    </button>
                  ))}
              </div>
            ) : (
              <div className="flex min-h-[280px] items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                等待结果
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {stats.map((item) => (
            <div className="rounded-md border bg-background p-3" key={item.key}>
              <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
            </div>
          ))}
        </div>

        {sections.length ? (
          <div className="space-y-3">
            {sections
              .filter((section) => section.key !== selectedSection?.key)
              .map((section) => {
                const isCollapsed = collapsed[section.key] ?? section.default_collapsed ?? true
                const pageSize = 12
                const maxPage = Math.max(0, Math.ceil(section.items.length / pageSize) - 1)
                const page = Math.min(pages[section.key] ?? 0, maxPage)
                const visibleItems = section.paginated
                  ? section.items.slice(page * pageSize, page * pageSize + pageSize)
                  : section.items
                return (
                  <section className="rounded-md border bg-background p-4" key={section.key}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => toggleSection(section.key)}
                        type="button"
                      >
                        <ChevronDown
                          className={`size-4 shrink-0 transition-transform ${
                            isCollapsed ? '-rotate-90' : ''
                          }`}
                        />
                        <span className="truncate font-semibold">{section.title}</span>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {section.completed}/{section.total}
                        </span>
                        {section.failed ? (
                          <span className="text-sm tabular-nums text-muted-foreground">
                            失败 {section.failed}
                          </span>
                        ) : null}
                      </button>
                      {section.paginated && !isCollapsed ? (
                        <div className="flex items-center gap-2">
                          <Button
                            aria-label="上一页"
                            className="size-8 p-0"
                            disabled={page === 0}
                            onClick={() => updatePage(section.key, -1, maxPage)}
                            type="button"
                            variant="outline"
                          >
                            <ChevronLeft className="size-4" />
                          </Button>
                          <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
                            {page + 1}/{maxPage + 1}
                          </span>
                          <Button
                            aria-label="下一页"
                            className="size-8 p-0"
                            disabled={page >= maxPage}
                            onClick={() => updatePage(section.key, 1, maxPage)}
                            type="button"
                            variant="outline"
                          >
                            <ChevronRight className="size-4" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {isCollapsed ? null : visibleItems.length ? (
                      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                        {visibleItems.map((image) =>
                          image.status === 'loading' ? (
                            <div
                              className="flex aspect-square items-center justify-center rounded-md border border-dashed bg-muted/30 text-sm text-muted-foreground"
                              key={image.id}
                            >
                              <Loader2 className="mr-2 size-4 animate-spin" />
                              图像加载中
                            </div>
                          ) : (
                            <button
                              className="min-w-0 rounded-md border bg-muted/20 p-2 text-left transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                              key={image.id}
                              onClick={() => openLightbox(section, image)}
                              type="button"
                            >
                              <img
                                alt={image.label}
                                className="aspect-square w-full rounded-sm bg-muted object-cover"
                                loading="lazy"
                                src={pipelineResultImageSrc(image)}
                              />
                              <div className="mt-2 truncate text-xs font-medium">{image.label}</div>
                              {image.risk_level ? (
                                <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                                  风险值 {image.risk_score ?? '-'}
                                </div>
                              ) : null}
                            </button>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
                        等待结果
                      </div>
                    )}
                  </section>
                )
              })}
          </div>
        ) : null}
      </CardContent>
      <ImageLightbox
        activeIndex={lightbox?.index ?? null}
        items={lightbox?.items ?? []}
        onActiveIndexChange={(index) =>
          setLightbox((current) => {
            if (!current || index === null) {
              return null
            }
            return { ...current, index }
          })
        }
        title={lightbox?.title ?? '图片预览'}
      />
    </Card>
  )
}

function itemStatusVariant(
  status: PipelineItemRecord['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') {
    return 'destructive'
  }
  if (status === 'completed') {
    return 'default'
  }
  if (status === 'running') {
    return 'secondary'
  }
  return 'outline'
}

function itemStatusLabel(status: PipelineItemRecord['status']) {
  if (status === 'running') {
    return '进行中'
  }
  if (status === 'completed') {
    return '已完成'
  }
  if (status === 'failed') {
    return '失败'
  }
  if (status === 'filtered') {
    return '已拦截'
  }
  if (status === 'skipped') {
    return '已跳过'
  }
  if (status === 'interrupted') {
    return '已中断'
  }
  return status
}

function runStatusVariant(
  status: PipelineRunRecord['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') {
    return 'destructive'
  }
  if (status === 'completed') {
    return 'default'
  }
  if (status === 'running') {
    return 'secondary'
  }
  return 'outline'
}

function runStatusLabel(status: PipelineRunRecord['status']) {
  if (status === 'running') {
    return '进行中'
  }
  if (status === 'completed') {
    return '已完成'
  }
  if (status === 'failed') {
    return '失败'
  }
  if (status === 'cancelled') {
    return '已取消'
  }
  if (status === 'interrupted') {
    return '已中断'
  }
  return status
}

function runTimeLabel(value: number) {
  return new Date(value).toLocaleString()
}

export function PipelineRunHistoryPanel({
  currentRunId,
  loading,
  onRefresh,
  onResume,
  resumeLoading,
  runs,
}: {
  currentRunId: string | null
  loading: boolean
  onRefresh: () => void
  onResume: (runId: string) => void
  resumeLoading: boolean
  runs: PipelineRunRecord[]
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">历史记录</CardTitle>
            <CardDescription>失败或已中断的完整任务可从中断处继续。</CardDescription>
          </div>
          <Button disabled={loading} onClick={onRefresh} variant="ghost">
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {runs.length ? (
          <div className="space-y-2">
            {runs.slice(0, 12).map((run) => {
              const canResume = run.status === 'failed' || run.status === 'interrupted'
              return (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                  key={run.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{run.name}</span>
                      <Badge variant={runStatusVariant(run.status)}>
                        {runStatusLabel(run.status)}
                      </Badge>
                      {run.id === currentRunId ? <Badge variant="outline">当前</Badge> : null}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {runTimeLabel(run.created_at)}
                      {run.error_summary ? ` · ${run.error_summary}` : ''}
                    </div>
                  </div>
                  {canResume ? (
                    <Button
                      disabled={resumeLoading}
                      onClick={() => onResume(run.id)}
                      variant="outline"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      从中断处继续
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
            暂无历史记录
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function PipelineItemsPanel({ progress }: { progress: PipelineProgress | null }) {
  const items = (progress?.items ?? [])
    .filter((item) => item.status === 'failed' || item.status === 'interrupted')
    .slice()
    .sort((left, right) => right.updated_at - left.updated_at)

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">异常项</h2>
            <CardDescription>
              单项失败不会阻断其他印花，处理后可从合适阶段重新运行。
            </CardDescription>
          </div>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="space-y-2">
            {items.slice(0, 24).map((item) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                key={item.id}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.item_key}</span>
                    <Badge variant="outline">{item.step_key}</Badge>
                    <Badge variant={itemStatusVariant(item.status)}>
                      {itemStatusLabel(item.status)}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.output_path ?? item.source_path ?? '-'}
                  </div>
                  {item.error_message ? (
                    <div className="space-y-1 text-xs">
                      <div className="text-red-600">{item.error_message}</div>
                      <div className="text-muted-foreground">
                        处理建议：检查该阶段配置与外部资源，再从已有印花或中断处继续。
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {new Date(item.updated_at).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
            当前没有异常项。
          </div>
        )}
      </CardContent>
    </Card>
  )
}
