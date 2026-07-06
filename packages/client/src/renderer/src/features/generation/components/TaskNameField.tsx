import { Input } from '@/components/ui/input'
import { useId } from 'react'

export function TaskNameField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const id = useId()
  return (
    <label className="block space-y-2 text-sm font-medium" htmlFor={id}>
      <span>任务文件夹名</span>
      <Input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  )
}
