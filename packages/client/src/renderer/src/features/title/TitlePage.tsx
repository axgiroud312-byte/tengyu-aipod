import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { VISION_MODEL_PRICES, type VisionModelKey } from '@tengyu-aipod/shared'
import { Calculator, FolderOpen, Loader2, Play, RotateCcw, ScanLine } from 'lucide-react'
import type {
  TitleBatchConfig,
  TitleBatchResult,
  TitleProgress,
} from '../../../../main/lib/title-service'

export type TitleExistingStrategy = NonNullable<TitleBatchConfig['existingStrategy']>

export type TitleOption = {
  key: string
  label: string
}

export type TitleScanSummary = {
  skuCount: number
  existingTitles: Record<string, string>
}

export type TitleFormState = {
  batchDir: string
  platform: string
  language: string
  model: string
  imageIndex: string
  extraRequirement: string
  existingStrategy: TitleExistingStrategy
  maxRetries: string
  concurrency: string
  compression: boolean
  maxSize: string
}

export type TitlePageState = TitleFormState & {
  scanResult: TitleScanSummary | null
  progress: TitleProgress | null
  taskId: string | null
  result: TitleBatchResult | null
  isRetryingFailed: boolean
}

type TitlePageProps = {
  platforms: TitleOption[]
  languages: TitleOption[]
  models: TitleOption[]
  state: TitlePageState
  titleError: string | null
  openMessage: string | null
  onStateChange: (key: keyof TitleFormState, value: TitleFormState[keyof TitleFormState]) => void
  onChooseBatchDir: () => void
  onScanBatchDir: () => void
  onRunBatch: () => void
  onRetryFailed: () => void
  onOpenPath: (path: string) => void
}

function isVisionModelKey(value: string): value is VisionModelKey {
  return value in VISION_MODEL_PRICES
}

function estimateTitleCost(imageCount: number, model: string, compression: boolean) {
  const price = isVisionModelKey(model)
    ? VISION_MODEL_PRICES[model]
    : VISION_MODEL_PRICES['qwen3.6-flash']
  const imageTokens = compression ? 256 : 1024
  const outputTokens = 80
  return (imageCount * (imageTokens * price.input + outputTokens * price.output)) / 1_000_000
}

function progressPercent(progress: TitleProgress | null) {
  if (!progress || progress.total === 0) {
    return 0
  }
  return Math.round((progress.processed / progress.total) * 100)
}

function titleProgressText(state: TitlePageState, isRunning: boolean) {
  if (state.isRetryingFailed) {
    return '失败重试中'
  }
  if (isRunning) {
    return '处理中'
  }
  if (state.result) {
    return '完成'
  }
  if (state.taskId) {
    return '等待任务结果'
  }
  return '未开始'
}

function statItems(state: TitlePageState, existingTitleCount: number, pendingCount: number) {
  return [
    { label: '货号', value: state.scanResult?.skuCount ?? 0 },
    { label: '已有', value: existingTitleCount },
    { label: '生成', value: pendingCount },
  ]
}

export function TitlePage({
  platforms,
  languages,
  models,
  state,
  titleError,
  openMessage,
  onStateChange,
  onChooseBatchDir,
  onScanBatchDir,
  onRunBatch,
  onRetryFailed,
  onOpenPath,
}: TitlePageProps) {
  const existingTitleCount = state.scanResult
    ? Object.keys(state.scanResult.existingTitles).length
    : 0
  const pendingEstimateCount = state.scanResult
    ? state.existingStrategy === 'skip'
      ? Math.max(0, state.scanResult.skuCount - existingTitleCount)
      : state.scanResult.skuCount
    : 0
  const estimatedCost = estimateTitleCost(pendingEstimateCount, state.model, state.compression)
  const percent = progressPercent(state.progress)
  const isRunning = Boolean(
    state.progress && state.progress.processed < state.progress.total && !state.result,
  )
  const canRun = Boolean(state.batchDir.trim()) && !isRunning
  const successRows = state.result?.results.filter((item) => item.status === 'success') ?? []
  const failedRows = state.result?.results.filter((item) => item.status === 'failed') ?? []
  const progressStatusText = titleProgressText(state, isRunning)
  const batchResult = state.result

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">批次目录</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    选择 05-货号成品 下的单个批次，扫描后开始估算。
                  </p>
                </div>
                <Badge variant="secondary">{state.scanResult ? '已扫描' : '待扫描'}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div className="flex flex-col gap-2 md:flex-row">
                <Input
                  className="min-w-0 flex-1"
                  onChange={(event) => onStateChange('batchDir', event.target.value)}
                  placeholder="选择货号成品中的一个批次目录"
                  value={state.batchDir}
                />
                <Button onClick={onChooseBatchDir} type="button" variant="secondary">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  选择
                </Button>
                <Button onClick={onScanBatchDir} type="button" variant="secondary">
                  <ScanLine className="mr-2 h-4 w-4" />
                  扫描
                </Button>
              </div>
              {titleError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {titleError}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-lg">生成参数</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-5 pt-0">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="title-platform">
                    平台
                  </label>
                  <Select
                    onValueChange={(value) => onStateChange('platform', value)}
                    value={state.platform}
                  >
                    <SelectTrigger id="title-platform">
                      <SelectValue placeholder="选择平台" />
                    </SelectTrigger>
                    <SelectContent>
                      {platforms.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="title-language">
                    语言
                  </label>
                  <Select
                    onValueChange={(value) => onStateChange('language', value)}
                    value={state.language}
                  >
                    <SelectTrigger id="title-language">
                      <SelectValue placeholder="选择语言" />
                    </SelectTrigger>
                    <SelectContent>
                      {languages.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="title-model">
                    模型
                  </label>
                  <Select
                    onValueChange={(value) => onStateChange('model', value)}
                    value={state.model}
                  >
                    <SelectTrigger id="title-model">
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="title-extra-requirement">
                  标题额外要求
                </label>
                <Textarea
                  id="title-extra-requirement"
                  onChange={(event) => onStateChange('extraRequirement', event.target.value)}
                  placeholder="例如：突出原创图案、节日主题、目标人群"
                  value={state.extraRequirement}
                />
              </div>

              <Accordion collapsible type="single">
                <AccordionItem className="rounded-md border px-4" value="advanced">
                  <AccordionTrigger>高级参数</AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="title-image-index">
                          取第几张
                        </label>
                        <Input
                          className="tabular-nums"
                          id="title-image-index"
                          min={1}
                          onChange={(event) => onStateChange('imageIndex', event.target.value)}
                          type="number"
                          value={state.imageIndex}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="title-max-retries">
                          重试次数
                        </label>
                        <Input
                          className="tabular-nums"
                          id="title-max-retries"
                          max={5}
                          min={0}
                          onChange={(event) => onStateChange('maxRetries', event.target.value)}
                          type="number"
                          value={state.maxRetries}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="title-concurrency">
                          并发数
                        </label>
                        <Input
                          className="tabular-nums"
                          id="title-concurrency"
                          max={10}
                          min={1}
                          onChange={(event) => onStateChange('concurrency', event.target.value)}
                          type="number"
                          value={state.concurrency}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="title-max-size">
                          最大边长
                        </label>
                        <Input
                          className="tabular-nums"
                          id="title-max-size"
                          min={256}
                          onChange={(event) => onStateChange('maxSize', event.target.value)}
                          type="number"
                          value={state.maxSize}
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="rounded-md border p-4">
                        <div className="mb-3 text-sm font-medium">已有标题策略</div>
                        <RadioGroup
                          className="grid gap-3 sm:grid-cols-2"
                          onValueChange={(value) => {
                            if (value === 'skip' || value === 'regenerate') {
                              onStateChange('existingStrategy', value)
                            }
                          }}
                          value={state.existingStrategy}
                        >
                          <label
                            className="flex items-center gap-2 rounded-sm border px-3 py-2 text-sm"
                            htmlFor="title-existing-skip"
                          >
                            <RadioGroupItem id="title-existing-skip" value="skip" />
                            跳过已有
                          </label>
                          <label
                            className="flex items-center gap-2 rounded-sm border px-3 py-2 text-sm"
                            htmlFor="title-existing-regenerate"
                          >
                            <RadioGroupItem id="title-existing-regenerate" value="regenerate" />
                            重新生成
                          </label>
                        </RadioGroup>
                      </div>

                      <div className="rounded-md border p-4">
                        <div className="mb-3 text-sm font-medium">图像预处理</div>
                        <div className="space-y-3 text-sm">
                          <label
                            className="flex items-center gap-2 text-muted-foreground"
                            htmlFor="title-preprocess-flatten"
                          >
                            <Checkbox checked disabled id="title-preprocess-flatten" />
                            透明底自动加白
                          </label>
                          <label className="flex items-center gap-2" htmlFor="title-compression">
                            <Checkbox
                              checked={state.compression}
                              id="title-compression"
                              onCheckedChange={(checked) =>
                                onStateChange('compression', checked === true)
                              }
                            />
                            压缩图片节省费用
                          </label>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <Card className="border-primary/20">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calculator className="h-4 w-4 text-primary" />
                预估
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              <div className="rounded-md bg-primary/5 p-4">
                <div className="text-sm text-muted-foreground">待生成张数</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {pendingEstimateCount}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">预计费用</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  ¥{estimatedCost.toFixed(4)}
                </div>
              </div>
              <Button className="w-full" disabled={!canRun} onClick={onRunBatch} type="button">
                {isRunning ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                开始生成标题
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-lg">概览</CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <dl className="grid grid-cols-3 gap-2 text-sm">
                {statItems(state, existingTitleCount, pendingEstimateCount).map((item) => (
                  <div className="rounded-md bg-muted p-3" key={item.label}>
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <Separator className="my-4" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">费用</span>
                <span className="font-medium tabular-nums">¥{estimatedCost.toFixed(4)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">进度</CardTitle>
                <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-5 pt-0">
              <Progress value={percent} />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">处理</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {state.progress ? `${state.progress.processed}/${state.progress.total}` : '0/0'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">跳过</dt>
                  <dd className="mt-1 font-medium tabular-nums">{state.progress?.skipped ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">成功</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {state.progress?.succeeded ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">失败</dt>
                  <dd className="mt-1 font-medium tabular-nums">{state.progress?.failed ?? 0}</dd>
                </div>
              </dl>
              <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {progressStatusText}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      {batchResult ? (
        <Card>
          <CardHeader className="p-5 pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-lg">生成结果</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  成功 {batchResult.succeeded} 个，失败 {batchResult.failed} 个，跳过{' '}
                  {batchResult.skipped} 个
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => onOpenPath(batchResult.xlsxPath)}
                  type="button"
                  variant="secondary"
                >
                  打开表格
                </Button>
                <Button
                  onClick={() => onOpenPath(state.batchDir)}
                  type="button"
                  variant="secondary"
                >
                  打开批次目录
                </Button>
              </div>
            </div>
            {openMessage ? <p className="mt-3 text-sm text-red-700">{openMessage}</p> : null}
          </CardHeader>
          <CardContent className="grid gap-4 p-5 pt-0 lg:grid-cols-2">
            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-sm font-medium">
                成功列表（{successRows.length}）
              </div>
              <div className="max-h-60 overflow-auto p-2">
                {successRows.length ? (
                  successRows.map((item) => (
                    <div
                      className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 rounded-md px-2 py-2 text-sm"
                      key={item.skuCode}
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.skuCode}
                      </span>
                      <span className="truncate">{item.title}</span>
                    </div>
                  ))
                ) : (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    暂无成功项
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
                <span>失败列表（{failedRows.length}）</span>
                <Button
                  className="h-8 px-2"
                  disabled={!failedRows.length}
                  onClick={onRetryFailed}
                  type="button"
                  variant="secondary"
                >
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  重试失败
                </Button>
              </div>
              <div className="max-h-60 overflow-auto p-2">
                {failedRows.length ? (
                  failedRows.map((item) => (
                    <div className="rounded-md px-2 py-2 text-sm" key={item.skuCode}>
                      <div className="font-mono text-xs text-muted-foreground">{item.skuCode}</div>
                      <div className="mt-1 text-red-700">{item.error}</div>
                    </div>
                  ))
                ) : (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    没有失败项
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
