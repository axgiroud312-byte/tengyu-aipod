import type { Admin } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { serializeAdmin } from './admins'

describe('admin account helpers', () => {
  it('serializes admins without password hashes', () => {
    const now = new Date('2026-06-02T00:00:00.000Z')
    const admin: Admin = {
      created_at: now,
      email: 'admin@example.com',
      id: 'admin-1',
      is_active: true,
      last_login_at: null,
      name: '管理员',
      password_hash: 'hashed-password',
      role: 'super',
    }

    const serialized = serializeAdmin(admin)

    expect(serialized).toEqual({
      created_at: now.toISOString(),
      email: 'admin@example.com',
      id: 'admin-1',
      is_active: true,
      last_login_at: null,
      name: '管理员',
      role: 'super',
    })
    expect(serialized).not.toHaveProperty('password_hash')
  })
})
