import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeDefaultWorkbenchDatabase,
  getDefaultWorkbenchDatabase,
  openWorkbenchDatabase,
} from './lib/workbench-db'
import { writeAppConfig } from './lib/workbench-config'

type IpcHandler = (event: unknown, input?: unknown) => unknown

const ipcHandlers = new Map<string, IpcHandler>()
let tempRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') {
        return join(tempRoot, 'user-data')
      }
      if (name === 'documents') {
        return join(tempRoot, 'documents')
      }
      return tempRoot
    },
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcHandlers.set(channel, handler)
    }),
  },
}))

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-onboarding-'))
  ipcHandlers.clear()
  closeDefaultWorkbenchDatabase()
})

afterEach(async () => {
  closeDefaultWorkbenchDatabase()
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
  tempRoot = ''
  ipcHandlers.clear()
})

describe('onboarding workbench root save', () => {
  it('invalidates the cached default database after saving a new workspace root', async () => {
    const oldRoot = join(tempRoot, 'old-workbench')
    const newRoot = join(tempRoot, 'new-workbench')
    await writeAppConfig({ workbench_root: oldRoot })
    const oldDb = await getDefaultWorkbenchDatabase()

    const { registerOnboardingIpc } = await import('./onboarding')
    registerOnboardingIpc()
    const saveRoot = ipcHandlers.get('workspace:save-root')

    await saveRoot?.({}, newRoot)
    const nextDb = await getDefaultWorkbenchDatabase()

    expect(Object.is(nextDb, oldDb)).toBe(false)
    nextDb.exec('CREATE TABLE workspace_switch_probe (id TEXT PRIMARY KEY)')
    const reopenedOldDb = openWorkbenchDatabase(join(oldRoot, '.workbench', 'workbench.db'))
    const oldTable = reopenedOldDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_switch_probe'",
      )
      .get()
    reopenedOldDb.close()
    expect(oldTable).toBeUndefined()
  })
})
