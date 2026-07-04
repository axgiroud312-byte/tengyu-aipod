import { describe, expect, it } from 'vitest'
import { listingStartValidationIssues } from './listing-workbench-validation'

describe('listing start validation', () => {
  it('points missing required configuration to concrete fields', () => {
    expect(
      listingStartValidationIssues({
        batchDir: '',
        draftTemplateId: '',
        itemCount: 0,
        selectedProfileCount: 0,
        targetShopName: '',
      }),
    ).toEqual([
      '请选择素材目录',
      '请填写草稿模板编号输入框',
      '请选择比特浏览器档案',
      '请先扫描素材目录',
      '请填写目标店铺名称',
    ])
  })
})
