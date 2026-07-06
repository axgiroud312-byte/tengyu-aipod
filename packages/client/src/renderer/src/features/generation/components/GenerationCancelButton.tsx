import { Button } from '@/components/ui/button'
import { Square } from 'lucide-react'

export function GenerationCancelButton({
  running,
  onCancel,
}: {
  running: boolean
  onCancel: () => void
}) {
  if (!running) {
    return null
  }
  return (
    <Button onClick={onCancel} type="button" variant="secondary">
      <Square className="mr-2 h-4 w-4" />
      取消任务
    </Button>
  )
}
