import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    announcement: {
      findMany,
    },
  },
}))

const { listActiveAnnouncements } = await import('./announcements')

const now = new Date('2026-07-02T10:00:00.000Z')

function announcement(overrides = {}) {
  return {
    content: 'Content',
    created_at: now,
    enabled: true,
    end_at: null,
    id: 'ann_1',
    level: 'info',
    start_at: new Date('2026-07-01T00:00:00.000Z'),
    target_php_uids_json: '[]',
    target_scope: 'all',
    title: 'Notice',
    ...overrides,
  }
}

beforeEach(() => {
  findMany.mockReset()
})

describe('announcements queries', () => {
  it('returns active announcements matching the customer uid', async () => {
    findMany.mockResolvedValueOnce([
      announcement({ id: 'global' }),
      announcement({
        id: 'matched',
        target_php_uids_json: '[123]',
        target_scope: 'php_uid_list',
      }),
      announcement({
        id: 'hidden',
        target_php_uids_json: '[456]',
        target_scope: 'php_uid_list',
      }),
    ])

    await expect(listActiveAnnouncements({ now, uid: 123 })).resolves.toMatchObject([
      { id: 'global' },
      { id: 'matched' },
    ])
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          enabled: true,
          start_at: { lte: now },
        }),
      }),
    )
  })
})
