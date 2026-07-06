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

export function splitDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  return {
    mime_type: match?.[1] ?? 'image/png',
    base64: match?.[2] ?? dataUrl,
  }
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('读取参考图失败')))
    reader.readAsDataURL(file)
  })
}
