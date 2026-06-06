import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

const allowedLocalImagePaths = new Set<string>()

export async function allowLocalImagePath(path: string) {
  allowedLocalImagePaths.add(await canonicalLocalImagePath(path))
}

export function clearAllowedLocalImagePaths() {
  allowedLocalImagePaths.clear()
}

export async function isAllowedLocalImagePath(path: string) {
  return allowedLocalImagePaths.has(
    await canonicalLocalImagePath(path).catch(() => normalize(path)),
  )
}

async function canonicalLocalImagePath(path: string) {
  return normalize(await realpath(path))
}

function normalize(path: string) {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
