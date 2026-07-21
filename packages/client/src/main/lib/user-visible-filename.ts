import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
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

export async function nextAvailableVisibleImageIndex(
  folder: string,
  input: VisibleImageNamingInput,
  startIndex = 0,
) {
  const naming = normalizedVisibleImageNaming(input)
  const normalizedStartIndex = Math.max(0, Math.floor(startIndex))
  if (!naming) {
    return normalizedStartIndex
  }

  let entries: Dirent<string>[]
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) {
      return normalizedStartIndex
    }
    throw error
  }

  const filenamePrefix = `${naming.prefix}${naming.separator}`.toLowerCase()
  let nextIndex = normalizedStartIndex
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const ext = extname(entry.name)
    const stem = ext ? entry.name.slice(0, -ext.length) : entry.name
    if (!stem.toLowerCase().startsWith(filenamePrefix)) {
      continue
    }
    const sequence = stem.slice(filenamePrefix.length)
    if (!/^\d{4,}$/.test(sequence)) {
      continue
    }
    const value = Number.parseInt(sequence, 10)
    if (Number.isSafeInteger(value) && value > nextIndex) {
      nextIndex = value
    }
  }
  return nextIndex
}

export async function assertTargetDoesNotExist(path: string) {
  try {
    await stat(path)
  } catch (error) {
    if (isMissingPathError(error)) {
      return
    }
    throw error
  }
  throw new Error(`输出文件已存在，不能覆盖：${path}`)
}

function isMissingPathError(error: unknown) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
