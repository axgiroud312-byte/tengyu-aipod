import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ExternalLink, FolderOpen } from 'lucide-react'

type DirectoryPickerProps = {
  value: string
  onChange: (value: string) => void
  title?: string
  defaultPath?: string
  showOpen?: boolean
  id?: string
  className?: string
  inputClassName?: string
}

export function DirectoryPicker({
  value,
  onChange,
  title,
  defaultPath,
  showOpen = false,
  id,
  className,
  inputClassName,
}: DirectoryPickerProps) {
  async function chooseDirectory() {
    const input: NonNullable<Parameters<typeof window.api.dialog.chooseDirectory>[0]> = {}
    if (title) {
      input.title = title
    }
    const initialPath = value || defaultPath
    if (initialPath) {
      input.defaultPath = initialPath
    }

    const result = await window.api.dialog.chooseDirectory(input)
    if (result.ok) {
      onChange(result.data.path)
    }
  }

  async function openDirectory() {
    if (!value.trim()) {
      return
    }
    await window.api.shell.openPath(value)
  }

  return (
    <div className={cn('flex gap-2', className)}>
      <Input
        className={cn('min-w-0 flex-1', inputClassName)}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      <Button onClick={() => void chooseDirectory()} type="button" variant="secondary">
        <FolderOpen className="mr-2 h-4 w-4" />
        选择目录
      </Button>
      {showOpen ? (
        <Button
          disabled={!value.trim()}
          onClick={() => void openDirectory()}
          type="button"
          variant="secondary"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          打开
        </Button>
      ) : null}
    </div>
  )
}
