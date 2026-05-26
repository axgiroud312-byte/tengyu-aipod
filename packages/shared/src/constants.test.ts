import { describe, expect, it } from 'vitest'
import { DETECTION_MODEL_PRICES, VISION_MODEL_PRICES, listVisionModels } from './constants'

describe('vision model constants', () => {
  it('lists the shared five vision models in UI order', () => {
    expect(listVisionModels().map((model) => model.key)).toEqual([
      'qwen3-vl-plus',
      'qwen3-vl-flash',
      'qwen-vl-max',
      'qwen-vl-plus',
      'qwen3.6-plus',
    ])
  })

  it('returns copies so callers cannot mutate the shared options', () => {
    const [firstModel] = listVisionModels()
    expect(firstModel).toBeDefined()
    if (!firstModel) {
      return
    }

    firstModel.label = 'changed'

    expect(listVisionModels()[0]?.label).toBe('qwen3-vl-plus')
  })

  it('keeps detection prices backed by the shared vision prices', () => {
    expect(DETECTION_MODEL_PRICES).toBe(VISION_MODEL_PRICES)
  })
})
