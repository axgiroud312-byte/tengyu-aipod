import { Input } from '@/components/ui/input'
import { useId } from 'react'

export function VisibleFilenameFields({
  prefix,
  separator,
  onPrefixChange,
  onSeparatorChange,
}: {
  prefix: string
  separator: string
  onPrefixChange: (value: string) => void
  onSeparatorChange: (value: string) => void
}) {
  const prefixId = useId()
  const separatorId = useId()

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
      <label className="block space-y-2 text-sm font-medium" htmlFor={prefixId}>
        <span>图片名前缀</span>
        <Input
          id={prefixId}
          onChange={(event) => onPrefixChange(event.target.value)}
          placeholder="不填则使用默认命名"
          value={prefix}
        />
      </label>
      <label className="block space-y-2 text-sm font-medium" htmlFor={separatorId}>
        <span>分隔符</span>
        <Input
          id={separatorId}
          onChange={(event) => onSeparatorChange(event.target.value)}
          placeholder="-"
          value={separator}
        />
      </label>
    </div>
  )
}
