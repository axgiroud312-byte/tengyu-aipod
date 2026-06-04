import { describe, expect, it } from 'vitest'
import { DETECTION_MODEL_PRICES, VISION_MODEL_PRICES, listVisionModels } from './constants'

describe('vision model constants', () => {
  it('lists the shared Bailian vision model in UI order', () => {
    expect(listVisionModels().map((model) => model.key)).toEqual([
      'qwen3.6-flash',
      'qwen3-vl-flash',
    ])
  })

  it('returns copies so callers cannot mutate the shared options', () => {
    const [firstModel] = listVisionModels()
    expect(firstModel).toBeDefined()
    if (!firstModel) {
      return
    }

    firstModel.label = 'changed'

    expect(listVisionModels()[0]?.label).toBe('qwen3.6-flash')
    expect(listVisionModels()[1]?.label).toBe('qwen3-vl-flash')
  })

  it('keeps detection prices backed by the shared vision prices', () => {
    expect(DETECTION_MODEL_PRICES).toBe(VISION_MODEL_PRICES)
  })

  it('includes qwen3-vl-flash pricing', () => {
    expect(VISION_MODEL_PRICES['qwen3-vl-flash']).toEqual({
      input: 0.15,
      output: 1.5,
    })
  })
})
