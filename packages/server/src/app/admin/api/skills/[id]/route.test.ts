import { describe, expect, it, vi } from 'vitest'

const deleteSkill = vi.fn()

vi.mock('@/lib/skills', () => ({
  createSkillVersion: vi.fn(),
  deleteSkill,
  getAdminSkill: vi.fn(),
  nextPatchVersion: vi.fn(),
  updateExistingSkillVersion: vi.fn(),
}))

const { DELETE } = await import('./route')

describe('admin skill detail API', () => {
  it('permanently deletes a skill and returns the deleted version count', async () => {
    deleteSkill.mockResolvedValueOnce(3)

    const response = await DELETE(
      new Request('http://server.test/admin/api/skills/txt2img-local-print', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'txt2img-local-print' }) },
    )

    await expect(response.json()).resolves.toMatchObject({
      data: { deleted_count: 3 },
      ok: true,
    })
    expect(deleteSkill).toHaveBeenCalledWith('txt2img-local-print')
  })

  it('returns not found when no skill versions were deleted', async () => {
    deleteSkill.mockResolvedValueOnce(0)

    const response = await DELETE(
      new Request('http://server.test/admin/api/skills/missing-skill', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'missing-skill' }) },
    )

    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SKILL_NOT_FOUND' },
      ok: false,
    })
    expect(response.status).toBe(404)
  })
})
