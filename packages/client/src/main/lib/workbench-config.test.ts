import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureWorkbenchDirectories } from './workbench-config'

let tempRoot = ''

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
  tempRoot = ''
})

async function expectDirectory(path: string) {
  await expect(stat(path).then((info) => info.isDirectory())).resolves.toBe(true)
}

describe('workbench config directories', () => {
  it('creates collection, generation capability, and empty downstream folders', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-workbench-config-'))
    const workbenchRoot = join(tempRoot, 'materials')

    await ensureWorkbenchDirectories(workbenchRoot)

    await expectDirectory(join(workbenchRoot, '01-采集工作区'))
    await expectDirectory(join(workbenchRoot, '02-印花工作区', '文生图'))
    await expectDirectory(join(workbenchRoot, '02-印花工作区', '图生图'))
    await expectDirectory(join(workbenchRoot, '02-印花工作区', '提取'))
    await expectDirectory(join(workbenchRoot, '02-印花工作区', '抠图'))
    await expectDirectory(join(workbenchRoot, '03-检测工作区'))
    await expectDirectory(join(workbenchRoot, '04-上架工作区'))
    await expectDirectory(join(workbenchRoot, '.workbench'))
  })
})
