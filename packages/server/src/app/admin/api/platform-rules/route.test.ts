import { beforeEach, describe, expect, it, vi } from 'vitest'

const createPlatformRule = vi.fn()
const listAdminPlatformRules = vi.fn()

vi.mock('@/lib/platform-rules', () => ({
  createPlatformRule,
  listAdminPlatformRules,
  platformRuleCategories: ['collection', 'listing'],
}))

const { GET, POST } = await import('./route')

beforeEach(() => {
  createPlatformRule.mockReset().mockResolvedValue({ key: 'temu' })
  listAdminPlatformRules.mockReset().mockResolvedValue([{ key: 'temu' }])
})

describe('admin platform rules API', () => {
  it('passes category filter to admin platform rule list', async () => {
    const response = await GET(
      new Request('https://tengyu.test/admin/api/platform-rules?category=collection'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { items: [{ key: 'temu' }] },
    })
    expect(listAdminPlatformRules).toHaveBeenCalledWith({ category: 'collection' })
  })

  it('creates a platform rule with rules_json preserved as text', async () => {
    const response = await POST(
      new Request('https://tengyu.test/admin/api/platform-rules', {
        method: 'POST',
        body: JSON.stringify({
          key: 'temu',
          name: 'Temu',
          category: 'collection',
          rules_json: '{"allowed_domains":["temu.com"]}',
          enabled: true,
          version: '20260524-01',
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(createPlatformRule).toHaveBeenCalledWith({
      key: 'temu',
      name: 'Temu',
      category: 'collection',
      rules_json: '{"allowed_domains":["temu.com"]}',
      enabled: true,
      version: '20260524-01',
    })
  })

  it('rejects malformed rules_json', async () => {
    const response = await POST(
      new Request('https://tengyu.test/admin/api/platform-rules', {
        method: 'POST',
        body: JSON.stringify({
          key: 'bad',
          name: 'Bad',
          category: 'collection',
          rules_json: 'not-json',
          enabled: true,
          version: '20260524-01',
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(createPlatformRule).not.toHaveBeenCalled()
  })
})
