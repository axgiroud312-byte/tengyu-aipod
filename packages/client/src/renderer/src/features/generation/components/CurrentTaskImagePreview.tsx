import {
  ImageLightbox,
  type ImageLightboxDetail,
  type ImageLightboxItem,
} from '@/components/image-lightbox'
import { fileUrlLocalPath } from '@/lib/media'
import { useEffect, useMemo, useState } from 'react'
import type { GenerationRunImage } from '../../../../../main/lib/generation-service'
import { imagePreviewSrc } from '../lib/format'

function presentDetail(
  label: string,
  value: string | undefined,
  options?: Pick<ImageLightboxDetail, 'mono' | 'preserve'>,
): ImageLightboxDetail | null {
  const displayValue = value?.trim()
  if (!displayValue) {
    return null
  }

  const detail: ImageLightboxDetail = { label, value: displayValue }
  if (options?.mono) {
    detail.mono = true
  }
  if (options?.preserve) {
    detail.preserve = true
  }
  return detail
}

function generationPreviewItem(image: GenerationRunImage, index: number): ImageLightboxItem {
  const savedPath = image.localPath ?? fileUrlLocalPath(image.url) ?? ''
  const details = [
    presentDetail('印花 ID', image.printId, { mono: true }),
    presentDetail('Artifact ID', image.artifactId, { mono: true }),
    presentDetail('源图路径', image.sourcePath, { mono: true }),
    presentDetail('保存路径', savedPath, { mono: true }),
    presentDetail('图片 URL', savedPath ? '' : image.url, { mono: true }),
  ].filter((detail): detail is ImageLightboxDetail => detail !== null)

  return {
    alt: `结果图 ${index + 1}`,
    eyebrow: `结果 ${index + 1}`,
    note: (
      <div>
        <p className="text-xs font-medium text-muted-foreground">提示词</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
          {image.prompt.trim() || '暂无提示词'}
        </p>
      </div>
    ),
    src: imagePreviewSrc(image),
    title: image.printId ?? image.artifactId ?? `结果 ${index + 1}`,
    details,
  }
}

export function CurrentTaskImagePreview({ images }: { images: GenerationRunImage[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const previewItems = useMemo(
    () => images.map((image, index) => generationPreviewItem(image, index)),
    [images],
  )

  useEffect(() => {
    setActiveIndex((current) =>
      current !== null && current >= previewItems.length ? null : current,
    )
  }, [previewItems.length])

  function openImage(index: number) {
    setActiveIndex(index)
  }

  return (
    <div className="mt-5 rounded-md border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">当前任务图片预览</h4>
        <span className="text-sm tabular-nums text-muted-foreground">{images.length} 张</span>
      </div>
      {images.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {images.map((image, index) => (
            <button
              className="group min-w-0 rounded-md border bg-muted/30 p-2 text-left"
              key={`${image.url}-${index}`}
              onClick={() => openImage(index)}
              type="button"
            >
              <img
                alt={`结果图 ${index + 1}`}
                className="aspect-square w-full rounded-sm object-cover"
                src={imagePreviewSrc(image)}
              />
              <span className="mt-2 block truncate text-xs text-muted-foreground">
                {image.printId ?? image.artifactId ?? `结果 ${index + 1}`}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-md bg-muted px-3 py-8 text-center text-sm text-muted-foreground">
          当前任务暂无图片输出
        </div>
      )}

      <ImageLightbox
        activeIndex={activeIndex}
        items={previewItems}
        title="图片预览"
        onActiveIndexChange={setActiveIndex}
      />
    </div>
  )
}
