import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_IMAGE_PROTOCOL, resolveLocalImageRequestPath } from './local-image-protocol'

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn(),
  },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}))

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

function localImageUrl(path: string) {
  return `${LOCAL_IMAGE_PROTOCOL}://image/${encodeURIComponent(path)}`
}

describe('local image protocol', () => {
  it('allows image paths inside business workspaces', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-local-image-'))
    const workbenchRoot = join(tempRoot, 'workbench')
    const imagePath = join(workbenchRoot, WORKBENCH_DIRECTORIES.generation, '文生图', 'print.png')
    await createFile(imagePath)

    await expect(
      resolveLocalImageRequestPath(localImageUrl(imagePath), {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
      }),
    ).resolves.toBe(imagePath)
  })

  it('rejects image paths outside the workbench', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-local-image-'))
    const workbenchRoot = join(tempRoot, 'workbench')
    const outsideImage = join(tempRoot, 'outside', 'private.png')
    await createFile(outsideImage)

    await expect(
      resolveLocalImageRequestPath(localImageUrl(outsideImage), {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
      }),
    ).resolves.toBeNull()
  })

  it('rejects symlinks that point outside the workbench', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-local-image-'))
    const workbenchRoot = join(tempRoot, 'workbench')
    const outsideImage = join(tempRoot, 'outside', 'private.png')
    const linkPath = join(workbenchRoot, WORKBENCH_DIRECTORIES.collection, 'linked.png')
    await createFile(outsideImage)
    await mkdir(dirname(linkPath), { recursive: true })
    await symlink(outsideImage, linkPath)

    await expect(
      resolveLocalImageRequestPath(localImageUrl(linkPath), {
        readConfig: async () => ({ workbench_root: workbenchRoot }),
      }),
    ).resolves.toBeNull()
  })
})
