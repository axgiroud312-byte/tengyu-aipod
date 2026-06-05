import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CollectionFolderLock } from './collection-folder-lock'

describe('CollectionFolderLock', () => {
  it('blocks writes to the same collection folder and its descendants', () => {
    const lockManager = new CollectionFolderLock()
    const folder = '/tmp/workbench/01-采集工作区/temu-20260531-120000'
    const lock = lockManager.acquireRead(folder, {
      kind: 'pipeline',
      runId: 'run-1',
    })

    try {
      expect(() => lockManager.assertWritable(folder)).toThrow('完整任务正在读取该采集目录')
      expect(() => lockManager.assertWritable(join(folder, '商品页', 'SKU-001'))).toThrow(
        '完整任务正在读取该采集目录',
      )
      expect(() =>
        lockManager.assertWritable('/tmp/workbench/01-采集工作区/temu-20260531-120001'),
      ).not.toThrow()
    } finally {
      lock.release()
    }

    expect(() => lockManager.assertWritable(folder)).not.toThrow()
  })

  it('blocks parent folder writes that could reach a locked source folder', () => {
    const lockManager = new CollectionFolderLock()
    const folder = '/tmp/workbench/01-采集工作区/temu-20260531-120000/商品页/SKU-001'
    const lock = lockManager.acquireRead(folder, {
      kind: 'pipeline',
      runId: 'run-1',
    })

    try {
      expect(() =>
        lockManager.assertWritable('/tmp/workbench/01-采集工作区/temu-20260531-120000'),
      ).toThrow('完整任务正在读取该采集目录')
    } finally {
      lock.release()
    }
  })
})
