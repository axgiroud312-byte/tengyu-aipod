import type { usePromptSkillOptions } from '../hooks/use-skill-options'
import { modelLabel } from '../lib/format'
import { PromptSkillPicker } from './PromptSkillPicker'

type ComfyuiImg2imgPromptMode = 'ai' | 'workflow' | 'manual'
type Img2imgMode = 'layout' | 'style' | 'layout-style' | 'manual'
type PrintMode = 'local' | 'full'
type PromptModelOption = {
  id: string
  label?: string
}

type ComfyuiImg2imgPromptFieldsProps = {
  img2imgModes: Array<{ key: Img2imgMode; label: string; instruction: string }>
  printMode: PrintMode
  prompt: string
  promptMode: ComfyuiImg2imgPromptMode
  promptModel: string
  promptModelOptions: PromptModelOption[]
  promptSkillCategory: string
  promptSkillSelection: ReturnType<typeof usePromptSkillOptions>
  referenceMode: Exclude<Img2imgMode, 'manual'>
  requirement: string
  setPrintMode: (value: PrintMode) => void
  setPrompt: (value: string) => void
  setPromptMode: (value: ComfyuiImg2imgPromptMode) => void
  setPromptModel: (value: string) => void
  setReferenceMode: (value: Exclude<Img2imgMode, 'manual'>) => void
  setRequirement: (value: string) => void
}

export function ComfyuiImg2imgPromptFields({
  img2imgModes,
  printMode,
  prompt,
  promptMode,
  promptModel,
  promptModelOptions,
  promptSkillCategory,
  promptSkillSelection,
  referenceMode,
  requirement,
  setPrintMode,
  setPrompt,
  setPromptMode,
  setPromptModel,
  setReferenceMode,
  setRequirement,
}: ComfyuiImg2imgPromptFieldsProps) {
  return (
    <fieldset className="rounded-md border p-3 md:col-span-2">
      <legend className="px-1 text-sm font-medium">提示词来源</legend>
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input checked={promptMode === 'ai'} onChange={() => setPromptMode('ai')} type="radio" />
          AI 看图写提示词（推荐）
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            checked={promptMode === 'workflow'}
            onChange={() => setPromptMode('workflow')}
            type="radio"
          />
          工作流默认
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            checked={promptMode === 'manual'}
            onChange={() => setPromptMode('manual')}
            type="radio"
          />
          手动填写
        </label>
      </div>
      {promptMode === 'ai' ? (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium">
            <span>印花模式</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onChange={(event) => setPrintMode(event.target.value as PrintMode)}
              value={printMode}
            >
              <option value="local">局部</option>
              <option value="full">满印</option>
            </select>
          </label>
          <label className="block space-y-2 text-sm font-medium">
            <span>参考方式</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onChange={(event) =>
                setReferenceMode(event.target.value as Exclude<Img2imgMode, 'manual'>)
              }
              value={referenceMode}
            >
              {img2imgModes
                .filter((item) => item.key !== 'manual')
                .map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
          <PromptSkillPicker
            category={promptSkillCategory}
            onChange={promptSkillSelection.selectPromptSkill}
            promptSkills={promptSkillSelection.promptSkills}
            selectedSkill={promptSkillSelection.selectedSkill}
            selectedSkillId={promptSkillSelection.selectedSkillId}
          />
          <label className="block space-y-2 text-sm font-medium">
            <span>提示词模型</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onChange={(event) => setPromptModel(event.target.value)}
              value={promptModel}
            >
              {promptModelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {modelLabel(model)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-2 text-sm font-medium md:col-span-2">
            <span>其他要求</span>
            <textarea
              className="min-h-24 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onChange={(event) => setRequirement(event.target.value)}
              placeholder="例如：改成复古花卉徽章，干净白底，适合印花"
              value={requirement}
            />
          </label>
        </div>
      ) : null}
      {promptMode === 'manual' ? (
        <label className="mt-3 block space-y-2 text-sm font-medium">
          <span>图生图提示词</span>
          <textarea
            className="min-h-28 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：保留主体轮廓，改成复古花卉徽章，干净白底，适合印花"
            value={prompt}
          />
        </label>
      ) : null}
    </fieldset>
  )
}
