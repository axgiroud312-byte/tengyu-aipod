import { dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'

const chooseDirectoryInputSchema = z
  .object({
    title: z.string().optional(),
    defaultPath: z.string().optional(),
  })
  .optional()

export type ChooseDirectoryInput = z.infer<typeof chooseDirectoryInputSchema>

export type ChooseDirectoryResult =
  | { ok: true; data: { path: string } }
  | { ok: false; error: { code: 'CANCELED'; message: string } }

export type OpenPathResult =
  | { ok: true }
  | { ok: false; error: { code: 'OPEN_PATH_FAILED'; message: string } }

export function registerDialogIpc(): void {
  ipcMain.handle('dialog:choose-directory', async (_event, input: unknown) => {
    const parsed = chooseDirectoryInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new Error('选择目录参数不正确')
    }

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: parsed.data?.title,
      defaultPath: parsed.data?.defaultPath,
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELED', message: '已取消选择目录' } }
    }

    return { ok: true, data: { path: result.filePaths[0] } }
  })

  ipcMain.handle('shell:open-path', async (_event, input: unknown) => {
    const parsed = z.object({ path: z.string().min(1) }).safeParse(input)
    if (!parsed.success) {
      throw new Error('打开路径参数不正确')
    }

    const error = await shell.openPath(parsed.data.path)
    if (error) {
      return { ok: false, error: { code: 'OPEN_PATH_FAILED', message: error } }
    }
    return { ok: true }
  })
}
