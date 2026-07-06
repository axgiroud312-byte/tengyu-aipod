import type { SkillSummary } from '@tengyu-aipod/shared'
import { promptSkillLabel, skillOptionLabel } from '../lib/format'

export function PromptSkillPicker({
  category,
  promptSkills,
  selectedSkill,
  selectedSkillId,
  onChange,
}: {
  category: string
  promptSkills: SkillSummary[]
  selectedSkill: SkillSummary | null
  selectedSkillId: string
  onChange: (skillId: string) => void
}) {
  const label = promptSkillLabel(category)
  if (!promptSkills.length) {
    return (
      <div className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
        暂无可用的{label} Skill，请先在后台配置
      </div>
    )
  }

  return (
    <label className="block min-w-0 space-y-2 text-sm font-medium">
      <span>提示词配置</span>
      <select
        className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onChange={(event) => onChange(event.target.value)}
        value={selectedSkillId}
      >
        {promptSkills.map((skill) => (
          <option key={skill.id} value={skill.id}>
            {skillOptionLabel(skill)}
          </option>
        ))}
      </select>
      <span className="block truncate text-xs font-normal text-muted-foreground">
        {selectedSkill ? `${selectedSkill.id} · ${selectedSkill.version}` : `当前组合：${label}`}
      </span>
    </label>
  )
}
