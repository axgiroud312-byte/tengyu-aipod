import { describe, expect, it } from 'vitest'
import { classifyPhotoshopTemplatePath, type PsdTemplate } from './photoshop'

function template(
  overrides: Partial<Pick<PsdTemplate, 'native_slices' | 'smart_objects'>> = {},
): Pick<PsdTemplate, 'native_slices' | 'smart_objects'> {
  return {
    smart_objects: [
      {
        name: 'SO 1',
        path: 'SO 1',
        sort_order: 0,
        is_top_level: true,
        bounds: [0, 0, 100, 100],
        shared_indicator: 'a',
      },
    ],
    native_slices: [{ name: 'Front', kind: 'user', bounds: [0, 0, 500, 500] }],
    ...overrides,
  }
}

describe('classifyPhotoshopTemplatePath', () => {
  it('marks templates with slices and smart objects as fast_path_ok', () => {
    expect(classifyPhotoshopTemplatePath(template())).toEqual({
      export_path: 'native_slice',
      tags: ['fast_path_ok'],
      native_slice_count: 1,
      smart_object_count: 1,
    })
  })

  it('marks missing slices as slow_export crop fallback', () => {
    expect(classifyPhotoshopTemplatePath(template({ native_slices: [] }))).toEqual({
      export_path: 'crop_fallback',
      tags: ['slow_export'],
      native_slice_count: 0,
      smart_object_count: 1,
    })
  })

  it('marks missing smart objects without claiming fast path', () => {
    expect(
      classifyPhotoshopTemplatePath(
        template({
          smart_objects: [],
          native_slices: [{ name: 'Front', kind: 'user', bounds: [0, 0, 500, 500] }],
        }),
      ),
    ).toEqual({
      export_path: 'native_slice',
      tags: ['no_smart_object'],
      native_slice_count: 1,
      smart_object_count: 0,
    })
  })
})
