import { stat } from 'node:fs/promises'
import { extname } from 'node:path'

export type VisibleImageNamingInput = {
  prefix?: string | undefined
  separator?: string | undefined
}

const WINDOWS_INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/g
function removeControlChars(value: string) {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
}

export function sanitizeVisibleFilenamePart(value: string) {
  return removeControlChars(value)
    .replace(WINDOWS_INVALID_FILENAME_CHARS, '_')
    .trim()
    .replace(/[ .]+$/g, '')
}

export function normalizedVisibleImageNaming(input: VisibleImageNamingInput) {
  const prefix = sanitizeVisibleFilenamePart(input.prefix ?? '')
  if (!prefix) {
    return null
  }
  return {
    prefix,
    separator: sanitizeVisibleFilenamePart(input.separator ?? ''),
  }
}

export function visibleImageNamingEnabled(input: VisibleImageNamingInput) {
  return normalizedVisibleImageNaming(input) !== null
}

export function normalizedImageExtension(value: string) {
  const ext = value.startsWith('.') ? value : extname(value) || `.${value}`
  const safeExt = sanitizeVisibleFilenamePart(ext.replace(/^\.+/, ''))
  return safeExt ? `.${safeExt}` : '.png'
}

export function nextVisibleImageName(
  input: VisibleImageNamingInput & { index: number; ext: string },
) {
  const naming = normalizedVisibleImageNaming(input)
  if (!naming) {
    return null
  }
  return `${naming.prefix}${naming.separator}${String(input.index + 1).padStart(4, '0')}${normalizedImageExtension(input.ext)}`
}

export async function assertTargetDoesNotExist(path: string) {
  try {
    await stat(path)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return
    }
    throw error
  }
  throw new Error(`输出文件已存在，不能覆盖：${path}`)
}
