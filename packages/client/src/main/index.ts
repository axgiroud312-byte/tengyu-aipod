import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, ipcMain } from 'electron'
import { registerListingRunnerIpc } from '../modules/listing/runner'
import { registerDialogIpc } from './dialog'
import { activationPoller } from './lib/activation-poller'
import { browserProfileLocks, registerBrowserProfileLockIpc } from './lib/browser-profile-lock'
import { registerCollectionClickIpc } from './lib/collection-click-service'
import { registerCollectionSessionIpc } from './lib/collection-session-manager'
import { registerDetectionConfigIpc } from './lib/detection-config'
import { registerDetectionIpc } from './lib/detection-service'
import { registerGenerationIpc } from './lib/generation-service'
import { registerSkillCacheIpc, skillCacheManager } from './lib/skill-cache'
import { registerTempFileIpc, tempFileManager } from './lib/temp-file-manager'
import { registerTitleIpc } from './lib/title-service'
import { registerOnboardingIpc } from './onboarding'
import { registerPhotoshopIpc } from './photoshop/ipc'

const currentDir = dirname(fileURLToPath(import.meta.url))

if (process.env.TENGYU_ELECTRON_USER_DATA_DIR) {
  app.setPath('userData', process.env.TENGYU_ELECTRON_USER_DATA_DIR)
}

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '腾域 aipod',
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Preload failed: ${preloadPath}`, error)
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
  registerDialogIpc()
  registerOnboardingIpc()
  registerBrowserProfileLockIpc()
  registerSkillCacheIpc()
  registerTempFileIpc()
  registerCollectionSessionIpc()
  registerCollectionClickIpc()
  registerTitleIpc()
  registerDetectionConfigIpc()
  registerDetectionIpc()
  registerGenerationIpc()
  registerListingRunnerIpc()
  registerPhotoshopIpc()
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
  browserProfileLocks.clear()
  void tempFileManager.cleanupSession().catch(() => null)
  tempFileManager.clearTimers()
})
