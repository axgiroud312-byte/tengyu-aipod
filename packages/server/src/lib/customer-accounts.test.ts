import type { CustomerAccount } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
const update = vi.fn()
const upsert = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    customerAccount: {
      findMany,
      update,
      upsert,
    },
  },
}))

const {
  getCustomerExpirationStats,
  listCustomerAccounts,
  resolveCustomerAuthorizationStatus,
  verifyAndSyncCustomerAccount,
} = await import('./customer-accounts')

const now = new Date('2026-06-02T00:00:00.000Z')

function account(overrides: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    account: 'test001',
    approved_at: null,
    approved_by_admin_id: null,
    avatar_url: 'https://example.test/avatar.png',
    created_at: now,
    disabled_at: null,
    expires_at: null,
    id: 'cus_1',
    last_login_at: now,
    nickname: 'TEST',
    notes: null,
    phone: '13800138000',
    php_uid: 123,
    status: 'pending',
    updated_at: now,
    ...overrides,
  }
}

function phpUser() {
  return {
    account: 'test001',
    avatar_url: 'https://example.test/avatar.png',
    nickname: 'TEST',
    phone: '13800138000',
    php_uid: 123,
  }
}

beforeEach(() => {
  findMany.mockReset()
  update.mockReset()
  upsert.mockReset()
})

describe('customer account authorization', () => {
  it('creates first-login customers as pending and never writes the PHP secret', async () => {
    upsert.mockResolvedValueOnce(account())

    const result = await verifyAndSyncCustomerAccount(
      { finger: 'finger-1', secret: 'php-secret', uid: 123 },
      {
        now,
        verifyPhpUserInfo: async () => ({ ok: true, user: phpUser() }),
      },
    )

    expect(result).toMatchObject({ ok: true, status: 'pending' })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(upsert.mock.calls[0]?.[0])).not.toContain('php-secret')
  })

  it('returns active when the account is active and not expired', async () => {
    upsert.mockResolvedValueOnce(
      account({
        expires_at: new Date('2026-12-31T23:59:59.000Z'),
        status: 'active',
      }),
    )

    await expect(
      verifyAndSyncCustomerAccount(
        { finger: 'finger-1', secret: 'php-secret', uid: 123 },
        {
          now,
          verifyPhpUserInfo: async () => ({ ok: true, user: phpUser() }),
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: 'active' })
  })

  it('returns expired when an active account is past expires_at', async () => {
    upsert.mockResolvedValueOnce(
      account({
        expires_at: new Date('2026-01-01T00:00:00.000Z'),
        status: 'active',
      }),
    )

    await expect(
      verifyAndSyncCustomerAccount(
        { finger: 'finger-1', secret: 'php-secret', uid: 123 },
        {
          now,
          verifyPhpUserInfo: async () => ({ ok: true, user: phpUser() }),
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: 'expired' })
  })

  it('returns disabled for disabled accounts', async () => {
    upsert.mockResolvedValueOnce(account({ status: 'disabled' }))

    await expect(
      verifyAndSyncCustomerAccount(
        { finger: 'finger-1', secret: 'php-secret', uid: 123 },
        {
          now,
          verifyPhpUserInfo: async () => ({ ok: true, user: phpUser() }),
        },
      ),
    ).resolves.toMatchObject({ ok: true, status: 'disabled' })
  })

  it('does not create customer accounts when PHP returns nologin', async () => {
    const result = await verifyAndSyncCustomerAccount(
      { finger: 'finger-1', secret: 'php-secret', uid: 123 },
      {
        now,
        verifyPhpUserInfo: async () => ({
          message: '登录状态失效，请重新登录',
          ok: false,
          reason: 'nologin',
        }),
      },
    )

    expect(result).toEqual({
      message: '登录状态失效，请重新登录',
      ok: false,
      reason: 'nologin',
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('computes missing active expires_at as expired', () => {
    expect(resolveCustomerAuthorizationStatus(account({ status: 'active' }), now)).toBe('expired')
  })

  it('counts customer expiration buckets from computed authorization status', () => {
    const stats = getCustomerExpirationStats(
      [
        account({ id: 'pending', status: 'pending' }),
        account({
          id: 'expired',
          expires_at: new Date('2026-06-01T23:59:59.000Z'),
          status: 'active',
        }),
        account({
          id: 'today',
          expires_at: new Date('2026-06-02T12:00:00.000Z'),
          status: 'active',
        }),
        account({ id: 'week', expires_at: new Date('2026-06-08T00:00:00.000Z'), status: 'active' }),
        account({
          id: 'month',
          expires_at: new Date('2026-06-30T00:00:00.000Z'),
          status: 'active',
        }),
        account({ id: 'disabled', status: 'disabled' }),
      ],
      now,
    )

    expect(stats).toEqual({
      disabled: 1,
      expired: 1,
      expires_7d: 2,
      expires_30d: 3,
      expires_today: 1,
      pending: 1,
    })
  })

  it('filters customer accounts and orders urgent accounts first', async () => {
    findMany.mockResolvedValueOnce([
      account({ id: 'disabled', status: 'disabled' }),
      account({ id: 'pending', status: 'pending' }),
      account({ id: 'active', expires_at: new Date('2026-12-31T00:00:00.000Z'), status: 'active' }),
      account({ id: 'month', expires_at: new Date('2026-06-30T00:00:00.000Z'), status: 'active' }),
      account({ id: 'week', expires_at: new Date('2026-06-08T00:00:00.000Z'), status: 'active' }),
      account({ id: 'today', expires_at: new Date('2026-06-02T12:00:00.000Z'), status: 'active' }),
      account({
        id: 'expired',
        expires_at: new Date('2026-06-01T00:00:00.000Z'),
        status: 'active',
      }),
    ])

    const accounts = await listCustomerAccounts({ filter: 'all', now, search: '' })

    expect(accounts.map((item) => item.id)).toEqual([
      'expired',
      'today',
      'week',
      'month',
      'pending',
      'active',
      'disabled',
    ])
  })

  it('filters active customer accounts without returning expired accounts', async () => {
    findMany.mockResolvedValueOnce([
      account({
        id: 'expired',
        expires_at: new Date('2026-06-01T00:00:00.000Z'),
        status: 'active',
      }),
      account({ id: 'active', expires_at: new Date('2026-12-31T00:00:00.000Z'), status: 'active' }),
    ])

    const accounts = await listCustomerAccounts({ filter: 'active', now, search: '' })

    expect(accounts.map((item) => item.id)).toEqual(['active'])
  })

  it('bulk approves pending accounts and skips rows that are not pending', async () => {
    findMany.mockResolvedValueOnce([
      account({ id: 'pending', status: 'pending' }),
      account({ id: 'active', expires_at: new Date('2026-12-31T00:00:00.000Z'), status: 'active' }),
    ])
    update.mockResolvedValueOnce(
      account({
        expires_at: new Date('2027-01-01T23:59:59.999Z'),
        id: 'pending',
        notes: 'Approved after renewal',
        status: 'active',
      }),
    )

    const { bulkUpdateCustomerAccounts } = await import('./customer-accounts')
    const result = await bulkUpdateCustomerAccounts({
      action: 'approve',
      adminId: 'admin-1',
      expiresAt: new Date('2027-01-01T23:59:59.999Z'),
      ids: ['pending', 'active'],
      note: 'Approved after renewal',
      now,
    })

    expect(result).toEqual({
      skipped: [{ id: 'active', reason: '只有待开通客户可批量授权' }],
      updated_count: 1,
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expires_at: new Date('2027-01-01T23:59:59.999Z'),
          notes: 'Approved after renewal',
          status: 'active',
        }),
        where: { id: 'pending' },
      }),
    )
  })

  it('bulk appends notes without replacing existing notes', async () => {
    findMany.mockResolvedValueOnce([account({ id: 'cus_1', notes: 'Old note' })])
    update.mockResolvedValueOnce(account({ id: 'cus_1', notes: 'Old note\nNew note' }))

    const { bulkUpdateCustomerAccounts } = await import('./customer-accounts')
    await expect(
      bulkUpdateCustomerAccounts({
        action: 'append_note',
        adminId: 'admin-1',
        ids: ['cus_1'],
        note: 'New note',
        now,
      }),
    ).resolves.toEqual({ skipped: [], updated_count: 1 })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { notes: 'Old note\nNew note' },
        where: { id: 'cus_1' },
      }),
    )
  })
})
