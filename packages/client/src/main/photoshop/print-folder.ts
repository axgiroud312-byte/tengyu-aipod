import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { AppErrorClass, type PhotoshopPrintAsset } from '@tengyu-aipod/shared'
import { LOCAL_IMAGE_PROTOCOL } from '../lib/local-image-protocol'

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i
const WAITING_MOCKUP_DIR = '等待套版'

export interface PhotoshopPrintFolderScan {
  folder: string
  prints: Array<PhotoshopPrintAsset & { thumbnail_url: string }>
}

export interface PhotoshopPrintFolderScanOptions {
  excludeFilePaths?: string[]
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function pathKey(path: string) {
  return resolve(path).toLowerCase()
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
      if (entry.name === WAITING_MOCKUP_DIR) {
        continue
      }
      files.push(...(await listImageFiles(entryPath)))
      continue
    }
    if (entry.isFile() && IMAGE_EXTENSIONS.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

export async function scanPhotoshopPrintFolder(
  folder: string,
  options: PhotoshopPrintFolderScanOptions = {},
): Promise<PhotoshopPrintFolderScan> {
  const excluded = new Set((options.excludeFilePaths ?? []).map(pathKey))
  const files = (await listImageFiles(folder))
    .filter((filePath) => !excluded.has(pathKey(filePath)))
    .sort((left, right) => naturalCompare(basename(left), basename(right)))
  return {
    folder,
    prints: files.map((filePath) => ({
      id: basename(filePath, extname(filePath)),
      file_path: filePath,
      thumbnail_url: localImageUrl(filePath),
    })),
  }
}

export async function scanPhotoshopPrintPaths(paths: string[]): Promise<PhotoshopPrintFolderScan> {
  const files = Array.from(
    new Map(paths.map((filePath) => [pathKey(filePath), resolve(filePath)])).values(),
  ).sort((left, right) => naturalCompare(basename(left), basename(right)))

  for (const filePath of files) {
    if (!IMAGE_EXTENSIONS.test(filePath)) {
      throw new AppErrorClass('INVALID_INPUT', '套版候选不是受支持的图片文件', false, {
        filePath,
      })
    }
    try {
      if (!(await stat(filePath)).isFile()) {
        throw new AppErrorClass('INVALID_INPUT', '套版候选不是有效文件', false, {
          filePath,
        })
      }
    } catch (cause) {
      if (cause instanceof AppErrorClass) {
        throw cause
      }
      throw new AppErrorClass('INVALID_INPUT', '无法读取套版候选文件', false, { filePath }, cause)
    }
  }

  return {
    folder: '',
    prints: files.map((filePath) => ({
      id: basename(filePath, extname(filePath)),
      file_path: filePath,
      thumbnail_url: localImageUrl(filePath),
    })),
  }
}
