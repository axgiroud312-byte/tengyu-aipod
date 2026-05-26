import { describe, expect, it } from 'vitest'
import { control, createState, imageSection, textField, toast } from './test-helpers'

describe('listing test helpers commons', () => {
  it('creates text and control fixture fragments', () => {
    expect(textField('title')).toMatchObject({
      found: true,
      current_value: 'title',
      is_disabled: false,
    })
    expect(control('保存')).toMatchObject({
      found: true,
      enabled: true,
      text: '保存',
    })
  })

  it('creates image and toast fixture fragments', () => {
    expect(imageSection(3)).toMatchObject({
      found: true,
      count: 3,
    })
    expect(imageSection(4, { kind: 'upload' })).toMatchObject({
      found: true,
      image_count: 4,
      upload_button_found: true,
      upload_button_enabled: true,
    })
    expect(toast(null)).toEqual({
      found: false,
      message: null,
      selector: null,
    })
  })

  it('creates shallow state overrides', () => {
    expect(createState({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 })
  })
})
