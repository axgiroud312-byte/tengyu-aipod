import { join } from 'node:path'
import {
  AppErrorClass,
  type PhotoshopProgressInfo,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { type WebContents, dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { readAppConfig } from '../onboarding'
import { psdScanner } from './psd-scanner'
import { photoshopStatusChecker } from './status-checker'

const scanTemplateInputSchema = z.object({
  psd_path: z.string().min(1),
})

export function sendPhotoshopProgress(
  webContents: Pick<WebContents, 'send'>,
  progress: PhotoshopProgressInfo,
): void {
  webContents.send('photoshop:progress', progress)
}

export function registerPhotoshopIpc(): void {
  ipcMain.handle('photoshop:get-status', () => photoshopStatusChecker.check())
  ipcMain.handle('photoshop:choose-print-folder', async () => {
    const config = await readAppConfig()
    const result = await dialog.showOpenDialog({
      ...(config.workbench_root
        ? { defaultPath: join(config.workbench_root, WORKBENCH_DIRECTORIES.generation) }
        : {}),
      properties: ['openDirectory'],
      title: '选择印花文件夹',
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: { code: 'CANCELED', message: '已取消选择' } }
    }
    return { ok: true, data: { path: result.filePaths[0] } }
  })
  ipcMain.handle('photoshop:choose-templates', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Photoshop 模板', extensions: ['psd', 'psb'] }],
      properties: ['openFile', 'multiSelections'],
      title: '选择 PSD/PSB 模板',
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: { code: 'CANCELED', message: '已取消选择' } }
    }
    return { ok: true, data: { paths: result.filePaths } }
  })
  ipcMain.handle('photoshop:open-path', async (_event, input: unknown) => {
    const parsed = z.object({ path: z.string().min(1) }).safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('INVALID_INPUT', '打开路径不能为空', false, {
        issues: parsed.error.issues,
      })
    }
    await shell.openPath(parsed.data.path)
    return { ok: true }
  })
  ipcMain.handle('photoshop:scan-template', (_event, input: unknown) => {
    const parsed = scanTemplateInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('INVALID_INPUT', 'PSD 模板路径不能为空', false, {
        issues: parsed.error.issues,
      })
    }
    return psdScanner.scanPsd(parsed.data.psd_path)
  })
  ipcMain.handle('photoshop:list-cached-templates', () => psdScanner.listCachedTemplates())
}
