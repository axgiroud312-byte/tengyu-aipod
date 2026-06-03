import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unexpected path: ${name}`)
      }
      return userDataDir
    },
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

const { CustomerAuthService, resolvePhpAuthBaseUrl } = await import('./customer-auth')

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}

function customer(overrides: Record<string, unknown> = {}) {
  return {
    account: 'demo-account',
    avatar_url: 'https://example.com/avatar.png',
    expires_at: '2026-12-31T00:00:00.000Z',
    id: 'customer-1',
    nickname: 'Demo User',
    phone: '13800000000',
    php_uid: 123,
    ...overrides,
  }
}

function createSecretStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    deleteSecret: vi.fn(async (key: string) => {
      values.delete(key)
    }),
    getSecret: vi.fn(async (key: string) => values.get(key) ?? null),
    setSecret: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
    values,
  }
}

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'tengyu-customer-auth-'))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(userDataDir, { recursive: true, force: true })
})

describe('CustomerAuthService', () => {
  it('normalizes PHP auth base URL', () => {
    expect(resolvePhpAuthBaseUrl('https://tengyuai.com///')).toBe('https://tengyuai.com')
    expect(resolvePhpAuthBaseUrl('')).toBe('https://tengyuai.com')
  })

  it('logs in by phone, verifies with Next, and does not write secret into state', async () => {
    const secretStore = createSecretStore()
    const requests: Array<{ body: unknown; url: string }> = []
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        url: String(url),
      })
      if (String(url).endsWith('/user/public/login')) {
        return jsonResponse({ data: { secret: 'php-secret', uid: 123 }, status: 1 })
      }
      if (String(url).endsWith('/api/customer-auth/verify')) {
        return jsonResponse({
          data: { customer: customer({ expires_at: null }), status: 'pending' },
          ok: true,
          status: 'pending',
        })
      }
      throw new Error(`unexpected URL: ${String(url)}`)
    })
    const service = new CustomerAuthService({
      fetcher: fetch,
      secretStore,
    })

    const state = await service.loginByPhone({
      code: '246810',
      invite: 'INVITE',
      phone: '13800000000',
    })
    const phoneRequest = requests[0]
    const verifyRequest = requests[1]

    expect(phoneRequest).toBeDefined()
    expect(verifyRequest).toBeDefined()

    expect(state.status).toBe('pending')
    expect(phoneRequest).toMatchObject({
      body: {
        code: '246810',
        invite: 'INVITE',
        method: 'phone',
        phone: '13800000000',
      },
      url: 'https://tengyuai.com/user/public/login',
    })
    expect(phoneRequest?.body).toHaveProperty('finger')
    expect(verifyRequest).toMatchObject({
      body: {
        secret: 'php-secret',
        uid: 123,
      },
      url: 'http://127.0.0.1:3100/api/customer-auth/verify',
    })
    expect(verifyRequest?.body).toHaveProperty(
      'finger',
      (phoneRequest?.body as { finger: string }).finger,
    )
    expect(JSON.stringify(state)).not.toContain('php-secret')
    await expect(readFile(join(userDataDir, 'customer-auth.json'), 'utf8')).resolves.not.toContain(
      'php-secret',
    )
  })

  it('checks WeChat login with token and finger before authorization verify', async () => {
    const secretStore = createSecretStore()
    const requests: Array<{ body: unknown; url: string }> = []
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        url: String(url),
      })
      if (String(url).endsWith('/api/wxlogin/check_login')) {
        return jsonResponse({ data: { secret: 'wechat-secret', uid: 123 }, status: 1 })
      }
      if (String(url).endsWith('/api/customer-auth/verify')) {
        return jsonResponse({
          data: { customer: customer(), status: 'active' },
          ok: true,
          status: 'active',
        })
      }
      throw new Error(`unexpected URL: ${String(url)}`)
    })
    const service = new CustomerAuthService({
      fetcher: fetch,
      secretStore,
    })

    const state = await service.checkWechatLogin({ token: 'wx-token' })
    const wechatRequest = requests[0]
    const verifyRequest = requests[1]

    expect(wechatRequest).toBeDefined()
    expect(verifyRequest).toBeDefined()

    expect(state.status).toBe('active')
    expect(wechatRequest).toMatchObject({
      body: { token: 'wx-token' },
      url: 'https://tengyuai.com/api/wxlogin/check_login',
    })
    expect(wechatRequest?.body).toHaveProperty('finger')
    expect(verifyRequest).toMatchObject({
      body: {
        secret: 'wechat-secret',
        uid: 123,
      },
      url: 'http://127.0.0.1:3100/api/customer-auth/verify',
    })
  })

  it('sends SMS with demo-compatible request body and starts countdown', async () => {
    const secretStore = createSecretStore()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ info: 'sent', status: 1 }))
    const service = new CustomerAuthService({
      fetcher: fetch,
      now: () => 1_000,
      secretStore,
    })

    await expect(service.sendSms({ phone: '13800000000' })).resolves.toEqual({
      message: 'sent',
      ok: true,
      remaining_seconds: 60,
    })
    expect(fetch).toHaveBeenCalledWith('https://tengyuai.com/user/public/send_login_sms', {
      body: JSON.stringify({ phone: '13800000000' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    await expect(service.getSmsCountdown()).resolves.toEqual({ remaining_seconds: 60 })
  })

  it('clears saved credentials when Next returns nologin', async () => {
    const secretStore = createSecretStore({
      'customer-auth.php-secret': 'stale-secret',
      'customer-auth.php-uid': '123',
    })
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: { code: 'CUSTOMER_LOGIN_EXPIRED', message: '登录状态失效' },
          ok: false,
          status: 'nologin',
        },
        401,
      ),
    )
    const service = new CustomerAuthService({
      fetcher: fetch,
      secretStore,
    })

    await expect(service.verify()).resolves.toMatchObject({
      customer: null,
      message: '登录状态失效',
      status: 'nologin',
    })
    expect(secretStore.values.has('customer-auth.php-secret')).toBe(false)
    expect(secretStore.values.has('customer-auth.php-uid')).toBe(false)
  })
})
