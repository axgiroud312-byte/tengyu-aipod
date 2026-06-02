import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AppErrorClass,
  type PhotoshopProgressInfo,
  type PhotoshopProgressLogEntry,
  WORKBENCH_DIRECTORIES,
} from '@tengyu-aipod/shared'
import { type WebContents, dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { tempFileManager } from '../lib/temp-file-manager'
import { readAppConfig } from '../onboarding'
import { runBatch } from './multi-batch'
import { scanPhotoshopPrintFolder } from './print-folder'
import { psdScanner } from './psd-scanner'
import { photoshopStatusChecker } from './status-checker'

const scanTemplateInputSchema = z.object({
  psd_path: z.string().min(1),
})

const scanPrintFolderInputSchema = z.object({
  folder: z.string().min(1),
})

const runBatchInputSchema = z.object({
  print_folder: z.string().min(1),
  templates: z.array(z.string().min(1)).min(1),
  replace_range: z.enum(['auto', 'top', 'all']).default('auto'),
  output_layout: z.enum(['template_first', 'sku_first']).default('template_first'),
  format: z.enum(['jpg', 'png']).default('jpg'),
  clip_mode: z.enum(['none', 'auto', 'guides']).default('auto'),
  skip_completed: z.boolean().default(true),
  max_retries: z.number().int().min(0).max(5).default(1),
  output_root: z.string().min(1),
})

const cancelInputSchema = z.object({
  task_id: z.string().min(1),
})

const activePhotoshopCancels = new Map<string, string>()

export function sendPhotoshopProgress(
  webContents: Pick<WebContents, 'send'>,
  progress: PhotoshopProgressInfo,
): void {
  webContents.send('photoshop:progress', progress)
}

export function sendPhotoshopLog(
  webContents: Pick<WebContents, 'send'>,
  entry: PhotoshopProgressLogEntry,
): void {
  webContents.send('photoshop:log', entry)
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
  ipcMain.handle('photoshop:choose-output-folder', async () => {
    const config = await readAppConfig()
    const result = await dialog.showOpenDialog({
      ...(config.workbench_root
        ? { defaultPath: join(config.workbench_root, WORKBENCH_DIRECTORIES.listing) }
        : {}),
      properties: ['openDirectory', 'createDirectory'],
      title: '选择套版输出目录',
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: { code: 'CANCELED', message: '已取消选择' } }
    }
    return { ok: true, data: { path: result.filePaths[0] } }
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
  ipcMain.handle('photoshop:scan-print-folder', (_event, input: unknown) => {
    const parsed = scanPrintFolderInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('INVALID_INPUT', '印花文件夹不能为空', false, {
        issues: parsed.error.issues,
      })
    }
    return scanPhotoshopPrintFolder(parsed.data.folder)
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
  ipcMain.handle('photoshop:run-batch', async (event, input: unknown) => {
    const parsed = runBatchInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('INVALID_INPUT', 'PS 套版参数无效', false, {
        issues: parsed.error.issues,
      })
    }
    const scan = await scanPhotoshopPrintFolder(parsed.data.print_folder)
    if (scan.prints.length === 0) {
      throw new AppErrorClass('INVALID_INPUT', '印花文件夹内没有可套版图片', false, {
        print_folder: parsed.data.print_folder,
      })
    }

    const taskId = `ps-${randomUUID()}`
    const taskDir = await tempFileManager.createTaskDir('photoshop', taskId)
    const cancelFilePath = join(taskDir, 'cancel.flag')
    activePhotoshopCancels.set(taskId, cancelFilePath)
    try {
      return await runBatch(
        scan.prints,
        parsed.data.templates,
        {
          taskId,
          outputRoot: parsed.data.output_root,
          outputLayout: parsed.data.output_layout,
          replaceRange: parsed.data.replace_range,
          format: parsed.data.format,
          clipMode: parsed.data.clip_mode,
          skipCompleted: parsed.data.skip_completed,
          maxRetries: parsed.data.max_retries,
          cancelFilePath,
        },
        {
          onProgress: (progress) => sendPhotoshopProgress(event.sender, progress),
          onLog: (entry) => sendPhotoshopLog(event.sender, entry),
        },
      )
    } finally {
      activePhotoshopCancels.delete(taskId)
    }
  })
  ipcMain.handle('photoshop:cancel', async (_event, input: unknown) => {
    const parsed = cancelInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('INVALID_INPUT', 'PS 套版取消参数无效', false, {
        issues: parsed.error.issues,
      })
    }
    const cancelFilePath = activePhotoshopCancels.get(parsed.data.task_id)
    if (!cancelFilePath) {
      return { ok: false }
    }
    await writeFile(cancelFilePath, String(Date.now()), 'utf8')
    return { ok: true }
  })
  ipcMain.handle('photoshop:list-cached-templates', () => psdScanner.listCachedTemplates())
}
