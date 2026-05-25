import { AppErrorClass } from '@tengyu-aipod/shared'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { psdScanner } from './psd-scanner'
import { photoshopStatusChecker } from './status-checker'

const scanTemplateInputSchema = z.object({
  psd_path: z.string().min(1),
})

export function registerPhotoshopIpc(): void {
  ipcMain.handle('photoshop:get-status', () => photoshopStatusChecker.check())
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
