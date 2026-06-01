import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, ipcMain } from 'electron'
import { registerListingRunnerIpc } from '../modules/listing/runner'
import { browserProfileLocks, registerBrowserProfileLockIpc } from './lib/browser-profile-lock'
import { registerChenyuInstanceIpc } from './lib/chenyu-instance-service'
import { registerCollectionClickIpc } from './lib/collection-click-service'
import { registerCollectionConfigIpc } from './lib/collection-config'
import { registerCollectionImageIndexIpc } from './lib/collection-image-index-service'
import { registerCollectionSessionIpc } from './lib/collection-session-manager'
import { registerComfyuiWorkflowCacheIpc } from './lib/comfyui-workflow-cache'
import { registerDetectionConfigIpc } from './lib/detection-config'
import { registerDetectionIpc } from './lib/detection-service'
import { registerGenerationLocalConfigIpc } from './lib/generation-local-config'
import { registerGenerationIpc } from './lib/generation-service'
import {
  registerLocalImageProtocolHandler,
  registerLocalImageProtocolScheme,
} from './lib/local-image-protocol'
import { runNativeSmoke } from './lib/native-smoke'
import { registerSkillCacheIpc, skillCacheManager } from './lib/skill-cache'
import { registerTempFileIpc, tempFileManager } from './lib/temp-file-manager'
import { registerTitleIpc } from './lib/title-service'
import { registerOnboardingIpc } from './onboarding'
import { registerPhotoshopIpc } from './photoshop/ipc'

const currentDir = dirname(fileURLToPath(import.meta.url))

registerLocalImageProtocolScheme()

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
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }

  void mainWindow.loadFile(join(currentDir, '../renderer/index.html'))
}

app.whenReady().then(() => {
  try {
    runNativeSmoke()
  } catch {
    app.quit()
    return
  }

  ipcMain.handle('app:ping', () => 'pong')
  registerOnboardingIpc()
  registerChenyuInstanceIpc()
  registerBrowserProfileLockIpc()
  registerGenerationLocalConfigIpc()
  registerLocalImageProtocolHandler()
  registerComfyuiWorkflowCacheIpc()
  registerSkillCacheIpc()
  registerTempFileIpc()
  registerCollectionConfigIpc()
  registerCollectionSessionIpc()
  registerCollectionClickIpc()
  registerCollectionImageIndexIpc()
  registerTitleIpc()
  registerDetectionConfigIpc()
  registerDetectionIpc()
  registerGenerationIpc()
  registerListingRunnerIpc()
  registerPhotoshopIpc()
  void tempFileManager.cleanupOrphans().catch(() => null)
  createMainWindow()
  skillCacheManager.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
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
