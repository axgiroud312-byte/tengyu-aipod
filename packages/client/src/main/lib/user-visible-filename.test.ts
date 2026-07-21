import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  nextAvailableVisibleImageIndex,
  nextVisibleImageName,
  sanitizeVisibleFilenamePart,
  visibleImageNamingEnabled,
} from './user-visible-filename'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('user visible image filenames', () => {
  it('builds four-digit task-local filenames from sanitized prefix and separator', () => {
    expect(
      nextVisibleImageName({
        prefix: ' gyx<k:j ',
        separator: '-',
        index: 0,
        ext: '.png',
      }),
    ).toBe('gyx_k_j-0001.png')
    expect(
      nextVisibleImageName({
        prefix: 'gyxkj',
        separator: '_',
        index: 2,
        ext: 'jpg',
      }),
    ).toBe('gyxkj_0003.jpg')
  })

  it('treats empty or fully invalid prefixes as disabled', () => {
    expect(visibleImageNamingEnabled({ prefix: '', separator: '-' })).toBe(false)
    expect(visibleImageNamingEnabled({ prefix: '\u0001 \t . ', separator: '-' })).toBe(false)
    expect(
      nextVisibleImageName({
        prefix: '\u0001 \t . ',
        separator: '-',
        index: 0,
        ext: '.png',
      }),
    ).toBeNull()
  })

  it('removes Windows-invalid characters, controls, and trailing spaces or dots', () => {
    expect(sanitizeVisibleFilenamePart(' a<b>c:d"e/f\\g|h?i*j. ')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeVisibleFilenamePart('abc\u0000\u001fdef...   ')).toBe('abcdef')
  })

  it('continues after the highest existing visible sequence without overwriting files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'visible-filenames-'))
    tempRoots.push(root)
    await mkdir(join(root, 'nested'))
    await Promise.all([
      writeFile(join(root, '222-0001.png'), 'first'),
      writeFile(join(root, '222-0145.webp'), 'latest'),
      writeFile(join(root, '222-0146.PNG'), 'uppercase extension'),
      writeFile(join(root, 'ABC-0147.PNG'), 'uppercase prefix'),
      writeFile(join(root, 'other-9999.png'), 'other prefix'),
      writeFile(join(root, '222-draft.png'), 'not a sequence'),
    ])

    await expect(
      nextAvailableVisibleImageIndex(root, { prefix: '222', separator: '-' }),
    ).resolves.toBe(146)
    await expect(
      nextAvailableVisibleImageIndex(root, { prefix: 'abc', separator: '-' }),
    ).resolves.toBe(147)
  })
})
