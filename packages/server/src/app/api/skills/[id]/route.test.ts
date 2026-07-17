import { describe, expect, it, vi } from 'vitest'

const getSkill = vi.fn()

vi.mock('@/lib/skills', () => ({ getSkill }))

const { GET } = await import('./route')

describe('public skill detail API', () => {
  it('rejects anonymous requests before loading the system prompt', async () => {
    const response = await GET(new Request('http://server.test/api/skills/title-temu-en'), {
      params: Promise.resolve({ id: 'title-temu-en' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CUSTOMER_AUTH_REQUIRED' },
      ok: false,
    })
    expect(getSkill).not.toHaveBeenCalled()
  })
})
