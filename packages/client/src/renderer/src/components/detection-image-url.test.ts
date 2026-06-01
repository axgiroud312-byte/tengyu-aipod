import { describe, expect, it } from 'vitest'
import { detectionImageSrc, fileUrlLocalPath, localImageUrl } from './detection-image-url'

describe('detection image urls', () => {
  it('uses the local image protocol for absolute paths', () => {
    const path = '/Users/macmini/Desktop/闲聊/02-印花工作区/图生图/a.png'

    expect(detectionImageSrc({ path })).toBe(localImageUrl(path))
  })

  it('converts file thumbnail urls to the local image protocol', () => {
    const path = '/Users/macmini/Desktop/闲聊/02-印花工作区/图生图/a.png'
    const thumbnailUrl =
      'file:///Users/macmini/Desktop/%E9%97%B2%E8%81%8A/02-%E5%8D%B0%E8%8A%B1%E5%B7%A5%E4%BD%9C%E5%8C%BA/%E5%9B%BE%E7%94%9F%E5%9B%BE/a.png'

    expect(fileUrlLocalPath(thumbnailUrl)).toBe(path)
    expect(detectionImageSrc({ path: '', thumbnailUrl })).toBe(localImageUrl(path))
  })
})
