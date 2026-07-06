import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'
import {
  AppErrorClass,
  type GenerationCapability,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { dialog } from 'electron'
import type { SqliteDatabase } from '../sqlite'
import {
  GENERATION_CAPABILITY_FOLDERS,
  type GenerationServiceDependencies,
  assertNotInsideFolder,
  fileUrl,
  imageIdentity,
  imageReference,
  openWorkbenchDatabase,
  readReferenceForArtifact,
  readWorkbenchRoot,
} from './runtime'
import type {
  ChooseGenerationImageFolderResult,
  ExtractSourcesResult,
  GenerationImageSource,
  Img2imgPrintSource,
  Img2imgReferencePayload,
  Img2imgSourcesResult,
} from './types'

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

async function scanImageFolderRecursive(root: string): Promise<GenerationImageSource[]> {
  const images: GenerationImageSource[] = []

  async function visit(folder: string) {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((left, right) => naturalCompare(left.name, right.name))) {
      const entryPath = join(folder, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (!entry.isFile() || !IMAGE_EXTENSIONS.test(entry.name)) {
        continue
      }
      const info = await stat(entryPath)
      const relativePath = relative(root, entryPath).replace(/\\/g, '/')
      images.push({
        id: createHash('sha256').update(entryPath).digest('hex').slice(0, 16),
        path: entryPath,
        name: entry.name,
        relativePath,
        sizeBytes: info.size,
        modifiedAt: info.mtimeMs,
        thumbnailUrl: fileUrl(entryPath),
      })
    }
  }

  await visit(root)
  return images.sort((left, right) => naturalCompare(left.relativePath, right.relativePath))
}

export async function chooseGenerationImageFolder(): Promise<ChooseGenerationImageFolderResult> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择图片文件夹',
  })
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, error: { code: 'CANCELLED', message: '已取消选择' } }
  }
  return { ok: true, data: { path: result.filePaths[0] } }
}

export async function scanGenerationImageFolder(input: {
  folder: string
}): Promise<GenerationImageSource[]> {
  const folder = input.folder.trim()
  if (!folder || !isAbsolute(folder)) {
    throw new AppErrorClass('HTTP_4XX', '请选择有效的图片文件夹', false, { folder })
  }
  const info = await stat(folder).catch(() => null)
  if (!info?.isDirectory()) {
    throw new AppErrorClass('HTTP_4XX', '选择的路径不是文件夹', false, { folder })
  }
  return scanImageFolderRecursive(folder)
}

function rowString(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function readImg2imgArtifactRows(db: Pick<SqliteDatabase, 'prepare'>) {
  return db
    .prepare(`
      SELECT id, print_id, step, file_path
      FROM artifacts
      WHERE step IN ('txt2img', 'img2img', 'extract', 'matting', 'manual-import')
      ORDER BY created_at DESC
    `)
    .all() as Array<Record<string, unknown>>
}

function registerPrintSourceArtifact(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  input: {
    identity: Awaited<ReturnType<typeof imageIdentity>>
    imagePath: string
    step: GenerationCapability
    taskId: string
    createdAt: number
  },
) {
  db.prepare(`
    INSERT INTO artifacts (
      id,
      task_id,
      print_id,
      step,
      provider,
      source_artifact_ids,
      file_path,
      file_size,
      file_hash,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      file_path = excluded.file_path,
      file_size = excluded.file_size,
      file_hash = excluded.file_hash
  `).run(
    input.identity.artifactId,
    input.taskId,
    input.identity.printId,
    input.step,
    'manual-import',
    '[]',
    input.imagePath,
    input.identity.fileSize,
    input.identity.fileHash,
    input.createdAt,
  )
}

async function ensureFolderPrintArtifacts(
  db: Pick<SqliteDatabase, 'exec' | 'prepare'>,
  folders: Array<{
    path: string
    step: GenerationCapability
  }>,
  existingRows: Array<Record<string, unknown>>,
) {
  const registeredPaths = new Set(existingRows.map((row) => rowString(row, 'file_path')))
  for (const folder of folders) {
    const images = await scanImageFolderRecursive(folder.path)
    for (const image of images) {
      if (registeredPaths.has(image.path)) {
        continue
      }
      const identity = await imageIdentity(image.path)
      registerPrintSourceArtifact(db, {
        identity,
        imagePath: image.path,
        step: folder.step,
        taskId: 'img2img-source-scan',
        createdAt: Date.now(),
      })
      registeredPaths.add(image.path)
    }
  }
}

async function sourceFromArtifactRow(
  workbenchRoot: string,
  row: Record<string, unknown>,
): Promise<Img2imgPrintSource | null> {
  const imagePath = rowString(row, 'file_path')
  if (!imagePath || !IMAGE_EXTENSIONS.test(imagePath)) {
    return null
  }

  try {
    const info = await stat(imagePath)
    const workbenchRelativePath = relative(workbenchRoot, imagePath)
    const relativePath =
      workbenchRelativePath.startsWith('..') || isAbsolute(workbenchRelativePath)
        ? imagePath
        : workbenchRelativePath
    return {
      id: rowString(row, 'id'),
      artifactId: rowString(row, 'id'),
      printId: rowString(row, 'print_id') || null,
      step: rowString(row, 'step'),
      path: imagePath,
      name: basename(imagePath),
      relativePath,
      sizeBytes: info.size,
      modifiedAt: info.mtimeMs,
      thumbnailUrl: fileUrl(imagePath),
    }
  } catch {
    return null
  }
}

export async function listExtractSources(
  dependencies: Pick<GenerationServiceDependencies, 'readConfig'> = {},
): Promise<ExtractSourcesResult> {
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const folder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  return {
    folder,
    images: await scanImageFolderRecursive(folder),
  }
}

export async function listImg2imgSources(
  dependencies: Pick<GenerationServiceDependencies, 'readConfig' | 'openDatabase'> = {},
): Promise<Img2imgSourcesResult> {
  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const sourceFolders = [
    {
      path: join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        GENERATION_CAPABILITY_FOLDERS.txt2img,
      ),
      step: 'txt2img' as const,
    },
    {
      path: join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        GENERATION_CAPABILITY_FOLDERS.img2img,
      ),
      step: 'img2img' as const,
    },
    {
      path: join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        GENERATION_CAPABILITY_FOLDERS.extract,
      ),
      step: 'extract' as const,
    },
    {
      path: join(
        workbenchRoot,
        WORKBENCH_DIRECTORIES.generation,
        GENERATION_CAPABILITY_FOLDERS.matting,
      ),
      step: 'matting' as const,
    },
  ]
  const collectionFolder = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

  try {
    const initialRows = readImg2imgArtifactRows(db)
    await ensureFolderPrintArtifacts(db, sourceFolders, initialRows)
    const rows = readImg2imgArtifactRows(db)
    const sources = await Promise.all(rows.map((row) => sourceFromArtifactRow(workbenchRoot, row)))
    return {
      folders: sourceFolders.map((folder) => folder.path),
      images: sources
        .filter((source): source is Img2imgPrintSource => Boolean(source))
        .filter((source) => {
          try {
            assertNotInsideFolder(source.path, collectionFolder)
            return true
          } catch {
            return false
          }
        }),
    }
  } finally {
    db.close()
  }
}

export async function resolveImg2imgReferences(
  input: { artifactIds: string[] },
  dependencies: Pick<GenerationServiceDependencies, 'readConfig' | 'openDatabase'> = {},
): Promise<Img2imgReferencePayload[]> {
  const artifactIds = Array.from(
    new Set(input.artifactIds.map((artifactId) => artifactId.trim()).filter(Boolean)),
  )
  if (artifactIds.length === 0) {
    return []
  }

  const workbenchRoot = await readWorkbenchRoot(dependencies.readConfig)
  const db = (dependencies.openDatabase ?? openWorkbenchDatabase)(workbenchRoot)

  try {
    return Promise.all(
      artifactIds.map((artifactId) => readReferenceForArtifact(db, workbenchRoot, artifactId)),
    )
  } finally {
    db.close()
  }
}
