import { readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { PhotoshopPrintAsset } from '@tengyu-aipod/shared'
import { LOCAL_IMAGE_PROTOCOL } from '../lib/local-image-protocol'

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i

export interface PhotoshopPrintFolderScan {
  folder: string
  prints: Array<PhotoshopPrintAsset & { thumbnail_url: string }>
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function localImageUrl(path: string) {
  return `${LOCAL_IMAGE_PROTOCOL}://image/${encodeURIComponent(path)}`
}

async function listImageFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(folder, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listImageFiles(entryPath)))
      continue
    }
    if (entry.isFile() && IMAGE_EXTENSIONS.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

export async function scanPhotoshopPrintFolder(folder: string): Promise<PhotoshopPrintFolderScan> {
  const files = (await listImageFiles(folder)).sort((left, right) =>
    naturalCompare(basename(left), basename(right)),
  )
  return {
    folder,
    prints: files.map((filePath) => ({
      id: basename(filePath, extname(filePath)),
      file_path: filePath,
      thumbnail_url: localImageUrl(filePath),
    })),
  }
}
