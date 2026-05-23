import { describe, expect, it } from 'vitest'
import {
  type ActivationStateFile,
  buildActivationBadgeState,
  extractActivationCodeSuffix,
} from './activation-state'

const DAY_MS = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 4, 23)

function snapshot(overrides: Partial<NonNullable<ActivationStateFile['activation']>> = {}) {
  const status = {
    status: 'active',
    days_remaining: 30,
    max_devices: 2,
    used_devices: 1,
    device_name: '我的电脑',
    customer: { name: '张三', has_contact: true },
  }

  return {
    completed_at: '2026-05-23T00:00:00.000Z',
    activation: {
      cached_status_json: JSON.stringify(status),
      last_server_check: now,
      token_code_suffix: 'ABCD',
      ...overrides,
    },
  } satisfies ActivationStateFile
}

function base64Url(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

describe('activation-state', () => {
  it('builds active badge state from cached status', () => {
    const badge = buildActivationBadgeState(snapshot(), { now })

    expect(badge.kind).toBe('active')
    expect(badge.tone).toBe('green')
    expect(badge.label).toBe('激活·剩余 30 天')
    expect(badge.deviceName).toBe('我的电脑')
    expect(badge.codeSuffix).toBe('ABCD')
  })

  it('marks active codes expiring within 7 days as yellow', () => {
    const badge = buildActivationBadgeState(
      snapshot({
        cached_status_json: JSON.stringify({
          status: 'active',
          days_remaining: 6,
          max_devices: 2,
          used_devices: 1,
          device_name: '我的电脑',
          customer: { name: '张三', has_contact: true },
        }),
      }),
      { now },
    )

    expect(badge.kind).toBe('expiring')
    expect(badge.tone).toBe('yellow')
    expect(badge.label).toBe('即将过期·6 天内')
  })

  it('blocks when local clock is earlier than last server check', () => {
    const badge = buildActivationBadgeState(snapshot(), { now: now - 1000 })

    expect(badge.kind).toBe('blocked')
    expect(badge.localBlockReason).toBe('clock-rolled-back')
    expect(badge.localBlockMessage).toBe('系统时间异常，请校准')
  })

  it('blocks when offline longer than seven days', () => {
    const badge = buildActivationBadgeState(snapshot(), { now: now + 8 * DAY_MS })

    expect(badge.kind).toBe('blocked')
    expect(badge.localBlockReason).toBe('offline-too-long')
  })

  it('blocks when server marks activation unauthorized', () => {
    const badge = buildActivationBadgeState(
      snapshot({
        blocked_reason: 'unauthorized',
        blocked_message: '激活已失效，请重新激活',
      }),
      { now },
    )

    expect(badge.kind).toBe('blocked')
    expect(badge.label).toBe('激活已失效')
    expect(badge.localBlockReason).toBe('unauthorized')
  })

  it('extracts activation code suffix from client JWT payload', () => {
    const token = [
      base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
      base64Url(JSON.stringify({ code: 'POD-1234-5678-ABCD' })),
      'signature',
    ].join('.')

    expect(extractActivationCodeSuffix(token)).toBe('ABCD')
  })
})
