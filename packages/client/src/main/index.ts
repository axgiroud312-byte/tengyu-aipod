import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { BrowserWindow, app, dialog, ipcMain, session, shell } from 'electron'
import { z } from 'zod'
import {
  getActiveListingRunCount,
  markActiveListingRunsInterrupted,
  registerListingRunnerIpc,
} from '../modules/listing/runner'
import {
  countRunningTasks,
  initializeWorkbenchAfterPipelineCleanup,
  installQuitGuard,
  installSingleInstanceLock,
} from './app-lifecycle'
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
import { exportDiagnosticLogZip } from './lib/diagnostic-log-export-service'
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
import { getConfiguredWorkbenchRoot } from './lib/workbench-config'
import { registerOnboardingIpc } from './onboarding'
import { photoshopComAdapter } from './photoshop/com-adapter'
import { registerPhotoshopIpc } from './photoshop/ipc'
import { rendererContentSecurityPolicyResponse } from './window-security'

const currentDir = dirname(fileURLToPath(import.meta.url))
let diagnosticLogCleanupTimer: ReturnType<typeof setInterval> | null = null

registerLocalImageProtocolScheme()

const logsExportZipInputSchema = z
  .object({
    outputPath: z.string().min(1).optional(),
  })
  .optional()

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

function installRenderProcessRecovery(window: BrowserWindow): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone', details)
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        buttons: ['重新加载', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '界面已崩溃',
        message: '界面已崩溃，是否重新加载？',
        ...(details.reason ? { detail: `原因：${details.reason}` } : {}),
      })
      .then((result) => {
        if (result.response === 0 && !window.isDestroyed()) {
          window.webContents.reload()
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to show renderer recovery dialog', error)
      })
  })
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
      preload: join(currentDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Preload failed: ${preloadPath}`, error)
  })
  installRenderProcessRecovery(mainWindow)
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

async function getWorkbenchLogsRoot() {
  const workbenchRoot = await getConfiguredWorkbenchRoot()
  if (!workbenchRoot) {
    throw new AppErrorClass('HTTP_4XX', '请先在设置里选择工作区', false)
  }
  const logsRoot = join(workbenchRoot, '.workbench', 'logs')
  await mkdir(logsRoot, { recursive: true })
  return { logsRoot, workbenchRoot }
}

async function chooseDiagnosticZipPath(requestedPath?: string | undefined) {
  if (requestedPath) {
    return requestedPath
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const options = {
    title: '导出日志包',
    defaultPath: join(app.getPath('downloads'), `腾域aipod-诊断日志-${timestamp}.zip`),
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
  }
  const owner = BrowserWindow.getFocusedWindow()
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  return result.canceled ? null : (result.filePath ?? null)
}

function ipcError(error: unknown, fallbackCode: string) {
  if (error instanceof AppErrorClass) {
    return { code: error.code, message: error.message }
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  }
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback(rendererContentSecurityPolicyResponse(details, app.isPackaged))
    })
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
    ipcMain.handle('logs:open-dir', async () => {
      try {
        const { logsRoot } = await getWorkbenchLogsRoot()
        const openError = await shell.openPath(logsRoot)
        if (openError) {
          throw new AppErrorClass('HTTP_5XX', `打开日志目录失败：${openError}`, false, {
            path: logsRoot,
          })
        }
        return { ok: true, data: { path: logsRoot } }
      } catch (error) {
        return {
          ok: false,
          error: ipcError(error, 'OPEN_LOG_DIR_FAILED'),
        }
      }
    })
    ipcMain.handle('logs:export:zip', async (_event, input: unknown) => {
      const parsed = logsExportZipInputSchema.safeParse(input)
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'INVALID_INPUT', message: '日志导出参数不正确' },
        }
      }
      try {
        const outputPath = await chooseDiagnosticZipPath(parsed.data?.outputPath)
        if (!outputPath) {
          return { ok: false, error: { code: 'CANCELLED', message: '已取消导出日志包' } }
        }
        const { workbenchRoot } = await getWorkbenchLogsRoot()
        return {
          ok: true,
          data: await exportDiagnosticLogZip({ outputPath, workbenchRoot }),
        }
      } catch (error) {
        return {
          ok: false,
          error: ipcError(error, 'EXPORT_LOGS_FAILED'),
        }
      }
    })
    const customerAuthService = new CustomerAuthService({
      onStateChanged: syncSkillCacheWithCustomerAuth,
    })
    registerCustomerAuthIpc(customerAuthService)
    registerOnboardingIpc()
    registerLocalImageProtocolHandler()
    let appIconPath: string | undefined
    try {
      await initializeWorkbenchAfterPipelineCleanup({
        cleanupPersistedPipelineRuns: () => pipelineService.markPersistedRunningRunsInterrupted(),
        registerBusinessIpc: () => {
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
          tempFileManager.startPeriodicCleanup()
          void cleanupDiagnosticLogs().catch(() => null)
          diagnosticLogCleanupTimer = startDiagnosticLogCleanupTimer()
        },
        createWindow: () => {
          appIconPath = applyAppIcon()
          createMainWindow(appIconPath)
        },
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error('Workbench startup initialization failed', error)
      dialog.showErrorBox(
        'Workbench 启动失败',
        `无法完成上次完整任务的中断清理，Workbench 未启动。\n\n${detail}\n\n请检查工作区是否可访问、磁盘空间与数据库文件权限，关闭占用工作区数据库的程序后重试。`,
      )
      app.quit()
      return
    }
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
      photoshopComAdapter.dispose()
      await tempFileManager.cleanupSession().catch(() => null)
      tempFileManager.clearTimers()
      if (diagnosticLogCleanupTimer) {
        clearInterval(diagnosticLogCleanupTimer)
        diagnosticLogCleanupTimer = null
      }
    },
  })
}
