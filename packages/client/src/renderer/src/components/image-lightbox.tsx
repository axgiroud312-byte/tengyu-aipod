import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { nextImageIndex } from './image-lightbox-utils'

export type ImageLightboxDetail = {
  label: string
  value: ReactNode
  mono?: boolean
  preserve?: boolean
}

export type ImageLightboxItem = {
  src: string
  alt: string
  title: string
  eyebrow?: string
  details?: ImageLightboxDetail[]
  note?: ReactNode
}

type ImageLightboxProps = {
  activeIndex: number | null
  items: ImageLightboxItem[]
  title: string
  onActiveIndexChange: (index: number | null) => void
}

export function ImageLightbox({
  activeIndex,
  items,
  title,
  onActiveIndexChange,
}: ImageLightboxProps) {
  const activeItem = activeIndex === null ? null : (items[activeIndex] ?? null)
  const canMove = items.length > 1 && activeIndex !== null

  useEffect(() => {
    if (!canMove || activeIndex === null) {
      return
    }
    const currentIndex = activeIndex

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return
      }

      event.preventDefault()
      onActiveIndexChange(
        nextImageIndex(currentIndex, items.length, event.key === 'ArrowLeft' ? -1 : 1),
      )
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, canMove, items.length, onActiveIndexChange])

  function move(delta: number) {
    if (activeIndex === null) {
      return
    }
    onActiveIndexChange(nextImageIndex(activeIndex, items.length, delta))
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onActiveIndexChange(null)
        }
      }}
      open={activeIndex !== null}
    >
      <DialogContent className="max-h-[92vh] max-w-6xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle className="text-base">
            {title} {activeIndex === null ? '' : `${activeIndex + 1}/${items.length}`}
          </DialogTitle>
        </DialogHeader>
        {activeItem ? (
          <div className="grid min-h-[420px] md:grid-cols-[minmax(0,1fr)_340px]">
            <div className="relative flex min-h-[360px] items-center justify-center bg-muted/70 p-4">
              <img
                alt={activeItem.alt}
                className="max-h-[76vh] max-w-full object-contain"
                src={activeItem.src}
              />
              {canMove ? (
                <>
                  <Button
                    aria-label="上一张"
                    className="absolute left-3 top-1/2 h-10 w-10 -translate-y-1/2 p-0"
                    onClick={() => move(-1)}
                    type="button"
                    variant="secondary"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    aria-label="下一张"
                    className="absolute right-3 top-1/2 h-10 w-10 -translate-y-1/2 p-0"
                    onClick={() => move(1)}
                    type="button"
                    variant="secondary"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </>
              ) : null}
            </div>
            <aside className="min-h-0 overflow-auto border-t bg-background p-4 md:border-l md:border-t-0">
              {activeItem.eyebrow ? (
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {activeItem.eyebrow}
                </p>
              ) : null}
              <h3 className="mt-1 break-all text-base font-semibold">{activeItem.title}</h3>
              {activeItem.note ? (
                <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {activeItem.note}
                </div>
              ) : null}
              {activeItem.details?.length ? (
                <dl className="mt-4 space-y-3 text-sm">
                  {activeItem.details.map((detail) => (
                    <div key={detail.label}>
                      <dt className="text-xs text-muted-foreground">{detail.label}</dt>
                      <dd
                        className={cn(
                          'mt-1 break-words font-medium',
                          detail.mono ? 'font-mono text-xs' : null,
                          detail.preserve ? 'whitespace-pre-wrap' : null,
                        )}
                      >
                        {detail.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </aside>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
