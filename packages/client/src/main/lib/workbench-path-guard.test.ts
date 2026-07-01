import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { assertPathInsideWorkbench, isPathInsideWorkbench } from './workbench-path-guard'

let tempRoot = ''

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
  tempRoot = ''
})

async function createFile(path: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, 'image')
}

describe('workbench path guard', () => {
  it('allows domain paths inside their business workspace', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-path-guard-'))
    const workbenchRoot = join(tempRoot, 'workbench')
    const collectionImage = join(
      workbenchRoot,
      WORKBENCH_DIRECTORIES.collection,
      'temu-20260531-120000',
      'a.jpg',
    )
    await createFile(collectionImage)

    await expect(
      assertPathInsideWorkbench(workbenchRoot, collectionImage, { domain: 'collection' }),
    ).resolves.toContain('a.jpg')
  })

  it('rejects paths outside the requested business domain', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-path-guard-'))
    const workbenchRoot = join(tempRoot, 'workbench')
    const listingImage = join(workbenchRoot, WORKBENCH_DIRECTORIES.listing, 'batch', 'a.jpg')
    await createFile(listingImage)

    await expect(
      assertPathInsideWorkbench(workbenchRoot, listingImage, {
        domain: 'collection',
        label: '采集目录',
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      details: { kind: 'path_outside_workbench' },
    })
  })

  it('allows video paths inside the video workspace', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-path-guard-'))
    const workbenchRoot = join(tempRoot, 'workbench')
    const videoFile = join(
      workbenchRoot,
      WORKBENCH_DIRECTORIES.video,
      '图生视频',
      'task',
      '0001.mp4',
    )
    await createFile(videoFile)

    await expect(
      assertPathInsideWorkbench(workbenchRoot, videoFile, { domain: 'video' }),
    ).resolves.toContain('0001.mp4')
  })

  it('rejects symlinks that escape the workbench', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-path-guard-'))
    const workbenchRoot = join(tempRoot, 'workbench')
    const outside = join(tempRoot, 'outside', 'private.jpg')
    const link = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection, 'linked.jpg')
    await createFile(outside)
    await mkdir(dirname(link), { recursive: true })
    await symlink(outside, link)

    await expect(isPathInsideWorkbench(workbenchRoot, link, 'collection')).resolves.toBe(false)
  })
})
