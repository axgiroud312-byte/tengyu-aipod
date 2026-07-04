import { describe, expect, it } from 'vitest'
import { matchesPhpUidTarget, parsePhpUidAllowlist, parsePhpUidAllowlistInput } from './targeting'

describe('targeting helpers', () => {
  it('matches all targets without a uid', () => {
    expect(matchesPhpUidTarget({ scope: 'all', targetPhpUidsJson: '[]', uid: null })).toBe(true)
  })

  it('matches php uid allowlists only when the uid is included', () => {
    expect(
      matchesPhpUidTarget({
        scope: 'php_uid_list',
        targetPhpUidsJson: '[123,456]',
        uid: 123,
      }),
    ).toBe(true)
    expect(
      matchesPhpUidTarget({
        scope: 'php_uid_list',
        targetPhpUidsJson: '[123,456]',
        uid: 789,
      }),
    ).toBe(false)
  })

  it('treats malformed allowlists as empty lists', () => {
    expect(parsePhpUidAllowlist('not-json')).toEqual([])
  })

  it('rejects malformed uid allowlist input for Admin writes', () => {
    expect(parsePhpUidAllowlistInput('123, 456')).toEqual({ ok: true, uids: [123, 456] })
    expect(parsePhpUidAllowlistInput('123, abc')).toEqual({ ok: false, uids: [] })
  })
})
