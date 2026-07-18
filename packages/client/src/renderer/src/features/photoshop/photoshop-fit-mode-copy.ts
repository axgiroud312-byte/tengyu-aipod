import { t } from '@/locale/t'
import type { PhotoshopInnerFitMode } from '@tengyu-aipod/shared'

export const photoshopFitModeOptions: Array<{
  key: PhotoshopInnerFitMode
  label: string
}> = [
  { key: 'fill', label: t('铺满（适合满版印花）') },
  { key: 'fit', label: t('完整显示（适合局部印花）') },
]

const descriptions: Record<PhotoshopInnerFitMode, string> = {
  fill: t('适合满版图案、背景或无缝纹理；比例不一致时可能裁切边缘。'),
  fit: t('适合 Logo、文字和胸前图案；完整保留内容，比例不一致时可能留透明边。'),
}

export function photoshopFitModeDescription(mode: PhotoshopInnerFitMode) {
  return descriptions[mode]
}
