import { describe, expect, it, vi } from 'vitest'
import { fetchPhpUserInfo } from './php-auth'

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('php auth client', () => {
  it('posts uid, secret and finger to the PHP user info endpoint', async () => {
    vi.stubEnv('PHP_AUTH_BASE_URL', 'https://php.example.test/')
    const calls: Array<{ body: unknown; url: string }> = []
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({
        body: JSON.parse(String(init?.body)),
        url: String(url),
      })
      return jsonResponse({
        data: {
          account: 'test001',
          avatar: 'https://php.example.test/avatar.png',
          nickname: 'TEST',
          tel: '13800138000',
          uid: 123,
        },
        info: '用户信息接口',
        status: 1,
      })
    }

    await expect(
      fetchPhpUserInfo({ finger: 'finger-1', secret: 'php-secret', uid: 123 }, { fetcher }),
    ).resolves.toEqual({
      ok: true,
      user: {
        account: 'test001',
        avatar_url: 'https://php.example.test/avatar.png',
        nickname: 'TEST',
        phone: '13800138000',
        php_uid: 123,
      },
    })

    expect(calls).toEqual([
      {
        body: { finger: 'finger-1', secret: 'php-secret', uid: 123 },
        url: 'https://php.example.test/user/user/info',
      },
    ])
  })

  it('returns nologin when PHP marks the login state invalid', async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({
        info: '登录状态失效，请重新登录',
        nologin: 1,
        status: 0,
      })

    await expect(
      fetchPhpUserInfo({ finger: 'finger-1', secret: 'php-secret', uid: 123 }, { fetcher }),
    ).resolves.toEqual({
      message: '登录状态失效，请重新登录',
      ok: false,
      reason: 'nologin',
    })
  })
})
