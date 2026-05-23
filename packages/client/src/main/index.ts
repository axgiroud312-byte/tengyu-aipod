import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, ipcMain } from 'electron'
import { activationPoller } from './lib/activation-poller'
import { registerSkillCacheIpc, skillCacheManager } from './lib/skill-cache'
import { registerTempFileIpc, tempFileManager } from './lib/temp-file-manager'
import { registerTitleIpc } from './lib/title-service'
import { registerOnboardingIpc } from './onboarding'

const currentDir = dirname(fileURLToPath(import.meta.url))

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '腾域 aipod',
    webPreferences: {
      preload: join(currentDir, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  activationPoller.bindWindow(mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }

  void mainWindow.loadFile(join(currentDir, '../renderer/index.html'))
}

app.whenReady().then(() => {
  ipcMain.handle('app:ping', () => 'pong')
  ipcMain.handle('activation:get-status', () => activationPoller.currentStatus())
  ipcMain.handle('activation:sync-status', () => activationPoller.poll())
  registerOnboardingIpc()
  registerSkillCacheIpc()
  registerTempFileIpc()
  registerTitleIpc()
  void tempFileManager.cleanupOrphans().catch(() => null)
  createMainWindow()
  activationPoller.start()
  skillCacheManager.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  activationPoller.stop()
  skillCacheManager.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void tempFileManager.cleanupSession().catch(() => null)
  tempFileManager.clearTimers()
})
