import { AppErrorClass } from '@tengyu-aipod/shared'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { getSecret, hasSecret, setSecret } from './lib/keychain'
import { markOnboardingComplete, readOnboardingStateFile } from './lib/onboarding-state'
import {
  defaultWorkbenchRoot,
  ensureWorkbenchDirectories,
  getConfiguredWorkbenchRoot,
  readAppConfig,
  workbenchSubdirectories,
  writeAppConfig,
} from './lib/workbench-config'
import { closeDefaultWorkbenchDatabase } from './lib/workbench-db'

export { readAppConfig }

const workbenchRootInputSchema = z.string()
const onboardingApiKeysInputSchema = z.object({
  chenyu: z.string().optional(),
  grsai: z.string().optional(),
  bailian: z.string().optional(),
  bit_browser_url: z.string().optional(),
})
const keychainHasInputSchema = z.object({
  key: z.string().min(1),
})

function parseOnboardingIpcInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', message, false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

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

  ipcMain.handle('workspace:save-root', async (_event, root: unknown) => {
    const nextRoot = parseOnboardingIpcInput(
      workbenchRootInputSchema,
      root,
      '工作区路径参数不正确',
    ).trim()
    if (!nextRoot) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '工作区不能为空' } }
    }
    await ensureWorkbenchDirectories(nextRoot)
    const config = await readAppConfig()
    await writeAppConfig({ ...config, workbench_root: nextRoot })
    if (config.workbench_root !== nextRoot) {
      closeDefaultWorkbenchDatabase()
    }

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

  ipcMain.handle('onboarding:save-workbench-root', async (_event, root: unknown) => {
    const nextRoot = parseOnboardingIpcInput(
      workbenchRootInputSchema,
      root,
      '首次设置工作区路径参数不正确',
    ).trim()
    if (!nextRoot) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: '工作区不能为空' } }
    }
    await ensureWorkbenchDirectories(nextRoot)
    const config = await readAppConfig()
    await writeAppConfig({ ...config, workbench_root: nextRoot })
    if (config.workbench_root !== nextRoot) {
      closeDefaultWorkbenchDatabase()
    }

    return { ok: true, data: { path: nextRoot } }
  })

  ipcMain.handle('onboarding:save-api-keys', async (_event, apiKeys: unknown) => {
    const parsed = parseOnboardingIpcInput(
      onboardingApiKeysInputSchema,
      apiKeys,
      'API Key 参数不正确',
    )
    for (const [key, value] of Object.entries(parsed)) {
      const trimmed = value?.trim()
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

  ipcMain.handle('keychain:has', async (_event, input: unknown) =>
    hasSecret(
      parseOnboardingIpcInput(keychainHasInputSchema, input, 'Keychain 查询参数不正确').key,
    ),
  )
  ipcMain.handle('bit-browser:get-base-url', () => getSecret('bit_browser_url'))
  ipcMain.handle('bit-browser:save-base-url', async (_event, value: unknown) => {
    const nextValue = parseOnboardingIpcInput(z.string(), value, '比特浏览器地址参数不正确').trim()
    if (!nextValue) {
      throw new AppErrorClass('INVALID_INPUT', '比特浏览器地址不能为空', false)
    }
    await setSecret('bit_browser_url', nextValue)
    return nextValue
  })
}
