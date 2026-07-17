import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanPhotoshopPrintFolder, scanPhotoshopPrintPaths } from './print-folder'

describe('scanPhotoshopPrintFolder', () => {
  it('lists image files from the selected print folder as Photoshop print assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photoshop-prints-'))
    try {
      await mkdir(join(root, 'nested'))
      await writeFile(join(root, 'img10.png'), 'png')
      await writeFile(join(root, 'img2.jpg'), 'jpg')
      await writeFile(join(root, 'nested', 'img1.webp'), 'webp')
      await writeFile(join(root, 'notes.txt'), 'text')

      const result = await scanPhotoshopPrintFolder(root)

      expect(result.prints.map((item) => item.id)).toEqual(['img1', 'img2', 'img10'])
      expect(result.prints.map((item) => item.file_path)).toEqual([
        join(root, 'nested', 'img1.webp'),
        join(root, 'img2.jpg'),
        join(root, 'img10.png'),
      ])
      expect(result.prints[0]?.thumbnail_url).toBe(
        `tengyu-local-image://image/${encodeURIComponent(join(root, 'nested', 'img1.webp'))}`,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('excludes removed print candidates from folder scans', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photoshop-prints-'))
    try {
      const removedPath = join(root, '222-0001.png')
      await writeFile(removedPath, 'png')
      await writeFile(join(root, '222-0002.png'), 'png')

      const result = await scanPhotoshopPrintFolder(root, {
        excludeFilePaths: [removedPath],
      })

      expect(result.prints.map((item) => item.id)).toEqual(['222-0002'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips complete-task waiting mockup staging folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photoshop-prints-'))
    try {
      await mkdir(join(root, '等待套版', 'run-1'), { recursive: true })
      await mkdir(join(root, '文生图'), { recursive: true })
      await writeFile(join(root, '等待套版', 'run-1', '222-0001.png'), 'png')
      await writeFile(join(root, '文生图', 'pri_print.png'), 'png')

      const result = await scanPhotoshopPrintFolder(root)

      expect(result.prints.map((item) => item.id)).toEqual(['pri_print'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses only the frozen explicit print paths without scanning sibling images', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photoshop-candidates-'))
    try {
      const selectedPath = join(root, 'approved.png')
      await writeFile(selectedPath, 'png')
      await writeFile(join(root, 'not-approved.png'), 'png')

      const result = await scanPhotoshopPrintPaths([selectedPath])

      expect(result.prints.map((item) => item.file_path)).toEqual([selectedPath])
      expect(result.prints.map((item) => item.id)).toEqual(['approved'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns a structured validation error when a frozen candidate cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'photoshop-candidates-'))
    try {
      const missingPath = join(root, 'missing.png')

      await expect(scanPhotoshopPrintPaths([missingPath])).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        details: { filePath: missingPath },
        message: '无法读取套版候选文件',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
