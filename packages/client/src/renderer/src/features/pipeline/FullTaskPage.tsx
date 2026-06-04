import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type {
  PipelinePrintMode,
  PipelineProgress,
  PipelinePromptConfig,
  PipelinePromptMode,
  PipelineProvider,
  PipelineRunConfig,
  PipelineRunRecord,
  PipelineSourceMode,
  PipelineStepStatus,
  SkillSummary,
} from '@tengyu-aipod/shared'
import { FolderOpen, Play, RefreshCw, Square, WandSparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Option = {
  key: string
  label: string
}

const sourceModeOptions: Array<{ key: PipelineSourceMode; label: string }> = [
  { key: 'collection', label: '采集原图' },
  { key: 'txt2img', label: '文生图' },
  { key: 'img2img', label: '图生图' },
  { key: 'existing_prints', label: '已有印花' },
]

const providerOptions: Array<{ key: PipelineProvider; label: string }> = [
  { key: 'grsai', label: 'Grsai' },
  { key: 'comfyui-chenyu', label: 'ComfyUI 晨羽' },
]

const statusLabels: Record<PipelineStepStatus, string> = {
  pending: '等待',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  skipped: '跳过',
}

const statusTone: Record<PipelineStepStatus, string> = {
  pending: 'border-muted bg-muted/30 text-muted-foreground',
  running: 'border-blue-200 bg-blue-50 text-blue-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  failed: 'border-red-200 bg-red-50 text-red-800',
  skipped: 'border-slate-200 bg-slate-50 text-slate-700',
}

function Field({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </div>
  )
}

function SelectField({
  label,
  onValueChange,
  options,
  value,
}: {
  label: string
  onValueChange: (value: string) => void
  options: Option[]
  value: string
}) {
  return (
    <Field label={label}>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function optionFromSkill(skill: SkillSummary): Option {
  return {
    key: skill.id,
    label: `${skill.id}${skill.version ? ` · ${skill.version}` : ''}`,
  }
}

function optionFromWorkflow(workflow: { id: string; name: string; version?: string }): Option {
  return {
    key: workflow.id,
    label: `${workflow.name || workflow.id}${workflow.version ? ` · ${workflow.version}` : ''}`,
  }
}

function nonEmpty(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberFromText(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function FullTaskPage() {
  const [name, setName] = useState('')
  const [sourceMode, setSourceMode] = useState<PipelineSourceMode>('collection')
  const [printMode, setPrintMode] = useState<PipelinePrintMode>('local')
  const [sourceFolder, setSourceFolder] = useState('')
  const [sourceProvider, setSourceProvider] = useState<PipelineProvider>('grsai')
  const [extractProvider, setExtractProvider] = useState<PipelineProvider>('grsai')
  const [promptMode, setPromptMode] = useState<PipelinePromptMode>('manual')
  const [manualPrompts, setManualPrompts] = useState('Vintage floral print, clean ecommerce style')
  const [promptRequirement, setPromptRequirement] = useState('')
  const [promptCount, setPromptCount] = useState('5')
  const [promptSkillId, setPromptSkillId] = useState('')
  const [extractSkillId, setExtractSkillId] = useState('')
  const [detectionSkillId, setDetectionSkillId] = useState('')
  const [grsaiModel, setGrsaiModel] = useState('gpt-image-2')
  const [aspectRatio, setAspectRatio] = useState('1024x1024')
  const [grsaiConcurrency, setGrsaiConcurrency] = useState('3')
  const [workflowId, setWorkflowId] = useState('')
  const [extractWorkflowId, setExtractWorkflowId] = useState('')
  const [mattingWorkflowId, setMattingWorkflowId] = useState('')
  const [width, setWidth] = useState('1024')
  const [height, setHeight] = useState('1024')
  const [mattingEnabled, setMattingEnabled] = useState(true)
  const [mattingMode, setMattingMode] = useState<'comfyui' | 'mixed'>('comfyui')
  const [detectionEnabled, setDetectionEnabled] = useState(true)
  const [detectionModel, setDetectionModel] = useState('qwen3-vl-flash')
  const [templatePaths, setTemplatePaths] = useState<string[]>([])
  const [outputRoot, setOutputRoot] = useState('')
  const [titlePlatform, setTitlePlatform] = useState('temu')
  const [titleLanguage, setTitleLanguage] = useState('en')
  const [titleModel, setTitleModel] = useState('qwen3.6-flash')
  const [titleFileName, setTitleFileName] = useState('标题')
  const [extraRequirement, setExtraRequirement] = useState('')
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [recentRuns, setRecentRuns] = useState<PipelineRunRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('配置完整任务后即可启动')
  const [running, setRunning] = useState(false)

  const [generationSkills, setGenerationSkills] = useState<SkillSummary[]>([])
  const [detectionSkills, setDetectionSkills] = useState<SkillSummary[]>([])
  const [txt2imgWorkflows, setTxt2imgWorkflows] = useState<Option[]>([])
  const [img2imgWorkflows, setImg2imgWorkflows] = useState<Option[]>([])
  const [extractWorkflows, setExtractWorkflows] = useState<Option[]>([])
  const [mattingWorkflows, setMattingWorkflows] = useState<Option[]>([])
  const [mixedMattingWorkflows, setMixedMattingWorkflows] = useState<Option[]>([])
  const [platforms, setPlatforms] = useState<Option[]>([])
  const [languages, setLanguages] = useState<Option[]>([])
  const [titleModels, setTitleModels] = useState<Option[]>([])
  const [detectionModels, setDetectionModels] = useState<Option[]>([])

  const isMac = navigator.platform.toLowerCase().includes('mac')
  const currentWorkflowOptions =
    sourceMode === 'txt2img' ? txt2imgWorkflows : sourceMode === 'img2img' ? img2imgWorkflows : []
  const selectedMattingWorkflows =
    mattingMode === 'mixed' ? mixedMattingWorkflows : mattingWorkflows
  const canStart = !running && !isMac

  const refreshOptions = useCallback(async () => {
    const [
      skills,
      detectionSkillList,
      nextTxt2imgWorkflows,
      nextImg2imgWorkflows,
      nextExtractWorkflows,
      nextMattingWorkflows,
      nextMixedMattingWorkflows,
      nextPlatforms,
      nextLanguages,
      nextTitleModels,
      nextDetectionModels,
      runs,
    ] = await Promise.all([
      window.api.skill.list({ module: 'generation' }),
      window.api.skill.list({ module: 'detection' }),
      window.api.generation.listComfyuiTxt2imgWorkflows(),
      window.api.generation.listComfyuiImg2imgWorkflows(),
      window.api.generation.listComfyuiExtractWorkflows(),
      window.api.generation.listComfyuiMattingWorkflows(),
      window.api.generation.listComfyuiMixedMattingWorkflows(),
      window.api.title.listPlatforms(),
      window.api.title.listLanguages(),
      window.api.title.listModels(),
      window.api.detection.listModels(),
      window.api.pipeline.listRuns(),
    ])
    setGenerationSkills(skills)
    setDetectionSkills(detectionSkillList)
    setTxt2imgWorkflows(nextTxt2imgWorkflows.map(optionFromWorkflow))
    setImg2imgWorkflows(nextImg2imgWorkflows.map(optionFromWorkflow))
    setExtractWorkflows(nextExtractWorkflows.map(optionFromWorkflow))
    setMattingWorkflows(nextMattingWorkflows.map(optionFromWorkflow))
    setMixedMattingWorkflows(nextMixedMattingWorkflows.map(optionFromWorkflow))
    setPlatforms(nextPlatforms)
    setLanguages(nextLanguages)
    setTitleModels(nextTitleModels)
    setDetectionModels(nextDetectionModels.map((model) => ({ key: model, label: model })))
    setRecentRuns(runs)
  }, [])

  useEffect(() => {
    void refreshOptions().catch((nextError) =>
      setError(nextError instanceof Error ? nextError.message : '读取完整任务配置失败'),
    )
  }, [refreshOptions])

  useEffect(() => {
    return window.api.pipeline.onProgress((nextProgress) => {
      if (!currentRunId || nextProgress.run_id === currentRunId) {
        setProgress(nextProgress)
        setMessage(nextProgress.message)
      }
    })
  }, [currentRunId])

  useEffect(() => {
    return window.api.pipeline.onCompleted((event) => {
      if (event.ok) {
        setCurrentRunId(event.result.run.id)
        setProgress((current) =>
          current
            ? { ...current, status: event.result.run.status, steps: event.result.steps }
            : current,
        )
        setMessage(event.result.run.status === 'completed' ? '完整任务完成' : '完整任务已结束')
        setError(event.result.run.error_summary)
      } else {
        setError(event.error)
        setMessage('完整任务失败')
      }
      setRunning(false)
      void refreshOptions()
    })
  }, [refreshOptions])

  function updatePrintMode(nextMode: PipelinePrintMode) {
    setPrintMode(nextMode)
    setMattingEnabled(nextMode === 'local')
  }

  async function chooseSourceFolder() {
    const selected = await window.api.generation.chooseImageFolder()
    if (selected.ok) {
      setSourceFolder(selected.data.path)
    }
  }

  async function chooseTemplates() {
    const selected = await window.api.photoshop.chooseTemplates()
    if (selected.ok) {
      setTemplatePaths(selected.data.paths)
    }
  }

  async function chooseOutputRoot() {
    const selected = await window.api.photoshop.chooseOutputFolder()
    if (selected.ok) {
      setOutputRoot(selected.data.path)
    }
  }

  function buildPromptConfig(): PipelinePromptConfig {
    if (promptMode === 'manual') {
      return {
        mode: 'manual',
        prompts: splitLines(manualPrompts),
      }
    }
    return {
      mode: 'ai',
      requirement: promptRequirement,
      count: numberFromText(promptCount, 5),
      model: titleModel,
      ...(nonEmpty(promptSkillId) ? { skillId: promptSkillId.trim() } : {}),
    }
  }

  function buildSourceConfig(): PipelineRunConfig['source'] {
    const grsai = {
      model: grsaiModel,
      aspectRatio,
      concurrency: numberFromText(grsaiConcurrency, 3),
    }
    const comfyui = {
      workflowId,
      width: numberFromText(width, 1024),
      height: numberFromText(height, 1024),
      concurrency: 1,
    }
    if (sourceMode === 'collection') {
      return {
        mode: 'collection',
        sourceFolder,
        extract: {
          provider: extractProvider,
          ...(nonEmpty(extractSkillId) ? { skillId: extractSkillId.trim() } : {}),
          ...(extractProvider === 'grsai'
            ? { grsai }
            : { comfyui: { ...comfyui, workflowId: extractWorkflowId } }),
        },
      }
    }
    if (sourceMode === 'existing_prints') {
      return {
        mode: 'existing_prints',
        printFolder: sourceFolder,
      }
    }
    if (sourceMode === 'txt2img') {
      return {
        mode: 'txt2img',
        provider: sourceProvider,
        prompt: buildPromptConfig(),
        ...(sourceProvider === 'grsai' ? { grsai } : { comfyui }),
      }
    }
    return {
      mode: 'img2img',
      provider: sourceProvider,
      sourceFolder,
      prompt: buildPromptConfig(),
      sendReferenceImages: true,
      ...(sourceProvider === 'grsai' ? { grsai } : { comfyui }),
    }
  }

  function buildConfig(): PipelineRunConfig {
    return {
      ...(nonEmpty(name) ? { name: name.trim() } : {}),
      printMode,
      source: buildSourceConfig(),
      matting: {
        enabled: mattingEnabled,
        mode: mattingMode,
        ...(nonEmpty(mattingWorkflowId) ? { workflowId: mattingWorkflowId.trim() } : {}),
        width: numberFromText(width, 1024),
        height: numberFromText(height, 1024),
      },
      detection: {
        enabled: detectionEnabled,
        ...(nonEmpty(detectionSkillId) ? { skillId: detectionSkillId.trim() } : {}),
        model: detectionModel,
        threshold: { passMax: 39, reviewMax: 69 },
        concurrency: 20,
        maxRetries: 1,
        preprocess: { compress: true, maxSize: 1024, format: 'jpg', quality: 85 },
      },
      photoshop: {
        templates: templatePaths,
        ...(nonEmpty(outputRoot) ? { outputRoot: outputRoot.trim() } : {}),
        replaceRange: 'auto',
        format: 'jpg',
        clipMode: 'auto',
        skipCompleted: true,
        maxRetries: 1,
      },
      title: {
        platform: titlePlatform,
        language: titleLanguage,
        model: titleModel,
        titleFileName,
        imageIndex: 1,
        existingStrategy: 'skip',
        maxRetries: 2,
        concurrency: 20,
        ...(nonEmpty(extraRequirement) ? { extraRequirement: extraRequirement.trim() } : {}),
        preprocess: { compression: true, maxSize: 1024, format: 'jpg', quality: 85 },
      },
    }
  }

  async function runPipeline() {
    setError(null)
    setMessage('正在提交完整任务')
    try {
      const runId = await window.api.pipeline.run(buildConfig())
      setCurrentRunId(runId)
      setRunning(true)
      setMessage('完整任务已启动')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '完整任务启动失败')
    }
  }

  async function cancelPipeline() {
    if (!currentRunId) {
      return
    }
    const result = await window.api.pipeline.cancel({ run_id: currentRunId })
    if (!result.ok) {
      setError('当前完整任务已结束，无法取消')
      return
    }
    setMessage('已请求取消，当前步骤结束后停止')
  }

  const generationSkillOptions = useMemo(
    () => generationSkills.map(optionFromSkill),
    [generationSkills],
  )
  const detectionSkillOptions = useMemo(
    () => detectionSkills.map(optionFromSkill),
    [detectionSkills],
  )

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <WandSparkles className="h-5 w-5" />
              完整任务
            </CardTitle>
            <CardDescription>
              来源准备好后，按抠图、检测、PS 套版和标题生成顺序执行。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isMac ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                PS 套版 v1 仅支持 Windows，当前电脑不能启动完整任务。
              </div>
            ) : null}
            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="任务名">
                <Input onChange={(event) => setName(event.target.value)} value={name} />
              </Field>
              <SelectField
                label="印花类型"
                onValueChange={(value) => updatePrintMode(value as PipelinePrintMode)}
                options={[
                  { key: 'local', label: '局部印花' },
                  { key: 'full', label: '满印' },
                ]}
                value={printMode}
              />
              <SelectField
                label="来源"
                onValueChange={(value) => setSourceMode(value as PipelineSourceMode)}
                options={sourceModeOptions}
                value={sourceMode}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <Field label={sourceMode === 'existing_prints' ? '印花文件夹' : '来源文件夹'}>
                <Input
                  onChange={(event) => setSourceFolder(event.target.value)}
                  placeholder="选择采集目录、图生图来源目录或已有印花目录"
                  value={sourceFolder}
                />
              </Field>
              <Button
                className="mt-7 h-10"
                onClick={() => void chooseSourceFolder()}
                variant="outline"
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                选择
              </Button>
            </div>

            {sourceMode !== 'existing_prints' ? (
              <div className="grid gap-4 md:grid-cols-3">
                {sourceMode === 'collection' ? (
                  <SelectField
                    label="提取路径"
                    onValueChange={(value) => setExtractProvider(value as PipelineProvider)}
                    options={providerOptions}
                    value={extractProvider}
                  />
                ) : (
                  <SelectField
                    label="生图路径"
                    onValueChange={(value) => setSourceProvider(value as PipelineProvider)}
                    options={providerOptions}
                    value={sourceProvider}
                  />
                )}
                <Field label="Grsai 模型">
                  <Input
                    onChange={(event) => setGrsaiModel(event.target.value)}
                    value={grsaiModel}
                  />
                </Field>
                <Field label="尺寸 / 比例">
                  <Input
                    onChange={(event) => setAspectRatio(event.target.value)}
                    value={aspectRatio}
                  />
                </Field>
              </div>
            ) : null}

            {sourceMode === 'collection' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField
                  label="提取 Skill"
                  onValueChange={setExtractSkillId}
                  options={generationSkillOptions}
                  value={extractSkillId}
                />
                <SelectField
                  label="提取工作流"
                  onValueChange={setExtractWorkflowId}
                  options={extractWorkflows}
                  value={extractWorkflowId}
                />
              </div>
            ) : null}

            {sourceMode === 'txt2img' || sourceMode === 'img2img' ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <SelectField
                    label="提示词模式"
                    onValueChange={(value) => setPromptMode(value as PipelinePromptMode)}
                    options={[
                      { key: 'manual', label: '手写提示词' },
                      { key: 'ai', label: 'AI 生成提示词' },
                    ]}
                    value={promptMode}
                  />
                  <SelectField
                    label="提示词 Skill"
                    onValueChange={setPromptSkillId}
                    options={generationSkillOptions}
                    value={promptSkillId}
                  />
                  <SelectField
                    label="ComfyUI 工作流"
                    onValueChange={setWorkflowId}
                    options={currentWorkflowOptions}
                    value={workflowId}
                  />
                </div>
                {promptMode === 'manual' ? (
                  <Field label="提示词">
                    <Textarea
                      onChange={(event) => setManualPrompts(event.target.value)}
                      value={manualPrompts}
                    />
                  </Field>
                ) : (
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_120px]">
                    <Field label="印花要求">
                      <Textarea
                        onChange={(event) => setPromptRequirement(event.target.value)}
                        value={promptRequirement}
                      />
                    </Field>
                    <Field label="数量">
                      <Input
                        onChange={(event) => setPromptCount(event.target.value)}
                        value={promptCount}
                      />
                    </Field>
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-4">
              <Field label="宽">
                <Input onChange={(event) => setWidth(event.target.value)} value={width} />
              </Field>
              <Field label="高">
                <Input onChange={(event) => setHeight(event.target.value)} value={height} />
              </Field>
              <Field label="Grsai 并发">
                <Input
                  onChange={(event) => setGrsaiConcurrency(event.target.value)}
                  value={grsaiConcurrency}
                />
              </Field>
              <div className="mt-8 flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  aria-label="启用抠图"
                  checked={mattingEnabled}
                  onCheckedChange={(checked) => setMattingEnabled(Boolean(checked))}
                />
                <span>启用抠图</span>
              </div>
            </div>

            {mattingEnabled ? (
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField
                  label="抠图方式"
                  onValueChange={(value) => setMattingMode(value as 'comfyui' | 'mixed')}
                  options={[
                    { key: 'comfyui', label: 'ComfyUI 直接抠图' },
                    { key: 'mixed', label: 'Grsai + ComfyUI 混合' },
                  ]}
                  value={mattingMode}
                />
                <SelectField
                  label="抠图工作流"
                  onValueChange={setMattingWorkflowId}
                  options={selectedMattingWorkflows}
                  value={mattingWorkflowId}
                />
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="mt-8 flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  aria-label="启用侵权检测"
                  checked={detectionEnabled}
                  onCheckedChange={(checked) => setDetectionEnabled(Boolean(checked))}
                />
                <span>启用侵权检测</span>
              </div>
              <SelectField
                label="检测 Skill"
                onValueChange={setDetectionSkillId}
                options={detectionSkillOptions}
                value={detectionSkillId}
              />
              <SelectField
                label="检测模型"
                onValueChange={setDetectionModel}
                options={detectionModels}
                value={detectionModel}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <Field label="PSD 模板">
                <Input readOnly value={templatePaths.join('；')} />
              </Field>
              <Button
                className="mt-7 h-10"
                onClick={() => void chooseTemplates()}
                variant="outline"
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                选择模板
              </Button>
              <Button className="mt-7 h-10" onClick={() => setTemplatePaths([])} variant="ghost">
                清空
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="套版输出目录">
                <Input
                  onChange={(event) => setOutputRoot(event.target.value)}
                  placeholder="留空则写入 04-上架工作区/完整任务-时间"
                  value={outputRoot}
                />
              </Field>
              <Button
                className="mt-7 h-10"
                onClick={() => void chooseOutputRoot()}
                variant="outline"
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                选择
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <SelectField
                label="标题平台"
                onValueChange={setTitlePlatform}
                options={platforms}
                value={titlePlatform}
              />
              <SelectField
                label="标题语言"
                onValueChange={setTitleLanguage}
                options={languages}
                value={titleLanguage}
              />
              <SelectField
                label="标题模型"
                onValueChange={setTitleModel}
                options={titleModels}
                value={titleModel}
              />
              <Field label="标题文件名">
                <Input
                  onChange={(event) => setTitleFileName(event.target.value)}
                  value={titleFileName}
                />
              </Field>
            </div>
            <Field label="标题额外要求">
              <Textarea
                onChange={(event) => setExtraRequirement(event.target.value)}
                value={extraRequirement}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!canStart} onClick={() => void runPipeline()}>
                <Play className="mr-2 h-4 w-4" />
                启动完整任务
              </Button>
              <Button
                disabled={!running || !currentRunId}
                onClick={() => void cancelPipeline()}
                variant="outline"
              >
                <Square className="mr-2 h-4 w-4" />
                取消
              </Button>
              <Button onClick={() => void refreshOptions()} variant="ghost">
                <RefreshCw className="mr-2 h-4 w-4" />
                刷新选项
              </Button>
              <span className="text-sm text-muted-foreground">{message}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-5">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">运行状态</CardTitle>
            <CardDescription>{currentRunId ?? '暂无运行任务'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {progress ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">印花</div>
                    <div className="mt-1 text-lg font-semibold">{progress.stats.prints}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">疑似放行</div>
                    <div className="mt-1 text-lg font-semibold">
                      {progress.stats.detectionReview}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">高风险拦截</div>
                    <div className="mt-1 text-lg font-semibold">
                      {progress.stats.detectionBlock}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">标题成功</div>
                    <div className="mt-1 text-lg font-semibold">
                      {progress.stats.titleSucceeded}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {progress.steps.map((step) => (
                    <div
                      className={`rounded-md border px-3 py-2 text-sm ${statusTone[step.status]}`}
                      key={step.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{step.label}</span>
                        <span>{statusLabels[step.status]}</span>
                      </div>
                      <div className="mt-1 text-xs opacity-80">
                        {step.input_count} → {step.output_count}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">任务启动后显示每个步骤的进度。</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">最近完整任务</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentRuns.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无历史记录。</div>
            ) : (
              recentRuns.slice(0, 8).map((run) => (
                <div className="rounded-md border px-3 py-2 text-sm" key={run.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{run.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{run.status}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {run.source_mode}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
