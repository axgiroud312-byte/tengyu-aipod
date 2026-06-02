import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanPhotoshopPrintFolder } from './print-folder'

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
})
