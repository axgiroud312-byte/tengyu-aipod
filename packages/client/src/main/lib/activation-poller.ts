import {
  API_PATHS,
  type ActivationBadgeState,
  type ActivationServerSnapshot,
  CACHE_REFRESH_INTERVAL_MINUTES,
} from '@tengyu-aipod/shared'
import type { BrowserWindow } from 'electron'
import {
  buildActivationBadgeState,
  clearActivationBlockReason,
  extractActivationCodeSuffix,
  markActivationUnauthorized,
  readActivationStateFile,
  saveActivationSnapshot,
} from './activation-state'
import { getSecret } from './keychain'

const SERVER_BASE_URL = process.env.TENGYU_SERVER_URL ?? 'http://localhost:3000'
const POLL_INTERVAL_MS = CACHE_REFRESH_INTERVAL_MINUTES * 60 * 1000
const RECENT_CHECK_MS = 60 * 60 * 1000

interface StatusResponse {
  ok: boolean
  data?: ActivationServerSnapshot
  error?: {
    code: string
    message?: string
  }
}

export class ActivationPoller {
  private intervalId: NodeJS.Timeout | null = null
  private mainWindow: BrowserWindow | null = null

  bindWindow(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  start() {
    if (this.intervalId) {
      return
    }

    void this.poll()
    this.intervalId = setInterval(() => {
      void this.poll()
    }, POLL_INTERVAL_MS)
  }

  stop() {
    if (!this.intervalId) {
      return
    }

    clearInterval(this.intervalId)
    this.intervalId = null
  }

  async currentStatus(): Promise<ActivationBadgeState> {
    const state = await readActivationStateFile()
    return buildActivationBadgeState(state)
  }

  async poll(): Promise<ActivationBadgeState> {
    const token = await getSecret('activation_token')
    if (!token) {
      return this.broadcast(await this.currentStatus())
    }

    const tokenCodeSuffix = extractActivationCodeSuffix(token)
    try {
      const status = await this.fetchStatusWithRetry(token)
      await saveActivationSnapshot(status, {
        lastServerCheck: Date.now(),
        tokenCodeSuffix,
      })
      await clearActivationBlockReason()
    } catch (error) {
      if (error instanceof UnauthorizedActivationError) {
        await markActivationUnauthorized('激活已失效，请重新激活')
      } else {
        // Keep cached state when the network is offline or the server is temporarily unavailable.
      }
    }

    return this.broadcast(await this.currentStatus())
  }

  private broadcast(status: ActivationBadgeState) {
    this.mainWindow?.webContents.send('activation:status-changed', status)
    return status
  }

  private async fetchStatusWithRetry(token: string) {
    let lastError: unknown = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fetchStatus(token)
      } catch (error) {
        if (error instanceof UnauthorizedActivationError) {
          throw error
        }
        lastError = error
      }
    }

    throw lastError
  }
}

export class UnauthorizedActivationError extends Error {
  constructor() {
    super('activation unauthorized')
    this.name = 'UnauthorizedActivationError'
  }
}

async function fetchStatus(token: string) {
  const response = await fetch(`${SERVER_BASE_URL}${API_PATHS.status}`, {
    headers: { authorization: `Bearer ${token}` },
  })

  if (response.status === 401) {
    throw new UnauthorizedActivationError()
  }
  if (!response.ok) {
    throw new Error(`status request failed: ${response.status}`)
  }

  const result = (await response.json()) as StatusResponse
  if (!result.ok || !result.data) {
    throw new Error(result.error?.code ?? 'STATUS_FAILED')
  }

  return result.data
}

export const activationPoller = new ActivationPoller()

export async function requireActiveAndRecent() {
  let status = await activationPoller.currentStatus()
  const lastServerCheck = status.lastServerCheck ?? 0
  if (Date.now() - lastServerCheck > RECENT_CHECK_MS) {
    status = await activationPoller.poll()
  }

  return {
    ok: status.kind === 'active' || status.kind === 'trial' || status.kind === 'expiring',
    status,
  }
}
