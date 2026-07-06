import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import { skillOptionKey, skillOptionLabel, skillOptionNotes } from '../lib/format'

export function ExtractSkillPicker({
  extractSkills,
  selectedSkill,
  selectedSkillKey,
  onChange,
}: {
  extractSkills: SkillSummary[]
  selectedSkill: Skill | null
  selectedSkillKey: string
  onChange: (key: string) => void
}) {
  const selectedNotes = selectedSkill ? skillOptionNotes(selectedSkill) : null

  return (
    <div className="space-y-3">
      {extractSkills.length ? (
        <label className="block space-y-2 text-sm font-medium">
          <span>提取提示词</span>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onChange={(event) => onChange(event.target.value)}
            value={selectedSkillKey}
          >
            {extractSkills.map((skill) => (
              <option key={skillOptionKey(skill)} value={skillOptionKey(skill)}>
                {skillOptionLabel(skill)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          请先在后台配置提取 Skill
        </div>
      )}
      <div className="rounded-md border p-3">
        <p className="text-sm font-medium">
          {selectedSkill ? skillOptionLabel(selectedSkill) : '未选择提取 Skill'}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {selectedSkill
            ? `${selectedSkill.id} · ${selectedSkill.version}`
            : '后台配置后会出现在这里'}
        </p>
        {selectedNotes ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{selectedNotes}</p>
        ) : null}
      </div>
    </div>
  )
}
