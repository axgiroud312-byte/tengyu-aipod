export function localImageUrl(path: string) {
  return `tengyu-local-image://image/${encodeURIComponent(path)}`
}

export function fileUrlLocalPath(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') {
      return null
    }
    const path = decodeURIComponent(parsed.pathname)
    return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path
  } catch {
    return null
  }
}

export function detectionImageSrc(input: { path: string; thumbnailUrl?: string }) {
  const thumbnailPath = input.thumbnailUrl ? fileUrlLocalPath(input.thumbnailUrl) : null
  const localPath = thumbnailPath ?? input.path
  return localPath ? localImageUrl(localPath) : (input.thumbnailUrl ?? '')
}
