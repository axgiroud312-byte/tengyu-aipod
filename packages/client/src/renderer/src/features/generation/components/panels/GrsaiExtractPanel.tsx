import { Button } from '@/components/ui/button'
import { CurrentTaskImagePreview } from '@/features/generation/components/CurrentTaskImagePreview'
import { ExtractSkillPicker } from '@/features/generation/components/ExtractSkillPicker'
import { GenerationCancelButton } from '@/features/generation/components/GenerationCancelButton'
import { ImageFolderPickerPanel } from '@/features/generation/components/ImageFolderPickerPanel'
import { TaskNameField } from '@/features/generation/components/TaskNameField'
import { VisibleFilenameFields } from '@/features/generation/components/VisibleFilenameFields'
import { useGenerationLocalSettings } from '@/features/generation/hooks/use-generation-local-settings'
import { useGenerationTaskEvents } from '@/features/generation/hooks/use-generation-task-events'
import { useExtractSkillOptions } from '@/features/generation/hooks/use-skill-options'
import {
  clampNumber,
  grsaiSizes,
  modelLabel,
  modelOptionsForCapability,
  progressPercent,
} from '@/features/generation/lib/format'
import { Loader2, Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  GenerationImageSource,
  GenerationProgress,
  GenerationRunImage,
  GenerationRunResult,
} from '../../../../../../main/lib/generation-service'

export function GrsaiExtractPanel() {
  const { settings, error: settingsError } = useGenerationLocalSettings()
  const [sources, setSources] = useState<GenerationImageSource[]>([])
  const [sourceFolder, setSourceFolder] = useState('')
  const [generationModel, setGenerationModel] = useState('gpt-image-2')
  const [aspectRatio, setAspectRatio] = useState('1024x1024')
  const [taskName, setTaskName] = useState('')
  const [filenamePrefix, setFilenamePrefix] = useState('')
  const [filenameSeparator, setFilenameSeparator] = useState('-')
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [previewImages, setPreviewImages] = useState<GenerationRunImage[]>([])
  const [result, setResult] = useState<GenerationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [running, setRunning] = useState(false)
  const { extractSkills, selectedSkill, selectedSkillKey, setSelectedSkillKey } =
    useExtractSkillOptions(setError)
  const taskEvents = useGenerationTaskEvents({
    expectedCapability: 'extract',
    setProgress,
    setPreviewImages,
    setResult,
    setError,
    setRunning,
  })

  const selectedCount = sources.length
  const percent = progressPercent(progress)
  const generationModels = useMemo(() => modelOptionsForCapability(settings, 'extract'), [settings])
  const selectedGenerationModel = useMemo(
    () => generationModels.find((model) => model.id === generationModel) ?? null,
    [generationModel, generationModels],
  )
  const sizeOptions = grsaiSizes(selectedGenerationModel)
  const defaultConcurrency = settings?.config.default_concurrency ?? 20

  useEffect(() => {
    const firstModel = generationModels[0]
    if (firstModel && !generationModels.some((model) => model.id === generationModel)) {
      setGenerationModel(firstModel.id)
    }
  }, [generationModel, generationModels])

  useEffect(() => {
    if (!sizeOptions.includes(aspectRatio)) {
      setAspectRatio(sizeOptions[0] ?? '1024x1024')
    }
  }, [aspectRatio, sizeOptions])

  async function chooseSourceFolder() {
    setError(null)
    const result = await window.api.generation.chooseImageFolder()
    if (!result.ok) {
      if (result.error.code !== 'CANCELLED') {
        setError(result.error.message)
      }
      return
    }
    setSourceFolder(result.data.path)
    setSources([])
  }

  async function scanSourceFolder() {
    if (!sourceFolder) {
      setError('请先选择图片文件夹')
      return
    }
    setLoadingSources(true)
    setError(null)
    try {
      const images = await window.api.generation.scanImageFolder({ folder: sourceFolder })
      setSources(images)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '检索图片失败')
    } finally {
      setLoadingSources(false)
    }
  }

  async function startExtract() {
    setError(null)
    if (!selectedSkill) {
      setError('请先在后台配置提取 Skill')
      return
    }
    if (sources.length === 0) {
      setError('请先检索图片文件夹')
      return
    }

    setResult(null)
    setPreviewImages([])
    setRunning(true)
    taskEvents.beginTask()
    try {
      const taskId = await window.api.generation.runExtract({
        sourceImagePaths: sources.map((source) => source.path),
        skillId: selectedSkill.id,
        skillVersion: selectedSkill.version,
        variables: {},
        model: generationModel,
        aspectRatio,
        concurrency: defaultConcurrency,
        ...(taskName.trim() ? { taskId: taskName.trim() } : {}),
        ...(filenamePrefix.trim() ? { filenamePrefix: filenamePrefix.trim() } : {}),
        ...(filenamePrefix.trim() ? { filenameSeparator } : {}),
      })
      if (!taskEvents.activateTask(taskId)) {
        setProgress({
          task_id: taskId,
          capability: 'extract',
          processed: 0,
          total: sources.length,
          succeeded: 0,
          failed: 0,
        })
      }
    } catch (nextError) {
      taskEvents.clearTaskStart()
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : '启动 Grsai 提取失败')
    }
  }

  return (
    <>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <ImageFolderPickerPanel
            emptyText="暂无可用于提取的图片"
            folderPath={sourceFolder}
            images={sources}
            loading={loadingSources}
            onChoose={() => void chooseSourceFolder()}
            onScan={() => void scanSourceFolder()}
            title="提取图片文件夹"
          />

          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">提取 Skill</h4>
            <div className="mt-4">
              <ExtractSkillPicker
                extractSkills={extractSkills}
                onChange={(key) => {
                  setSelectedSkillKey(key)
                  setError(null)
                }}
                selectedSkill={selectedSkill}
                selectedSkillKey={selectedSkillKey}
              />
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-md border bg-background p-4">
            <h4 className="font-semibold">执行设置</h4>
            {settingsError ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {settingsError}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3">
              <label className="block space-y-2 text-sm font-medium">
                <span>Grsai 模型</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onChange={(event) => setGenerationModel(event.target.value)}
                  value={generationModel}
                >
                  {generationModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {modelLabel(model)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3">
                <label className="block space-y-2 text-sm font-medium">
                  <span>尺寸</span>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onChange={(event) => setAspectRatio(event.target.value)}
                    value={aspectRatio}
                  >
                    {sizeOptions.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <TaskNameField
                onChange={setTaskName}
                placeholder="默认：提取-时间"
                value={taskName}
              />
              <VisibleFilenameFields
                onPrefixChange={setFilenamePrefix}
                onSeparatorChange={setFilenameSeparator}
                prefix={filenamePrefix}
                separator={filenameSeparator}
              />
              <Button disabled={running} onClick={() => void startExtract()} type="button">
                {running ? <Loader2 className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                开始提取
              </Button>
              <GenerationCancelButton
                onCancel={() => void taskEvents.cancelTask()}
                running={running}
              />
            </div>
          </div>

          <div className="rounded-md border bg-background p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">进度</h4>
              <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">源图</dt>
                <dd className="font-medium tabular-nums">{selectedCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">处理</dt>
                <dd className="font-medium tabular-nums">
                  {progress ? `${progress.processed}/${progress.total}` : '0/0'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">成功</dt>
                <dd className="font-medium tabular-nums">{progress?.succeeded ?? 0}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">失败</dt>
                <dd className="font-medium tabular-nums">{progress?.failed ?? 0}</dd>
              </div>
            </dl>
            {error ? (
              <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {result ? (
              <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
                {result.cancelled ? '已取消' : '完成'}：成功 {result.succeeded}，失败{' '}
                {result.failed}
                {result.diagnosticsLogPath ? (
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    诊断日志：{result.diagnosticsLogPath}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
      <CurrentTaskImagePreview images={previewImages} />
    </>
  )
}
