import type { SkillVariable } from '@tengyu-aipod/shared'

export function SkillVariableControl({
  variable,
  value,
  onChange,
}: {
  variable: SkillVariable
  value: string | boolean
  onChange: (value: string | boolean) => void
}) {
  if (variable.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
        <input
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        {variable.label}
      </label>
    )
  }

  if (variable.type === 'select') {
    return (
      <label className="block space-y-2 text-sm font-medium">
        <span>{variable.label}</span>
        <select
          className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onChange={(event) => onChange(event.target.value)}
          value={String(value)}
        >
          {(variable.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (variable.type === 'textarea') {
    return (
      <label className="block space-y-2 text-sm font-medium md:col-span-2">
        <span>{variable.label}</span>
        <textarea
          className="min-h-24 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onChange={(event) => onChange(event.target.value)}
          placeholder={variable.placeholder}
          value={String(value)}
        />
      </label>
    )
  }

  return (
    <label className="block space-y-2 text-sm font-medium">
      <span>{variable.label}</span>
      <input
        className="h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
        max={variable.max}
        min={variable.min}
        onChange={(event) => onChange(event.target.value)}
        placeholder={variable.placeholder}
        type={variable.type === 'number' ? 'number' : 'text'}
        value={String(value)}
      />
    </label>
  )
}
