import { createHash } from 'node:crypto'
import os from 'node:os'
import { app, dialog, ipcMain } from 'electron'
import { activationPoller } from './lib/activation-poller'
import {
  extractActivationCodeSuffix,
  markOnboardingComplete,
  readActivationStateFile,
  saveActivationSnapshot,
} from './lib/activation-state'
import { hasSecret, setSecret } from './lib/keychain'
import {
  defaultWorkbenchRoot,
  ensureWorkbenchDirectories,
  readAppConfig,
  writeAppConfig,
} from './lib/workbench-config'

const SERVER_BASE_URL = process.env.TENGYU_SERVER_URL ?? 'http://localhost:3000'

interface ActivateResponse {
  ok: boolean
  data?: {
    activation_token: string
    expires_at: number
    max_devices: number
    used_devices: number
    device_name: string
  }
  error?: {
    code: string
    message?: string
  }
}

const activationErrorMessages: Record<string, string> = {
  INVALID_INPUT: '激活码或设备信息格式不正确',
  INVALID_CODE: '激活码不存在，请检查后重试',
  CODE_BANNED: '该激活码已被封禁，请联系管理员',
  CUSTOMER_BANNED: '该客户已被封禁，请联系管理员',
  CODE_EXPIRED: '该激活码已过期，请联系管理员续费',
  ALREADY_ACTIVATED_BY_OTHER: '这台设备已经绑定了其他激活码',
  DEVICE_LIMIT_REACHED: '该激活码的设备数量已达上限',
  RATE_LIMITED: '尝试次数过多，请稍后再试',
  INTERNAL_ERROR: '服务器暂时不可用，请稍后再试',
}

function generateDeviceFingerprint() {
  const cpu = os.cpus()[0]?.model ?? ''
  const platform = os.platform()
  const arch = os.arch()
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .map((item) => item?.mac)
    .filter((mac): mac is string => Boolean(mac) && mac !== '00:00:00:00:00:00')
    .sort()
    .join(',')
  const seed = `${platform}|${arch}|${cpu}|${macs}|${os.hostname()}`

  return createHash('sha256').update(seed).digest('hex')
}

export function registerOnboardingIpc() {
  ipcMain.handle('onboarding:get-state', async () => {
    const config = await readAppConfig()
    const activationState = await readActivationStateFile()

    return {
      needs_onboarding: !activationState.completed_at,
      default_workbench_root: config.workbench_root ?? (await defaultWorkbenchRoot()),
    }
  })

  ipcMain.handle(
    'activation:activate',
    async (_event, input: { code: string; device_name: string }) => {
      const response = await fetch(`${SERVER_BASE_URL}/api/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: input.code,
          device_name: input.device_name,
          device_fingerprint: generateDeviceFingerprint(),
        }),
      })
      const result = (await response.json()) as ActivateResponse
      if (!result.ok || !result.data) {
        const code = result.error?.code ?? 'INTERNAL_ERROR'
        return {
          ok: false,
          error: {
            code,
            message: activationErrorMessages[code] ?? result.error?.message ?? '激活失败',
          },
        }
      }

      const config = await readAppConfig()
      await setSecret('activation_token', result.data.activation_token)
      await saveActivationSnapshot(
        {
          status: 'active',
          days_remaining: Math.max(
            0,
            Math.ceil((result.data.expires_at - Date.now()) / (24 * 60 * 60 * 1000)),
          ),
          max_devices: result.data.max_devices,
          used_devices: result.data.used_devices,
          device_name: result.data.device_name,
          customer: { has_contact: false },
        },
        {
          lastServerCheck: Date.now(),
          tokenCodeSuffix: extractActivationCodeSuffix(result.data.activation_token),
        },
      )
      await writeAppConfig(config)
      void activationPoller.poll()

      return { ok: true, data: result.data }
    },
  )

  ipcMain.handle('onboarding:choose-workbench-root', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: await defaultWorkbenchRoot(),
    })
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: { code: 'CANCELLED', message: '已取消选择目录' } }
    }

    return { ok: true, data: { path: result.filePaths[0] } }
  })

  ipcMain.handle('onboarding:save-workbench-root', async (_event, root: string) => {
    await ensureWorkbenchDirectories(root)
    const config = await readAppConfig()
    await writeAppConfig({ ...config, workbench_root: root })

    return { ok: true, data: { path: root } }
  })

  ipcMain.handle('onboarding:save-api-keys', async (_event, apiKeys: Record<string, string>) => {
    await Promise.all(
      Object.entries(apiKeys)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => setSecret(key, value.trim())),
    )

    return { ok: true }
  })

  ipcMain.handle('onboarding:complete', async () => {
    await markOnboardingComplete()
    void activationPoller.poll()

    return { ok: true }
  })

  ipcMain.handle('keychain:has', async (_event, input: { key: string }) => hasSecret(input.key))
}
