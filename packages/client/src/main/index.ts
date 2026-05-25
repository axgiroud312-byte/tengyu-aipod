import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, ipcMain } from 'electron'
import { activationPoller } from './lib/activation-poller'
import { tempFileManager } from './lib/temp-file-manager'
import { registerOnboardingIpc } from './onboarding'
import { registerPhotoshopIpc } from './photoshop/ipc'

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
  registerPhotoshopIpc()
  void tempFileManager.cleanupOrphans()
  createMainWindow()
  activationPoller.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  activationPoller.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
