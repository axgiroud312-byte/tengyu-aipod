export function formatRelativeTime(value: string | Date | null | undefined) {
  if (!value) {
    return '-'
  }

  const target = value instanceof Date ? value : new Date(value)
  const diffMs = Date.now() - target.getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return '刚刚'
  }

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const year = 365 * day

  if (diffMs < minute) {
    return '刚刚'
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)} 分钟前`
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)} 小时前`
  }
  if (diffMs < year) {
    return `${Math.floor(diffMs / day)} 天前`
  }

  return `${Math.floor(diffMs / year)} 年前`
}
