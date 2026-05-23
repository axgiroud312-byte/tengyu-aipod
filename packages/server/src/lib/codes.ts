import { randomBytes, randomUUID } from 'node:crypto'
import { db } from '@/lib/db'

const CODE_CHARS = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789'

function codeSegment() {
  const bytes = randomBytes(4)
  return Array.from(bytes, (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join('')
}

export function generateCode() {
  return `POD-${codeSegment()}-${codeSegment()}-${codeSegment()}`
}

export async function generateUniqueCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateCode()
    const existing = await db.activationCode.findUnique({
      where: { code },
      select: { code: true },
    })

    if (!existing) {
      return code
    }
  }

  throw new Error('Unable to generate a unique activation code')
}

export function createBatchId() {
  return randomUUID()
}

export function computeRemainingDays(expires_at: Date | null) {
  if (!expires_at) {
    return null
  }

  const diffMs = expires_at.getTime() - Date.now()
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}

export function computeStatus(input: {
  activated_at: Date | null
  expires_at: Date | null
  is_active: boolean
}) {
  if (!input.is_active) {
    return 'banned'
  }

  const remainingDays = computeRemainingDays(input.expires_at)
  if (remainingDays !== null && remainingDays < 0) {
    return 'expired'
  }

  if (input.activated_at) {
    return 'activated'
  }

  return 'not_activated'
}
