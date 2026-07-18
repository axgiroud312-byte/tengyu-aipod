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
import { assertPathInsideWorkbench } from '../lib/workbench-path-guard'
import { readAppConfig } from '../onboarding'
import { runBatch } from './multi-batch'
import { scanPhotoshopPrintFolder, scanPhotoshopPrintPaths } from './print-folder'
import { psdScanner } from './psd-scanner'
import { photoshopStatusChecker } from './status-checker'

const scanTemplateInputSchema = z.object({
  psd_path: z.string().min(1),
})

const scanPrintFolderInputSchema = z.object({
  folder: z.string().min(1),
  excluded_file_paths: z.array(z.string().min(1)).default([]),
})

const runBatchOptionsSchema = z.object({
  templates: z.array(z.string().min(1)).min(1),
  replace_range: z.enum(['auto', 'topmost', 'top', 'all']).default('topmost'),
  smart_object_replace_mode: z
    .enum(['replaceContents', 'editSmartObject'])
    .default('replaceContents'),
  smart_object_inner_fit_mode: z.enum(['fit', 'fill']).default('fill'),
  output_layout: z.enum(['template_first', 'sku_first', 'sku_flat']).default('template_first'),
  format: z.enum(['jpg', 'png']).default('jpg'),
  clip_mode: z.enum(['none', 'auto', 'guides']).default('auto'),
  skip_completed: z.boolean().default(true),
  max_retries: z.number().int().min(0).max(5).default(1),
  output_root: z.string().min(1),
})

const runBatchInputSchema = z.discriminatedUnion('input_mode', [
  runBatchOptionsSchema.extend({
    input_mode: z.literal('detection_candidates'),
    print_paths: z.array(z.string().min(1)).min(1),
  }),
  runBatchOptionsSchema.extend({
    input_mode: z.literal('print_folder'),
    print_folder: z.string().min(1),
    excluded_print_paths: z.array(z.string().min(1)).default([]),
  }),
])

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
    const config = await readAppConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
    }
    await assertPathInsideWorkbench(config.workbench_root, parsed.data.path, {
      domain: 'visible-workbench',
      label: 'PS 打开路径',
    })
    await shell.openPath(parsed.data.path)
    return { ok: true }
  })
  ipcMain.handle('photoshop:scan-print-folder', async (_event, input: unknown) => {
    const parsed = scanPrintFolderInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppErrorClass('INVALID_INPUT', '印花文件夹不能为空', false, {
        issues: parsed.error.issues,
      })
    }
    const config = await readAppConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
    }
    await assertPathInsideWorkbench(config.workbench_root, parsed.data.folder, {
      domain: 'generation',
      label: '印花文件夹',
    })
    return scanPhotoshopPrintFolder(parsed.data.folder, {
      excludeFilePaths: parsed.data.excluded_file_paths,
    })
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
    const config = await readAppConfig()
    if (!config.workbench_root) {
      throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
    }
    const workbenchRoot = config.workbench_root
    await assertPathInsideWorkbench(workbenchRoot, parsed.data.output_root, {
      domain: 'listing',
      label: '套版输出目录',
    })
    const scan =
      parsed.data.input_mode === 'detection_candidates'
        ? await scanPhotoshopPrintPaths(
            await Promise.all(
              parsed.data.print_paths.map((path) =>
                assertPathInsideWorkbench(workbenchRoot, path, {
                  domain: 'detection',
                  label: '检测通过候选',
                }),
              ),
            ),
          )
        : await scanPhotoshopPrintFolder(
            await assertPathInsideWorkbench(workbenchRoot, parsed.data.print_folder, {
              domain: 'generation',
              label: '印花文件夹',
            }),
            {
              excludeFilePaths: parsed.data.excluded_print_paths,
            },
          )
    if (scan.prints.length === 0) {
      throw new AppErrorClass('INVALID_INPUT', '当前输入没有可套版图片', false, {
        input_mode: parsed.data.input_mode,
      })
    }

    const taskId = `ps-${randomUUID()}`
    const taskDir = await tempFileManager.createTaskDir('photoshop', taskId)
    const cancelFilePath = join(taskDir, 'cancel.flag')
    activePhotoshopCancels.set(taskId, cancelFilePath)
    let completed = false
    try {
      const result = await runBatch(
        scan.prints,
        parsed.data.templates,
        {
          taskId,
          outputRoot: parsed.data.output_root,
          outputLayout: parsed.data.output_layout,
          replaceRange: parsed.data.replace_range,
          smartObjectReplaceMode: parsed.data.smart_object_replace_mode,
          smartObjectInnerFitMode: parsed.data.smart_object_inner_fit_mode,
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
      completed = true
      return result
    } finally {
      activePhotoshopCancels.delete(taskId)
      try {
        await tempFileManager.cleanupTask('photoshop', taskId, { keepIfFailed: !completed })
      } catch (cleanupError) {
        sendPhotoshopLog(event.sender, {
          ts: Date.now(),
          level: 'warn',
          stage: 'task_complete',
          task_id: taskId,
          message: 'PS 临时文件暂时无法清理，将由自动清理任务稍后重试',
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      }
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
