import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ActiveGenerationTaskNotice } from '@/features/generation/components/ActiveGenerationTaskNotice'
import { ComfyuiExtractMattingPanel } from '@/features/generation/components/panels/ComfyuiExtractMattingPanel'
import { ComfyuiExtractPanel } from '@/features/generation/components/panels/ComfyuiExtractPanel'
import { ComfyuiImg2imgPanel } from '@/features/generation/components/panels/ComfyuiImg2imgPanel'
import { ComfyuiMattingPanel } from '@/features/generation/components/panels/ComfyuiMattingPanel'
import { GrsaiExtractPanel } from '@/features/generation/components/panels/GrsaiExtractPanel'
import { GrsaiPromptGenerationPanel } from '@/features/generation/components/panels/GrsaiPromptGenerationPanel'
import {
  formatGenerationDebugLogLine,
  generationDebugLogLevelCounts,
  generationDebugRawResponse,
} from '@/features/generation/generation-debug-log'
import { GENERATION_DEBUG_LOG_LIMIT } from '@/features/generation/lib/constants'
import {
  type ActiveGenerationTask,
  generationDebugLogLevelClassName,
  isGenerationCapabilityKey,
} from '@/features/generation/lib/format'
import { CircleDashed, ImagePlus, Layers3, Scissors, Terminal, WandSparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GenerationDebugLogEntry } from '../../../../main/lib/generation-service'
import {
  type GenerationProvider,
  type GenerationUiCapability,
  generationCapabilities,
  generationProviders,
  isGenerationProviderAvailable,
  useGenerationStore,
} from '../../store/generation'

const capabilityIcons: Record<GenerationUiCapability, typeof WandSparkles> = {
  txt2img: WandSparkles,
  img2img: ImagePlus,
  extract: Layers3,
  matting: Scissors,
  'extract-matting': Scissors,
}

const providerNotes: Record<GenerationProvider, string> = {
  grsai: '付费模型路径，适合文生图、图生图和提取。',
  'comfyui-chenyu': '云端 ComfyUI 工作流路径，适合图生图、提取和抠图。',
}

const unavailableText: Record<GenerationUiCapability, string> = {
  txt2img: '当前组合不可用，请切换实现方式。',
  img2img: '当前组合不可用，请切换实现方式。',
  extract: '当前组合不可用，请切换实现方式。',
  matting: 'Grsai 不内置透明底抠图，请使用 ComfyUI 或后续混合路径。',
  'extract-matting': '提取后抠图只支持 ComfyUI 工作流路径。',
}

function capabilityCopy(capability: GenerationUiCapability, provider: GenerationProvider) {
  if (!isGenerationProviderAvailable(capability, provider)) {
    return {
      title: '不可用',
      description: unavailableText[capability],
    }
  }

  if (capability === 'txt2img') {
    return {
      title: '文生图表单占位',
      description: '后续接入智能生成提示词 / 自己写双模式、提示词审稿、生图设置和进度面板。',
    }
  }

  if (capability === 'img2img') {
    return {
      title: provider === 'grsai' ? 'Grsai 图生图表单占位' : 'ComfyUI 图生图工作流占位',
      description:
        provider === 'grsai'
          ? '后续接入参考构图、参考风格、构图+风格、自己写四种模式。'
          : '后续接入本地导入的图生图工作流列表和参数表单。',
    }
  }

  if (capability === 'extract') {
    return {
      title: provider === 'grsai' ? 'Grsai 提取表单占位' : 'ComfyUI 提取工作流占位',
      description:
        provider === 'grsai'
          ? '后续接入采集图多选、提取模板、参考图提示词生成和图生图执行。'
          : '后续接入提取工作流选择、源图上传和结果落盘。',
    }
  }

  return {
    title: 'ComfyUI 抠图表单占位',
    description: '后续接入抠图工作流、混合路径和透明底输出。',
  }
}

export function GenerationWorkbench() {
  const activeCapability = useGenerationStore((state) => state.activeCapability)
  const tabs = useGenerationStore((state) => state.tabs)
  const setActiveCapability = useGenerationStore((state) => state.setActiveCapability)
  const setProvider = useGenerationStore((state) => state.setProvider)
  const [activeTasks, setActiveTasks] = useState<ActiveGenerationTask[]>([])
  const [debugLogs, setDebugLogs] = useState<GenerationDebugLogEntry[]>([])
  const [isDebugLogOpen, setIsDebugLogOpen] = useState(false)
  const [expandedDebugLogId, setExpandedDebugLogId] = useState<string | null>(null)
  const debugLogEndRef = useRef<HTMLDivElement | null>(null)
  const activeProvider = tabs[activeCapability].provider
  const activeCapabilityMeta = generationCapabilities.find((item) => item.key === activeCapability)
  const activeCopy = capabilityCopy(activeCapability, activeProvider)
  const unavailable = !isGenerationProviderAvailable(activeCapability, activeProvider)
  const debugLogCounts = useMemo(() => generationDebugLogLevelCounts(debugLogs), [debugLogs])
  const debugIssueCount = debugLogCounts.warn + debugLogCounts.error

  useEffect(() => {
    return window.api.generation.onDebugLog((entry) => {
      setDebugLogs((current) => [...current, entry].slice(-GENERATION_DEBUG_LOG_LIMIT))
    })
  }, [])

  useEffect(() => {
    const offProgress = window.api.generation.onProgress((progress) => {
      if (
        progress.status === 'cancelled' ||
        (progress.total > 0 && progress.processed >= progress.total)
      ) {
        setActiveTasks((current) => current.filter((task) => task.taskId !== progress.task_id))
        return
      }
      setActiveTasks((current) => {
        const previous = current.find((task) => task.taskId === progress.task_id)
        const nextTask: ActiveGenerationTask = {
          taskId: progress.task_id,
          capability: progress.capability,
          processed: progress.processed,
          total: progress.total,
          succeeded: progress.succeeded,
          failed: progress.failed,
          ...(previous?.cancelRequested ? { cancelRequested: true } : {}),
        }
        const existing = current.findIndex((task) => task.taskId === progress.task_id)
        if (existing === -1) {
          return [...current, nextTask]
        }
        return current.map((task, index) => (index === existing ? nextTask : task))
      })
    })
    const offCompleted = window.api.generation.onCompleted((event) => {
      const taskId = event.ok ? event.result.taskId : event.taskId
      setActiveTasks((current) => current.filter((task) => task.taskId !== taskId))
    })
    return () => {
      offProgress()
      offCompleted()
    }
  }, [])

  useEffect(() => {
    if (isDebugLogOpen && debugLogs.length > 0) {
      debugLogEndRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [debugLogs.length, isDebugLogOpen])

  async function cancelAllActiveTasks() {
    const taskIds = activeTasks.map((task) => task.taskId)
    setActiveTasks((current) =>
      current.map((task) =>
        taskIds.includes(task.taskId) ? { ...task, cancelRequested: true } : task,
      ),
    )
    await Promise.all(taskIds.map((taskId) => window.api.generation.cancel({ task_id: taskId })))
  }

  return (
    <div className="space-y-4">
      <ActiveGenerationTaskNotice
        tasks={activeTasks}
        onCancelAll={() => void cancelAllActiveTasks()}
      />

      <section
        aria-label="生图能力"
        className="rounded-md border bg-card p-4 text-card-foreground shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">生图生产</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setIsDebugLogOpen(true)} type="button" variant="secondary">
              <Terminal className="mr-2 h-4 w-4" />
              日志 {debugLogs.length}
              {debugIssueCount > 0 ? (
                <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {debugIssueCount}
                </span>
              ) : null}
            </Button>
            <div className="rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground">
              <div>输出目录</div>
              <div className="mt-1 font-medium text-foreground">
                {activeCapabilityMeta?.outputDir ?? '02-印花工作区'}
              </div>
            </div>
          </div>
        </div>

        <Tabs
          className="mt-4"
          onValueChange={(value) => {
            if (isGenerationCapabilityKey(value)) {
              setActiveCapability(value)
            }
          }}
          value={activeCapability}
        >
          <TabsList className="grid h-auto w-full grid-cols-5 p-1">
            {generationCapabilities.map((item) => {
              const Icon = capabilityIcons[item.key]
              return (
                <TabsTrigger className="h-10 gap-2" key={item.key} value={item.key}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>
      </section>

      <section
        aria-label={`${activeCapabilityMeta?.label ?? '生图'}生产工作区`}
        className="space-y-4"
      >
        <div hidden={activeCapability !== 'txt2img'}>
          <GrsaiPromptGenerationPanel capability="txt2img" />
        </div>

        <div hidden={activeCapability === 'txt2img'}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-4 shadow-sm">
            <div>
              <h3 className="text-base font-semibold">实现方式</h3>
              <p className="mt-1 text-sm text-muted-foreground">{providerNotes[activeProvider]}</p>
            </div>
            <fieldset
              aria-label={`${activeCapabilityMeta?.label ?? '生图'}实现方式`}
              className="flex gap-2"
            >
              {generationProviders.map((provider) => {
                const available = isGenerationProviderAvailable(activeCapability, provider.key)
                const selected = activeProvider === provider.key
                return (
                  <Button
                    aria-pressed={selected}
                    className="h-10"
                    disabled={!available}
                    key={provider.key}
                    onClick={() => setProvider(activeCapability, provider.key)}
                    title={available ? provider.label : unavailableText[activeCapability]}
                    type="button"
                    variant={selected ? 'default' : 'secondary'}
                  >
                    {provider.label}
                  </Button>
                )
              })}
            </fieldset>
          </div>

          <div hidden={!(activeCapability === 'extract' && activeProvider === 'grsai')}>
            <GrsaiExtractPanel />
          </div>
          <div hidden={!(activeCapability === 'extract' && activeProvider === 'comfyui-chenyu')}>
            <ComfyuiExtractPanel />
          </div>
          <div hidden={!(activeCapability === 'matting' && activeProvider === 'comfyui-chenyu')}>
            <ComfyuiMattingPanel />
          </div>
          <div
            hidden={
              !(activeCapability === 'extract-matting' && activeProvider === 'comfyui-chenyu')
            }
          >
            <ComfyuiExtractMattingPanel />
          </div>
          <div hidden={!(activeCapability === 'img2img' && activeProvider === 'comfyui-chenyu')}>
            <ComfyuiImg2imgPanel />
          </div>
          <div hidden={!(activeCapability === 'img2img' && activeProvider === 'grsai')}>
            <GrsaiPromptGenerationPanel capability="img2img" />
          </div>
          <div
            className={`mt-5 rounded-md border p-5 ${
              unavailable ? 'border-amber-200 bg-amber-50 text-amber-900' : 'bg-muted/40'
            }`}
            hidden={
              (activeCapability === 'extract' &&
                (activeProvider === 'grsai' || activeProvider === 'comfyui-chenyu')) ||
              (activeCapability === 'matting' && activeProvider === 'comfyui-chenyu') ||
              (activeCapability === 'extract-matting' && activeProvider === 'comfyui-chenyu') ||
              (activeCapability === 'img2img' &&
                (activeProvider === 'grsai' || activeProvider === 'comfyui-chenyu'))
            }
          >
            <div className="flex items-start gap-3">
              <CircleDashed className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h4 className="font-semibold">{activeCopy.title}</h4>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {activeCopy.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Dialog onOpenChange={setIsDebugLogOpen} open={isDebugLogOpen}>
        <DialogContent className="max-w-5xl gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3 pr-12">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4 text-primary" />
                生图日志
              </DialogTitle>
              <Button
                className="h-8 px-3"
                disabled={!debugLogs.length}
                onClick={() => {
                  setDebugLogs([])
                  setExpandedDebugLogId(null)
                }}
                type="button"
                variant="secondary"
              >
                清空
              </Button>
            </div>
          </DialogHeader>
          <div className="p-4">
            <ScrollArea className="h-[min(70vh,620px)] rounded-md border bg-zinc-950">
              <div className="space-y-1 p-3 font-mono text-[12px] leading-5">
                {debugLogs.length ? (
                  debugLogs.map((entry) => {
                    const rawResponse = generationDebugRawResponse(entry)
                    const expanded = expandedDebugLogId === entry.id
                    return (
                      <div className="space-y-2" key={entry.id}>
                        <div className={generationDebugLogLevelClassName(entry.level)}>
                          {formatGenerationDebugLogLine(entry)}
                          {rawResponse !== null ? (
                            <button
                              className="ml-2 rounded-sm border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-200 hover:border-zinc-500 hover:bg-zinc-900"
                              onClick={() =>
                                setExpandedDebugLogId((current) =>
                                  current === entry.id ? null : entry.id,
                                )
                              }
                              type="button"
                            >
                              {expanded ? '收起原文' : '展开原文'}
                            </button>
                          ) : null}
                        </div>
                        {expanded && rawResponse !== null ? (
                          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-900 p-3 text-[12px] leading-5 text-zinc-100">
                            {rawResponse || '(空字符串)'}
                          </pre>
                        ) : null}
                      </div>
                    )
                  })
                ) : (
                  <div className="text-zinc-500">暂无日志</div>
                )}
                <div ref={debugLogEndRef} />
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
