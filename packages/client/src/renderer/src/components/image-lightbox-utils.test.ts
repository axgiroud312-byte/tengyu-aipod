import { describe, expect, it } from 'vitest'
import { nextImageIndex } from './image-lightbox-utils'

describe('image lightbox utils', () => {
  it('moves to the next image', () => {
    expect(nextImageIndex(1, 3, 1)).toBe(2)
  })

  it('wraps from the last image to the first image', () => {
    expect(nextImageIndex(2, 3, 1)).toBe(0)
  })

  it('wraps from the first image to the last image', () => {
    expect(nextImageIndex(0, 3, -1)).toBe(2)
  })

  it('returns null when there are no images', () => {
    expect(nextImageIndex(0, 0, 1)).toBeNull()
  })
})
