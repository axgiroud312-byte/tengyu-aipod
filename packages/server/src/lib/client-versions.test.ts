import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    clientVersion: {
      findMany,
    },
  },
}))

const { checkClientVersion } = await import('./client-versions')

const publishedAt = new Date('2026-07-02T00:00:00.000Z')

function version(overrides = {}) {
  return {
    channel: 'stable',
    changelog: 'Changed',
    download_url_mac: null,
    download_url_win: 'https://example.test/app.exe',
    enabled: true,
    force_upgrade: false,
    platform: 'windows',
    published_at: publishedAt,
    target_php_uids_json: '[]',
    target_scope: 'all',
    version: '1.0.0',
    ...overrides,
  }
}

beforeEach(() => {
  findMany.mockReset()
})

describe('client version queries', () => {
  it('returns the latest matching enabled version for platform channel and uid', async () => {
    findMany.mockResolvedValueOnce([
      version({ version: '1.0.1' }),
      version({
        target_php_uids_json: '[456]',
        target_scope: 'php_uid_list',
        version: '1.0.3',
      }),
      version({
        force_upgrade: true,
        target_php_uids_json: '[123]',
        target_scope: 'php_uid_list',
        version: '1.0.2',
      }),
    ])

    await expect(
      checkClientVersion({
        channel: 'stable',
        current: '1.0.0',
        platform: 'windows',
        uid: 123,
      }),
    ).resolves.toMatchObject({
      force_upgrade: true,
      latest_version: '1.0.2',
      update_available: true,
    })
  })
})
