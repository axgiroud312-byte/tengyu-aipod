import { Button } from '@/components/ui/button'
import { localImageUrl } from '@/lib/media'
import { FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import type { GenerationImageSource } from '../../../../../main/lib/generation-service'

export function ImageFolderPickerPanel({
  title,
  folderPath,
  images,
  loading,
  emptyText,
  onChoose,
  onScan,
}: {
  title: string
  folderPath: string
  images: GenerationImageSource[]
  loading: boolean
  emptyText: string
  onChoose: () => void
  onScan: () => void
}) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-semibold">{title}</h4>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {folderPath || '未选择文件夹'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onChoose} type="button" variant="secondary">
            <FolderOpen className="mr-2 h-4 w-4" />
            选择文件夹
          </Button>
          <Button disabled={!folderPath || loading} onClick={onScan} type="button">
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            检索图片
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        共 {images.length} 张，将运行 {images.length} 次
      </div>

      <div className="mt-4 grid max-h-[430px] gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
        {images.length ? (
          images.map((source) => (
            <div className="min-w-0 rounded-md border bg-muted/30 p-2 text-sm" key={source.path}>
              <img
                alt={source.name}
                className="h-28 w-full rounded-sm object-cover"
                loading="lazy"
                src={localImageUrl(source.path)}
              />
              <span className="mt-2 block truncate font-medium">{source.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {source.relativePath}
              </span>
            </div>
          ))
        ) : (
          <div className="rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  )
}
