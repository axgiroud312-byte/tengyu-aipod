import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAdminPlatformRule = vi.fn()
const updatePlatformRule = vi.fn()

vi.mock('@/lib/platform-rules', () => ({
  getAdminPlatformRule,
  platformRuleCategories: ['collection', 'listing'],
  updatePlatformRule,
}))

const { GET, PATCH } = await import('./route')

const payload = {
  key: 'temu',
  name: 'Temu',
  category: 'collection',
  rules_json: '{"allowed_domains":["temu.com"]}',
  enabled: true,
  version: '20260524-01',
}

beforeEach(() => {
  getAdminPlatformRule.mockReset().mockResolvedValue({ key: 'temu' })
  updatePlatformRule.mockReset().mockResolvedValue({ key: 'temu' })
})

describe('admin platform rule detail API', () => {
  it('loads a platform rule by key', async () => {
    const response = await GET(new Request('https://tengyu.test/admin/api/platform-rules/temu'), {
      params: Promise.resolve({ key: 'temu' }),
    })

    expect(response.status).toBe(200)
    expect(getAdminPlatformRule).toHaveBeenCalledWith('temu')
  })

  it('updates the selected platform rule', async () => {
    const response = await PATCH(
      new Request('https://tengyu.test/admin/api/platform-rules/temu', {
        method: 'PATCH',
        body: JSON.stringify({ ...payload, enabled: false }),
      }),
      { params: Promise.resolve({ key: 'temu' }) },
    )

    expect(response.status).toBe(200)
    expect(updatePlatformRule).toHaveBeenCalledWith(
      'temu',
      expect.objectContaining({ key: 'temu', enabled: false }),
    )
  })

  it('returns 404 when the platform rule does not exist', async () => {
    getAdminPlatformRule.mockResolvedValueOnce(null)

    const response = await PATCH(
      new Request('https://tengyu.test/admin/api/platform-rules/missing', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ key: 'missing' }) },
    )

    expect(response.status).toBe(404)
    expect(updatePlatformRule).not.toHaveBeenCalled()
  })
})
