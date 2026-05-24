import { describe, expect, it } from 'vitest'
import {
  LISTING_ERROR_CODE_TO_APP_ERROR_CODE,
  type ListingConfig,
  type ListingItem,
  type ListingResult,
  SLICE_8_LISTING_TEMPLATES,
  type StageResult,
  type WorkspaceResult,
  createListingFailure,
  isListingRetryable,
  listingFailureFromAppError,
} from './listing-types'

describe('listing shared types', () => {
  it('defines the three Slice 8 v1 templates and real material roots', () => {
    expect(SLICE_8_LISTING_TEMPLATES.map((template) => template.key)).toEqual([
      'temu-clothing',
      'temu-general',
      'shein',
    ])
    expect(SLICE_8_LISTING_TEMPLATES[0]).toMatchObject({
      platform: 'temu-pop',
      editUrl: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515',
      materialRootDir: '/Users/macmini/Desktop/服装素材摆放举例',
      excludedFolderNames: ['GzG00010'],
    })
    expect(SLICE_8_LISTING_TEMPLATES[1]?.materialRootDir).toBe('/Users/macmini/Desktop/素材文件夹')
    expect(SLICE_8_LISTING_TEMPLATES[2]?.editUrl).toBe(
      'https://www.dianxiaomi.com/web/sheinProduct/edit?id=128935201966452551',
    )
  })

  it('maps listing errors to retryability and AppError codes', () => {
    expect(isListingRetryable('TIMEOUT')).toBe(true)
    expect(isListingRetryable('FIELD_VALUE_MISMATCH')).toBe(true)
    expect(isListingRetryable('SELECTOR_NOT_FOUND')).toBe(false)
    expect(isListingRetryable('DRAFT_NOT_FOUND')).toBe(false)

    expect(LISTING_ERROR_CODE_TO_APP_ERROR_CODE.PROFILE_LOCKED).toBe('PROFILE_LOCKED')
    expect(LISTING_ERROR_CODE_TO_APP_ERROR_CODE.SELECTOR_NOT_FOUND).toBe('SELECTOR_NOT_FOUND')
  })

  it('creates serializable listing failures with evidence paths', () => {
    const failure = createListingFailure({
      code: 'SELECTOR_NOT_FOUND',
      message: '标题输入框不存在',
      stage: 'replace_title',
      selector: 'css=input[name=title]',
      url: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515',
      screenshotPath: 'evidence/title.png',
      domSnapshotPath: 'evidence/title.html',
      cause: new Error('locator timeout'),
    })

    expect(failure).toEqual({
      code: 'SELECTOR_NOT_FOUND',
      appErrorCode: 'SELECTOR_NOT_FOUND',
      message: '标题输入框不存在',
      retryable: false,
      stage: 'replace_title',
      selector: 'css=input[name=title]',
      url: 'https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515',
      screenshotPath: 'evidence/title.png',
      domSnapshotPath: 'evidence/title.html',
      cause: 'locator timeout',
    })
  })

  it('converts AppError-shaped failures into listing failures', () => {
    expect(
      listingFailureFromAppError(
        { code: 'PROFILE_LOCKED', message: 'profile occupied', retryable: false },
        'enter_page',
      ),
    ).toMatchObject({
      code: 'PROFILE_LOCKED',
      appErrorCode: 'PROFILE_LOCKED',
      retryable: false,
      stage: 'enter_page',
    })
  })

  it('keeps runner-facing result types assignable', () => {
    const item: ListingItem = {
      id: 'item-1',
      sku: 'SKU-1',
      title: 'Listing title',
      platform: 'temu-pop',
      templateKey: 'temu-clothing',
      editUrl: SLICE_8_LISTING_TEMPLATES[0].editUrl,
      materialRootDir: SLICE_8_LISTING_TEMPLATES[0].materialRootDir,
      targetShopName: 'Shop A',
      imageGroups: {
        sku: ['sku.png'],
        carousel: [],
        material: ['material.png'],
        preview: [],
        description: [],
      },
      variantGroups: [],
      videoPaths: ['video.mp4'],
    }
    const config: ListingConfig = {
      batchId: 'batch-1',
      profileId: '2-1111',
      template: SLICE_8_LISTING_TEMPLATES[0],
      submitMode: 'save-draft',
      maxAttempts: 2,
      timeoutMs: 30_000,
      evidenceDir: 'output/listing/batch-1',
    }
    const stage: StageResult = {
      stage: 'replace_title',
      ok: true,
      startedAt: 1,
      endedAt: 2,
      details: { sku: item.sku },
    }
    const result: ListingResult = {
      itemId: item.id,
      sku: item.sku,
      status: 'success',
      attemptCount: 1,
      startedAt: 1,
      endedAt: 3,
      stages: [stage],
      editUrl: item.editUrl,
      evidenceDir: config.evidenceDir,
    }
    const workspace: WorkspaceResult = {
      profileId: config.profileId,
      platform: item.platform,
      templateKey: item.templateKey,
      totalCount: 1,
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
      results: [result],
    }

    expect(workspace).toMatchObject({
      profileId: '2-1111',
      totalCount: 1,
      successCount: 1,
    })
  })
})
