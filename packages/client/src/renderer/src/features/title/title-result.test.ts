import { describe, expect, it } from 'vitest'
import type { TitleBatchResult } from '../../../../main/lib/title-service'
import { mergeTitleBatchResult } from './title-result'

function batchResult(
  overrides: Partial<TitleBatchResult> & Pick<TitleBatchResult, 'taskId' | 'results'>,
): TitleBatchResult {
  return {
    xlsxPath: 'C:\\batch\\标题.xlsx',
    total: overrides.results.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    ...overrides,
  }
}

describe('mergeTitleBatchResult', () => {
  it('replaces retried rows, preserves other rows, appends new rows, and recounts the batch', () => {
    const current = batchResult({
      taskId: 'task-original',
      results: [
        {
          skuCode: 'SKU001',
          status: 'success',
          title: 'Original title',
          imagePath: 'C:\\batch\\SKU001\\1.png',
        },
        { skuCode: 'SKU002', status: 'skipped', title: 'Existing title' },
        { skuCode: 'SKU003', status: 'failed', error: 'NO_IMAGE' },
      ],
    })
    const retry = batchResult({
      taskId: 'task-retry',
      diagnosticsLogPath: 'C:\\logs\\retry.jsonl',
      results: [
        {
          skuCode: 'SKU003',
          status: 'success',
          title: 'Retried title',
          imagePath: 'C:\\batch\\SKU003\\1.png',
        },
        { skuCode: 'SKU004', status: 'failed', error: 'provider unavailable' },
      ],
    })

    expect(mergeTitleBatchResult(current, retry)).toEqual({
      ...retry,
      total: 4,
      succeeded: 2,
      failed: 1,
      skipped: 1,
      results: [current.results[0], current.results[1], retry.results[0], retry.results[1]],
    })
  })
})
