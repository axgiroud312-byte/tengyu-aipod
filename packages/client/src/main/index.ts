import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import {
  getActiveListingRunCount,
  markActiveListingRunsInterrupted,
  registerListingRunnerIpc,
} from '../modules/listing/runner'
import { countRunningTasks, installQuitGuard, installSingleInstanceLock } from './app-lifecycle'
import { browserProfileLocks, registerBrowserProfileLockIpc } from './lib/browser-profile-lock'
import { registerChenyuInstanceIpc } from './lib/chenyu-instance-service'
import { registerCollectionClickIpc } from './lib/collection-click-service'
import { registerCollectionConfigIpc } from './lib/collection-config'
import { registerCollectionImageIndexIpc } from './lib/collection-image-index-service'
import { registerCollectionSessionIpc } from './lib/collection-session-manager'
import { registerComfyuiWorkflowCacheIpc } from './lib/comfyui-workflow-cache'
import {
  CustomerAuthService,
  type CustomerAuthState,
  registerCustomerAuthIpc,
} from './lib/customer-auth'
import { withCustomerAuthorizedIpcHandlers } from './lib/customer-auth-ipc-guard'
import { registerDetectionConfigIpc } from './lib/detection-config'
import { detectionService, registerDetectionIpc } from './lib/detection-service'
import {
  cleanupDiagnosticLogs,
  deleteAllWorkbenchLogFiles,
  startDiagnosticLogCleanupTimer,
} from './lib/diagnostic-log-service'
import { registerGenerationLocalConfigIpc } from './lib/generation-local-config'
import {
  getActiveGenerationTaskCount,
  registerGenerationIpc,
  requestAllGenerationCancels,
} from './lib/generation-service'
import {
  registerLocalImageProtocolHandler,
  registerLocalImageProtocolScheme,
} from './lib/local-image-protocol'
import { runNativeSmoke } from './lib/native-smoke'
import { pipelineService, registerPipelineIpc } from './lib/pipeline-service'
import { registerSkillCacheIpc, skillCacheManager } from './lib/skill-cache'
import { registerTempFileIpc, tempFileManager } from './lib/temp-file-manager'
import { registerTitleIpc } from './lib/title-service'
import { registerVideoGenerationIpc } from './lib/video-generation-service'
import { registerOnboardingIpc } from './onboarding'
import { registerPhotoshopIpc } from './photoshop/ipc'

const currentDir = dirname(fileURLToPath(import.meta.url))
let diagnosticLogCleanupTimer: ReturnType<typeof setInterval> | null = null

registerLocalImageProtocolScheme()

if (process.env.TENGYU_ELECTRON_USER_DATA_DIR) {
  app.setPath('userData', process.env.TENGYU_ELECTRON_USER_DATA_DIR)
}

const hasSingleInstanceLock = installSingleInstanceLock({
  app,
  getWindows: () => BrowserWindow.getAllWindows(),
})

function resolveAppIconPath(): string | undefined {
  const appIconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(currentDir, '../../resources/icon.png')
  return existsSync(appIconPath) ? appIconPath : undefined
}

function applyAppIcon(): string | undefined {
  const appIconPath = resolveAppIconPath()
  if (process.platform === 'darwin' && appIconPath) {
    app.dock?.setIcon(appIconPath)
  }
  return appIconPath
}

function createMainWindow(appIconPath = resolveAppIconPath()): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    ...(appIconPath ? { icon: appIconPath } : {}),
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

function syncSkillCacheWithCustomerAuth(state: CustomerAuthState) {
  if (state.status === 'active') {
    skillCacheManager.start()
    return
  }

  skillCacheManager.stop()
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    void pipelineService.markPersistedRunningRunsInterrupted().catch(() => null)
    try {
      runNativeSmoke()
    } catch {
      app.quit()
      return
    }

    ipcMain.handle('app:ping', () => 'pong')
    ipcMain.handle('logs:delete-all', async () => {
      try {
        return {
          ok: true,
          data: await deleteAllWorkbenchLogFiles(),
        }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'DELETE_LOGS_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    })
    const customerAuthService = new CustomerAuthService({
      onStateChanged: syncSkillCacheWithCustomerAuth,
    })
    registerCustomerAuthIpc(customerAuthService)
    registerOnboardingIpc()
    registerLocalImageProtocolHandler()
    withCustomerAuthorizedIpcHandlers(ipcMain, customerAuthService, () => {
      registerChenyuInstanceIpc()
      registerBrowserProfileLockIpc()
      registerGenerationLocalConfigIpc()
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
      registerVideoGenerationIpc()
      registerPipelineIpc()
      registerListingRunnerIpc()
      registerPhotoshopIpc()
    })
    void tempFileManager.cleanupOrphans().catch(() => null)
    void cleanupDiagnosticLogs().catch(() => null)
    diagnosticLogCleanupTimer = startDiagnosticLogCleanupTimer()
    const appIconPath = applyAppIcon()
    createMainWindow(appIconPath)
    void customerAuthService.verify().catch(() => null)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(appIconPath)
      }
    })
  })

  app.on('window-all-closed', () => {
    skillCacheManager.stop()
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  installQuitGuard({
    app,
    dialog,
    getRunningTaskCount: () =>
      countRunningTasks({
        pipeline: pipelineService.getActiveRunCount(),
        generation: getActiveGenerationTaskCount(),
        detection: detectionService.getActiveTaskCount(),
        listing: getActiveListingRunCount(),
      }),
    interruptActiveRuns: async () => {
      requestAllGenerationCancels()
      detectionService.cancelAllTasks()
      await markActiveListingRunsInterrupted()
      await pipelineService.markActiveRunsInterrupted()
    },
    cleanup: async () => {
      browserProfileLocks.clear()
      await tempFileManager.cleanupSession().catch(() => null)
      tempFileManager.clearTimers()
      if (diagnosticLogCleanupTimer) {
        clearInterval(diagnosticLogCleanupTimer)
        diagnosticLogCleanupTimer = null
      }
    },
  })
}
