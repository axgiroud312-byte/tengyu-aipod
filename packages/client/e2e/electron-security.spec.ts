import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

test.describe('Electron security boundary', () => {
  let app: ElectronApplication | null = null
  let userDataDir = ''

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'tengyu-electron-security-e2e-'))
  })

  test.afterEach(async () => {
    await app?.close()
    app = null
    await rm(userDataDir, { recursive: true, force: true })
  })

  test('keeps the renderer sandboxed while the preload bridge remains available', async () => {
    app = await electron.launch({
      args: ['out/main/index.js'],
      cwd: process.cwd(),
      timeout: 30_000,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        NODE_ENV: 'development',
        TENGYU_ELECTRON_USER_DATA_DIR: userDataDir,
      },
    })
    const page = await app.firstWindow()

    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) {
        throw new Error('Main window was not created')
      }
      const current = window.webContents.getLastWebPreferences()
      return {
        contextIsolation: current.contextIsolation,
        nodeIntegration: current.nodeIntegration,
        sandbox: current.sandbox,
        webSecurity: current.webSecurity,
      }
    })

    expect(preferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    })
    const navigationResponse = await page.reload()
    const contentSecurityPolicy = navigationResponse?.headers()['content-security-policy']
    expect(contentSecurityPolicy).toContain("default-src 'self'")
    expect(contentSecurityPolicy).toContain("script-src 'self' 'unsafe-inline'")
    expect(contentSecurityPolicy).toContain("object-src 'none'")
    await expect(page.evaluate(() => window.api.ping())).resolves.toBe('pong')
  })
})
