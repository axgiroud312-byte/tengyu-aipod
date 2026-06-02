import type { CustomerAccount } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsert = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    customerAccount: {
      upsert,
    },
  },
}))

const { resolveCustomerAuthorizationStatus, verifyAndSyncCustomerAccount } = await import(
  './customer-accounts'
)

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
})
