import { Button } from '@/components/ui/button'
import type { GenerationCapability } from '@tengyu-aipod/shared'
import { CircleDashed, ImagePlus, Layers3, Scissors, WandSparkles } from 'lucide-react'
import {
  type GenerationProvider,
  generationCapabilities,
  generationProviders,
  isGenerationProviderAvailable,
  useGenerationStore,
} from '../store/generation'

const capabilityIcons: Record<GenerationCapability, typeof WandSparkles> = {
  txt2img: WandSparkles,
  img2img: ImagePlus,
  extract: Layers3,
  matting: Scissors,
}

const providerNotes: Record<GenerationProvider, string> = {
  grsai: '付费模型路径，适合文生图、图生图和提取。',
  'comfyui-chenyu': '云端 ComfyUI 工作流路径，适合图生图、提取和抠图。',
}

const unavailableText: Record<GenerationCapability, string> = {
  txt2img: 'ComfyUI 不提供文生图入口，请使用 Grsai。',
  img2img: '当前组合不可用，请切换实现方式。',
  extract: '当前组合不可用，请切换实现方式。',
  matting: 'Grsai 不内置透明底抠图，请使用 ComfyUI 或后续混合路径。',
}

function capabilityCopy(capability: GenerationCapability, provider: GenerationProvider) {
  if (!isGenerationProviderAvailable(capability, provider)) {
    return {
      title: '不可用',
      description: unavailableText[capability],
    }
  }

  if (capability === 'txt2img') {
    return {
      title: '文生图表单占位',
      description: '后续接入 AI 生成提示词 / 自己写双模式、提示词审稿、生图设置和进度面板。',
    }
  }

  if (capability === 'img2img') {
    return {
      title: provider === 'grsai' ? 'Grsai 图生图表单占位' : 'ComfyUI 图生图工作流占位',
      description:
        provider === 'grsai'
          ? '后续接入纯文字、参考构图、参考风格、构图+风格、自己写五种模式。'
          : '后续接入云端派发的图生图工作流列表和参数表单。',
    }
  }

  if (capability === 'extract') {
    return {
      title: provider === 'grsai' ? 'Grsai 提取表单占位' : 'ComfyUI 提取工作流占位',
      description:
        provider === 'grsai'
          ? '后续接入采集图多选、提取 skill、参考图提示词生成和图生图执行。'
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
  const activeProvider = tabs[activeCapability].provider
  const activeCapabilityMeta = generationCapabilities.find((item) => item.key === activeCapability)
  const activeCopy = capabilityCopy(activeCapability, activeProvider)
  const unavailable = !isGenerationProviderAvailable(activeCapability, activeProvider)

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-background p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">生图模块</p>
            <h2 className="mt-1 text-xl font-semibold text-balance">
              按能力选择 Grsai 或 ComfyUI 路径
            </h2>
          </div>
          <div className="rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground">
            <div>输出目录</div>
            <div className="mt-1 font-medium text-foreground">
              {activeCapabilityMeta?.outputDir ?? '02-生图'}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2">
          {generationCapabilities.map((item) => {
            const Icon = capabilityIcons[item.key]
            const selected = activeCapability === item.key
            return (
              <Button
                className="h-11 justify-start gap-2"
                key={item.key}
                onClick={() => setActiveCapability(item.key)}
                type="button"
                variant={selected ? 'default' : 'secondary'}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="rounded-md border bg-background p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">实现方式</h3>
            <p className="mt-1 text-sm text-muted-foreground">{providerNotes[activeProvider]}</p>
          </div>
          <div className="flex gap-2">
            {generationProviders.map((provider) => {
              const available = isGenerationProviderAvailable(activeCapability, provider.key)
              const selected = activeProvider === provider.key
              return (
                <Button
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
          </div>
        </div>

        <div
          className={`mt-5 rounded-md border p-5 ${
            unavailable ? 'border-amber-200 bg-amber-50 text-amber-900' : 'bg-muted/40'
          }`}
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
    </div>
  )
}
