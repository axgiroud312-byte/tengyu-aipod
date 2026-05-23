import { describe, expect, it } from 'vitest'
import { StatusAuthError, calculateDaysRemaining, getBearerToken } from './status'

describe('status helpers', () => {
  it('extracts bearer tokens', () => {
    expect(getBearerToken('Bearer abc')).toBe('abc')
    expect(getBearerToken('Bearer   abc  ')).toBe('abc')
    expect(getBearerToken('Basic abc')).toBeNull()
    expect(getBearerToken(null)).toBeNull()
  })

  it('calculates remaining days with ceiling semantics', () => {
    const now = new Date('2026-05-23T00:00:00.000Z')

    expect(calculateDaysRemaining(new Date('2026-05-24T00:00:00.000Z'), now)).toBe(1)
    expect(calculateDaysRemaining(new Date('2026-05-23T01:00:00.000Z'), now)).toBe(1)
    expect(calculateDaysRemaining(new Date('2026-05-22T00:00:00.000Z'), now)).toBe(-1)
    expect(calculateDaysRemaining(null, now)).toBe(0)
  })

  it('uses stable auth error codes', () => {
    expect(new StatusAuthError('UNAUTHORIZED').code).toBe('UNAUTHORIZED')
    expect(new StatusAuthError('INVALID_TOKEN').code).toBe('INVALID_TOKEN')
    expect(new StatusAuthError('DEVICE_UNBOUND').code).toBe('DEVICE_UNBOUND')
  })
})
