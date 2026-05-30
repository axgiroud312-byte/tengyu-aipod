import { Button } from '@/components/ui/button'
import { type Skill, type SkillSummary, estimateDetectionCost } from '@tengyu-aipod/shared'
import { Loader2, Save, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DetectionConfig, DetectionThresholdConfig } from '../../../main/lib/detection-config'

type DetectionSettingsPanelProps = {
  previewImageCount?: number
  onConfigChange?: (config: DetectionConfig | null) => void
  onCompressionChange?: (enabled: boolean) => void
}

const DEFAULT_THRESHOLD: DetectionThresholdConfig = { passMax: 39, reviewMax: 69 }
const DEFAULT_MODEL = 'qwen3-vl-flash'
const DEFAULT_DETECTION_SKILL_ID = 'infringement-detection'

function skillKey(skill: SkillSummary) {
  return `${skill.id}@@${skill.version}`
}

function parseSkillKey(value: string) {
  const [id, version] = value.split('@@')
  if (!id || !version) {
    return null
  }
  return { id, version }
}

function isMultiSelectVariable(variable: Skill['variables'][number]) {
  return variable.key === 'focus' || Array.isArray(variable.default)
}

function defaultVariableValue(variable: Skill['variables'][number]) {
  if (isMultiSelectVariable(variable)) {
    if (Array.isArray(variable.default)) {
      return variable.default.map(String)
    }
    return []
  }

  if (variable.type === 'checkbox') {
    return Boolean(variable.default)
  }

  if (variable.type === 'number') {
    return typeof variable.default === 'number' ? variable.default : (variable.min ?? 0)
  }

  if (typeof variable.default === 'string') {
    return variable.default
  }

  return ''
}

function buildVariableState(variables: Skill['variables'], existing?: Record<string, unknown>) {
  const next: Record<string, unknown> = {}
  for (const variable of variables) {
    const saved = existing?.[variable.key]
    if (saved !== undefined) {
      next[variable.key] = saved
      continue
    }
    next[variable.key] = defaultVariableValue(variable)
  }
  return next
}

function displayThreshold(threshold: DetectionThresholdConfig) {
  return `通过：0-${threshold.passMax} | 复核：${threshold.passMax + 1}-${threshold.reviewMax} | 拦截：${threshold.reviewMax + 1}-100`
}

export function DetectionSettingsPanel({
  previewImageCount,
  onConfigChange,
  onCompressionChange,
}: DetectionSettingsPanelProps = {}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [savedConfig, setSavedConfig] = useState<DetectionConfig | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null)
  const [skillDetail, setSkillDetail] = useState<Skill | null>(null)
  const [threshold, setThreshold] = useState<DetectionThresholdConfig>(DEFAULT_THRESHOLD)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [variables, setVariables] = useState<Record<string, unknown>>({})
  const [localPreviewImageCount, setLocalPreviewImageCount] = useState(42)
  const [previewBalance, setPreviewBalance] = useState('')
  const [withCompression, setWithCompression] = useState(true)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const [config, modelList, skillList] = await Promise.all([
          window.api.detection.getConfig(),
          window.api.detection.listModels(),
          window.api.skill.list({ module: 'detection' }),
        ])
        if (!mounted) {
          return
        }

        const detectionSkillList = skillList.filter(
          (item) => item.id === DEFAULT_DETECTION_SKILL_ID,
        )
        setModels(modelList)
        setSkills(detectionSkillList)
        setSavedConfig(config)
        setThreshold(config?.threshold ?? DEFAULT_THRESHOLD)
        setModel(config?.model ?? modelList[0] ?? DEFAULT_MODEL)

        const selected =
          (config
            ? detectionSkillList.find(
                (item) => item.id === config.skillId && item.version === config.skillVersion,
              )
            : null) ??
          detectionSkillList[0] ??
          null
        setSelectedSkill(selected)
        setLoading(false)
      } catch (loadError) {
        if (!mounted) {
          return
        }
        setLoading(false)
        setError(loadError instanceof Error ? loadError.message : '加载检测设置失败')
      }
    }

    void load()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const skill = selectedSkill
    if (!skill) {
      setSkillDetail(null)
      setVariables({})
      return () => {
        mounted = false
      }
    }

    const nextSkill = skill

    async function loadSkill() {
      try {
        const detail = await window.api.skill.get({
          id: nextSkill.id,
          version: nextSkill.version,
        })
        if (!mounted) {
          return
        }
        setSkillDetail(detail)
        if (
          savedConfig &&
          savedConfig.skillId === nextSkill.id &&
          savedConfig.skillVersion === nextSkill.version
        ) {
          setVariables(buildVariableState(detail.variables, savedConfig.variables))
        } else {
          setVariables(buildVariableState(detail.variables))
        }
      } catch (loadError) {
        if (!mounted) {
          return
        }
        setSkillDetail(null)
        setVariables({})
        setError(loadError instanceof Error ? loadError.message : '加载检测模板失败')
      }
    }

    void loadSkill()
    return () => {
      mounted = false
    }
  }, [savedConfig, selectedSkill])

  useEffect(() => {
    if (!selectedSkill) {
      onConfigChange?.(null)
      return
    }
    onConfigChange?.({
      threshold,
      skillId: selectedSkill.id,
      skillVersion: selectedSkill.version,
      model,
      variables,
    })
  }, [model, onConfigChange, selectedSkill, threshold, variables])

  useEffect(() => {
    onCompressionChange?.(withCompression)
  }, [onCompressionChange, withCompression])

  const selectedSkillLabel = useMemo(() => {
    if (!selectedSkill) {
      return '未选择'
    }
    return `${selectedSkill.id} @ ${selectedSkill.version}`
  }, [selectedSkill])

  const estimatedCost = useMemo(
    () =>
      estimateDetectionCost(previewImageCount ?? localPreviewImageCount, model, withCompression),
    [localPreviewImageCount, model, previewImageCount, withCompression],
  )
  const balanceValue = previewBalance.trim() ? Number(previewBalance) : null
  const hasBalance = balanceValue !== null && Number.isFinite(balanceValue)
  const balanceLow =
    hasBalance && balanceValue !== null ? balanceValue < estimatedCost.yuan * 1.5 : false

  async function saveConfig() {
    if (!selectedSkill) {
      setError('请先选择检测模板')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const nextConfig = await window.api.detection.saveConfig({
        threshold,
        skillId: selectedSkill.id,
        skillVersion: selectedSkill.version,
        model,
        variables,
      })
      setSavedConfig(nextConfig)
      setMessage('检测配置已保存')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存检测配置失败')
    } finally {
      setSaving(false)
    }
  }

  function updateThresholdPass(nextValue: number) {
    setThreshold((current) => ({
      passMax: Math.max(0, Math.min(nextValue, current.reviewMax - 1)),
      reviewMax: Math.max(current.reviewMax, nextValue + 1),
    }))
  }

  function updateThresholdReview(nextValue: number) {
    setThreshold((current) => ({
      passMax: Math.min(current.passMax, nextValue - 1),
      reviewMax: Math.max(nextValue, current.passMax + 1),
    }))
  }

  function updateVariable(key: string, value: unknown) {
    setVariables((current) => ({ ...current, [key]: value }))
  }

  if (loading) {
    return (
      <div className="rounded-md border bg-background p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载检测配置...
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-background p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">侵权检测设置</p>
          <h2 className="mt-1 text-lg font-semibold">阈值与检测模板</h2>
          <p className="mt-1 text-sm text-muted-foreground">{displayThreshold(threshold)}</p>
        </div>
        <Button disabled={saving} onClick={() => void saveConfig()} type="button">
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          保存配置
        </Button>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium">
              <span>模型</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => setModel(event.target.value)}
                value={model}
              >
                {models.length ? (
                  models.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))
                ) : (
                  <option value={DEFAULT_MODEL}>{DEFAULT_MODEL}</option>
                )}
              </select>
            </label>

            <label className="block space-y-2 text-sm font-medium">
              <span>检测模板</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onChange={(event) => {
                  const next = parseSkillKey(event.target.value)
                  if (!next) {
                    return
                  }
                  const nextSkill = skills.find(
                    (item) => item.id === next.id && item.version === next.version,
                  )
                  setSelectedSkill(nextSkill ?? null)
                }}
                value={selectedSkill ? skillKey(selectedSkill) : ''}
              >
                {skills.length ? (
                  skills.map((item) => (
                    <option key={skillKey(item)} value={skillKey(item)}>
                      {item.id} / {item.version}
                    </option>
                  ))
                ) : (
                  <option value="">暂无侵权检测 Skill，请先在后台配置并同步</option>
                )}
              </select>
            </label>
          </div>

          <div className="space-y-4 rounded-md border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <SlidersHorizontal className="h-4 w-4" />
              风险阈值
            </div>

            <label className="block space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>通过上限</span>
                <span className="font-mono text-xs text-muted-foreground">{threshold.passMax}</span>
              </div>
              <input
                className="w-full"
                max={98}
                min={0}
                onChange={(event) => updateThresholdPass(Number(event.target.value))}
                type="range"
                value={threshold.passMax}
              />
            </label>

            <label className="block space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>复核上限</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {threshold.reviewMax}
                </span>
              </div>
              <input
                className="w-full"
                max={99}
                min={1}
                onChange={(event) => updateThresholdReview(Number(event.target.value))}
                type="range"
                value={threshold.reviewMax}
              />
            </label>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div>
              <p className="text-sm font-medium">当前模板</p>
              <p className="text-sm text-muted-foreground">{selectedSkillLabel}</p>
            </div>
            {skillDetail?.variables.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {skillDetail.variables.map((variable) => {
                  const value = variables[variable.key]
                  const multiSelect = isMultiSelectVariable(variable)

                  if (variable.type === 'select' && multiSelect) {
                    const selectedValues = Array.isArray(value)
                      ? value.map(String)
                      : Array.isArray(variable.default)
                        ? variable.default.map(String)
                        : []
                    return (
                      <label
                        className="block space-y-2 text-sm font-medium md:col-span-2"
                        key={variable.key}
                      >
                        <span>{variable.label}</span>
                        <select
                          className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          multiple
                          onChange={(event) => {
                            const nextValues = Array.from(event.target.selectedOptions).map(
                              (option) => option.value,
                            )
                            updateVariable(variable.key, nextValues)
                          }}
                          value={selectedValues}
                        >
                          {variable.options?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )
                  }

                  switch (variable.type) {
                    case 'select':
                      return (
                        <label className="block space-y-2 text-sm font-medium" key={variable.key}>
                          <span>{variable.label}</span>
                          <select
                            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onChange={(event) => updateVariable(variable.key, event.target.value)}
                            value={
                              typeof value === 'string' ? value : String(variable.default ?? '')
                            }
                          >
                            <option value="">请选择</option>
                            {variable.options?.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )
                    case 'number':
                      return (
                        <label className="block space-y-2 text-sm font-medium" key={variable.key}>
                          <span>{variable.label}</span>
                          <input
                            className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            max={variable.max}
                            min={variable.min}
                            onChange={(event) =>
                              updateVariable(variable.key, Number(event.target.value))
                            }
                            placeholder={variable.placeholder}
                            type="number"
                            value={
                              typeof value === 'number' ? value : Number(variable.default ?? 0)
                            }
                          />
                        </label>
                      )
                    case 'textarea':
                      return (
                        <label
                          className="block space-y-2 text-sm font-medium md:col-span-2"
                          key={variable.key}
                        >
                          <span>{variable.label}</span>
                          <textarea
                            className="min-h-24 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onChange={(event) => updateVariable(variable.key, event.target.value)}
                            placeholder={variable.placeholder}
                            value={
                              typeof value === 'string' ? value : String(variable.default ?? '')
                            }
                          />
                        </label>
                      )
                    case 'checkbox':
                      return (
                        <label
                          className="inline-flex items-center gap-2 text-sm font-medium"
                          key={variable.key}
                        >
                          <input
                            checked={Boolean(value)}
                            onChange={(event) => updateVariable(variable.key, event.target.checked)}
                            type="checkbox"
                          />
                          {variable.label}
                        </label>
                      )
                    default:
                      return (
                        <label className="block space-y-2 text-sm font-medium" key={variable.key}>
                          <span>{variable.label}</span>
                          <input
                            className="h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            onChange={(event) => updateVariable(variable.key, event.target.value)}
                            placeholder={variable.placeholder}
                            type="text"
                            value={
                              typeof value === 'string' ? value : String(variable.default ?? '')
                            }
                          />
                        </label>
                      )
                  }
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">当前模板没有可配置变量。</p>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-md border bg-muted/30 p-4 text-sm">
          <div>
            <p className="font-medium">配置摘要</p>
            <p className="mt-1 text-muted-foreground">{displayThreshold(threshold)}</p>
          </div>
          <div>
            <p className="font-medium">模型</p>
            <p className="mt-1 font-mono text-muted-foreground">{model}</p>
          </div>
          <div>
            <p className="font-medium">检测模板</p>
            <p className="mt-1 text-muted-foreground">{selectedSkillLabel}</p>
          </div>
          <div>
            <p className="font-medium">变量数</p>
            <p className="mt-1 text-muted-foreground">{Object.keys(variables).length}</p>
          </div>
        </div>

        <div className="space-y-4 rounded-md border bg-background p-4 text-sm">
          <div>
            <p className="font-medium">预估费用</p>
            <p className="mt-1 text-muted-foreground">
              {previewImageCount ?? localPreviewImageCount} 张图，约 ¥
              {estimatedCost.yuan.toFixed(4)}（{withCompression ? '启用压缩' : '未压缩'}）
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {previewImageCount === undefined ? (
              <label className="block space-y-2 text-sm font-medium">
                <span>图数</span>
                <input
                  className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  min={1}
                  onChange={(event) =>
                    setLocalPreviewImageCount(Math.max(1, Number(event.target.value) || 1))
                  }
                  type="number"
                  value={localPreviewImageCount}
                />
              </label>
            ) : (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                当前选图 {previewImageCount} 张
              </div>
            )}
            <label className="block space-y-2 text-sm font-medium">
              <span>余额</span>
              <input
                className="h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"
                min={0}
                onChange={(event) => setPreviewBalance(event.target.value)}
                placeholder="手动输入余额"
                step="0.01"
                type="number"
                value={previewBalance}
              />
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <input
              checked={withCompression}
              onChange={(event) => setWithCompression(event.target.checked)}
              type="checkbox"
            />
            压缩图片
          </label>
          {hasBalance ? (
            balanceLow ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                余额不足，建议至少 ¥{(estimatedCost.yuan * 1.5).toFixed(4)}
              </div>
            ) : (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                余额充足
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">填写余额后会显示是否低于安全线。</p>
          )}
        </div>
      </div>
    </div>
  )
}
