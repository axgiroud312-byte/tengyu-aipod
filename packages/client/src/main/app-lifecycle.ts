type ElectronLikeApp = {
  quit(): void
  on(event: 'second-instance', handler: () => unknown): unknown
  requestSingleInstanceLock(): boolean
}

type QuitGuardApp = {
  quit(): void
  on(event: 'before-quit', handler: (event: QuitEvent) => unknown): unknown
}

type FocusableWindow = {
  focus(): void
  isMinimized(): boolean
  restore(): void
}

type QuitEvent = {
  preventDefault(): void
}

type QuitDialog = {
  showMessageBox(options: {
    type: 'warning'
    buttons: string[]
    defaultId: number
    cancelId: number
    title: string
    message: string
    detail: string
  }): Promise<{ response: number }>
}

export async function initializeWorkbenchAfterPipelineCleanup({
  cleanupPersistedPipelineRuns,
  registerBusinessIpc,
  createWindow,
}: {
  cleanupPersistedPipelineRuns: () => Promise<void>
  registerBusinessIpc: () => void
  createWindow: () => void
}) {
  await cleanupPersistedPipelineRuns()
  registerBusinessIpc()
  createWindow()
}

export function installSingleInstanceLock({
  app,
  getWindows,
}: {
  app: ElectronLikeApp
  getWindows: () => FocusableWindow[]
}) {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }

  app.on('second-instance', () => {
    const [mainWindow] = getWindows()
    if (!mainWindow) {
      return
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  })
  return true
}

export function countRunningTasks(counts: {
  pipeline: number
  generation: number
  detection: number
  listing: number
}) {
  return counts.pipeline + counts.generation + counts.detection + counts.listing
}

export function installQuitGuard({
  app,
  cleanup,
  dialog,
  getRunningTaskCount,
  interruptActiveRuns,
}: {
  app: QuitGuardApp
  cleanup: () => void | Promise<void>
  dialog: QuitDialog
  getRunningTaskCount: () => number
  interruptActiveRuns: () => Promise<void>
}) {
  let confirmedQuit = false
  let cleanedUp = false

  async function cleanupOnce() {
    if (cleanedUp) {
      return
    }
    cleanedUp = true
    await cleanup()
  }

  app.on('before-quit', async (event: QuitEvent) => {
    if (confirmedQuit) {
      await cleanupOnce()
      return
    }

    const runningCount = getRunningTaskCount()
    if (runningCount === 0) {
      await cleanupOnce()
      return
    }

    event.preventDefault()
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['确认退出', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '确认退出',
      message: `有 ${runningCount} 个任务运行中，退出将中断任务，确认退出？`,
      detail: '取消会回到当前任务；确认退出会先把运行中任务标记为已中断。',
    })
    if (result.response !== 0) {
      return
    }

    confirmedQuit = true
    await interruptActiveRuns()
    await cleanupOnce()
    app.quit()
  })
}
