import { describe, expect, it, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect,
}))

const { default: HomePage } = await import('./page')

describe('HomePage', () => {
  it('redirects service root to admin', () => {
    HomePage()

    expect(redirect).toHaveBeenCalledWith('/admin')
  })
})
