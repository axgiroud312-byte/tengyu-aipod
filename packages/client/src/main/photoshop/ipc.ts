import { ipcMain } from 'electron'
import { photoshopStatusChecker } from './status-checker'

export function registerPhotoshopIpc(): void {
  ipcMain.handle('photoshop:get-status', () => photoshopStatusChecker.check())
}
