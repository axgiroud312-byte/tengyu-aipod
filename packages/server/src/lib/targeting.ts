export type TargetScope = 'all' | 'php_uid_list'

export function parseOptionalPhpUid(value: string | null) {
  if (!value) {
    return null
  }

  const uid = Number(value)
  return Number.isInteger(uid) && uid > 0 ? uid : null
}

export function parsePhpUidAllowlist(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is number => Number.isInteger(item) && item > 0)
  } catch {
    return []
  }
}

export function normalizePhpUidAllowlist(value: string) {
  const parsed = parsePhpUidAllowlistInput(value)
  return JSON.stringify(parsed.ok ? parsed.uids : [])
}

export function parsePhpUidAllowlistInput(
  value: string,
): { ok: true; uids: number[] } | { ok: false; uids: [] } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: true, uids: [] }
  }

  const parts = trimmed.split(/[\s,，]+/).filter(Boolean)
  const uids = parts.map((item) => Number(item.trim()))
  if (uids.some((uid) => !Number.isInteger(uid) || uid <= 0)) {
    return { ok: false, uids: [] }
  }

  return { ok: true, uids: Array.from(new Set(uids)) }
}

export function matchesPhpUidTarget(input: {
  scope: TargetScope
  targetPhpUidsJson: string
  uid: number | null
}) {
  if (input.scope === 'all') {
    return true
  }
  if (!input.uid) {
    return false
  }

  return parsePhpUidAllowlist(input.targetPhpUidsJson).includes(input.uid)
}
