import { dialog, ipcMain } from 'electron'
import { hasSecret, setSecret } from './lib/keychain'
import { markOnboardingComplete, readOnboardingStateFile } from './lib/onboarding-state'
import {
  defaultWorkbenchRoot,
  ensureWorkbenchDirectories,
  getConfiguredWorkbenchRoot,
  readAppConfig,
  workbenchSubdirectories,
  writeAppConfig,
} from './lib/workbench-config'

export { readAppConfig }

export function registerOnboardingIpc() {
  ipcMain.handle('onboarding:get-state', async () => {
    const config = await readAppConfig()
    const onboardingState = await readOnboardingStateFile()

    return {
      needs_onboarding: !onboardingState.completed_at,
      default_workbench_root: config.workbench_root ?? '',
      workbench_root: config.workbench_root ?? null,
    }
  })

  ipcMain.handle('workspace:get-state', async () => {
    const root = await getConfiguredWorkbenchRoot()
    return {
      root,
      directories: [...workbenchSubdirectories],
    }
  })

  ipcMain.handle('workspace:choose-root', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: (await getConfiguredWorkbenchRoot()) ?? (await defaultWorkbenchRoot()),
      title: '选择工作区',
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELLED', message: '已取消选择工作区' } }
    }

    return { ok: true, data: { path: result.filePaths[0] } }
  })

  ipcMain.handle('workspace:save-root', async (_event, root: string) => {
    const nextRoot = root.trim()
    if (!nextRoot) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '工作区不能为空' } }
    }
    await ensureWorkbenchDirectories(nextRoot)
    const config = await readAppConfig()
    await writeAppConfig({ ...config, workbench_root: nextRoot })

    return {
      ok: true,
      data: { path: nextRoot, directories: [...workbenchSubdirectories] },
    }
  })

  ipcMain.handle('onboarding:choose-workbench-root', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: (await getConfiguredWorkbenchRoot()) ?? (await defaultWorkbenchRoot()),
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELLED', message: '已取消选择目录' } }
    }

    return { ok: true, data: { path: result.filePaths[0] } }
  })

  ipcMain.handle('onboarding:save-workbench-root', async (_event, root: string) => {
    const nextRoot = root.trim()
    await ensureWorkbenchDirectories(nextRoot)
    const config = await readAppConfig()
    await writeAppConfig({ ...config, workbench_root: nextRoot })

    return { ok: true, data: { path: nextRoot } }
  })

  ipcMain.handle('onboarding:save-api-keys', async (_event, apiKeys: Record<string, string>) => {
    for (const [key, value] of Object.entries(apiKeys)) {
      const trimmed = value.trim()
      if (trimmed) {
        await setSecret(key, trimmed)
      }
    }

    return { ok: true }
  })

  ipcMain.handle('onboarding:complete', async () => {
    await markOnboardingComplete()

    return { ok: true }
  })

  ipcMain.handle('keychain:has', async (_event, input: { key: string }) => hasSecret(input.key))
}
