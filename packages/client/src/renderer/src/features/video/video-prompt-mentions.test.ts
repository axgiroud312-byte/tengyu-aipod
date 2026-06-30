import { describe, expect, it } from 'vitest'
import {
  buildVideoReferenceToken,
  filterVideoPromptReferenceOptions,
  findVideoPromptMention,
  replaceVideoPromptRange,
} from './video-prompt-mentions'

describe('video prompt mentions', () => {
  it('builds a numbered reference token', () => {
    expect(buildVideoReferenceToken(2)).toBe('[Image 2]')
  })

  it('finds an active mention after @', () => {
    expect(findVideoPromptMention('让 @ima 走向镜头', 6)).toEqual({
      start: 2,
      end: 6,
      query: 'ima',
    })
  })

  it('ignores mentions that already contain whitespace', () => {
    expect(findVideoPromptMention('让 @ima test', 9)).toBeNull()
  })

  it('filters reference options by token, index, or file name', () => {
    expect(
      filterVideoPromptReferenceOptions(
        [
          { path: '/tmp/look-1.png', name: 'look-1.png' },
          { path: '/tmp/shirt.png', name: 'shirt.png' },
        ],
        'shirt',
      ),
    ).toEqual([
      {
        index: 2,
        token: '[Image 2]',
        name: 'shirt.png',
        path: '/tmp/shirt.png',
      },
    ])
  })

  it('replaces a range and returns the next caret position', () => {
    expect(replaceVideoPromptRange('让 @2 走向镜头', 2, 4, '[Image 2]')).toEqual({
      value: '让 [Image 2] 走向镜头',
      caret: 11,
    })
  })
})
