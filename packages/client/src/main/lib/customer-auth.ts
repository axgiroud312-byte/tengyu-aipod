import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { arch, hostname, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { API_PATHS } from '@tengyu-aipod/shared'
import { app, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { deleteSecret, deleteSecrets, getSecret, setSecret, setSecrets } from './keychain'
import { serverUrl } from './server-base-url'

const DEFAULT_PHP_AUTH_BASE_URL = 'https://tengyuai.com'
const CUSTOMER_UID_KEY = 'customer-auth.php-uid'
const CUSTOMER_SECRET_KEY = 'customer-auth.php-secret'
const STATE_FILE_NAME = 'customer-auth.json'
const SMS_COOLDOWN_MS = 60_000

export type CustomerAuthStatus =
  | 'anonymous'
  | 'pending'
  | 'active'
  | 'disabled'
  | 'expired'
  | 'nologin'

export type CustomerAuthCustomer = {
  account: string | null
  avatar_url: string | null
  expires_at: string | null
  id: string
  nickname: string | null
  phone: string | null
  php_uid: number
}

export type CustomerAuthState = {
  customer: CustomerAuthCustomer | null
  message: string | null
  status: CustomerAuthStatus
}

export type CustomerAuthQrcode = {
  qrcode_url: string
  token: string
}

export type CustomerAuthSmsResult = {
  message: string
  ok: boolean
  remaining_seconds: number
}

type Fetcher = typeof fetch

type SecretStore = {
  deleteSecret: typeof deleteSecret
  deleteSecrets: typeof deleteSecrets
  getSecret: typeof getSecret
  setSecret: typeof setSecret
  setSecrets: typeof setSecrets
}

type CustomerAuthStateFile = {
  customer?: CustomerAuthCustomer | null
  finger?: string
  last_sms_sent_at?: number
  message?: string | null
  status?: CustomerAuthStatus
  verified_at?: string
}

type LoginCredentials = {
  secret: string
  uid: number
}

type CredentialsReadResult =
  | {
      credentials: LoginCredentials
      invalid: false
    }
  | {
      credentials: null
      invalid: boolean
    }

const customerSchema = z.object({
  account: z.string().nullable(),
  avatar_url: z.string().nullable(),
  expires_at: z.string().nullable(),
  id: z.string(),
  nickname: z.string().nullable(),
  phone: z.string().nullable(),
  php_uid: z.coerce.number().int().positive(),
})

const nextVerifyResponseSchema = z
  .object({
    data: z
      .object({
        customer: customerSchema.optional(),
        status: z.enum(['pending', 'active', 'disabled', 'expired']).optional(),
      })
      .optional(),
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
      })
      .optional(),
    ok: z.boolean().optional(),
    status: z.enum(['pending', 'active', 'disabled', 'expired', 'nologin']).optional(),
  })
  .passthrough()

const phpResponseSchema = z
  .object({
    data: z.unknown().optional(),
    info: z.string().optional(),
    status: z.unknown().optional(),
  })
  .passthrough()

const phpLoginDataSchema = z
  .object({
    secret: z.string().min(1),
    uid: z.coerce.number().int().positive(),
  })
  .passthrough()

const phpQrcodeDataSchema = z
  .object({
    qrcode_url: z.string().min(1),
    token: z.string().min(1),
  })
  .passthrough()

const sendSmsInputSchema = z.object({
  phone: z.string().trim().min(1),
})

const phoneLoginInputSchema = z.object({
  code: z.string().trim().min(1),
  invite: z.string().optional(),
  phone: z.string().trim().min(1),
})

const checkWechatLoginInputSchema = z.object({
  token: z.string().trim().min(1),
})

function stateFilePath() {
  return join(app.getPath('userData'), STATE_FILE_NAME)
}

function normalizeBaseUrl(value: string | undefined) {
  return (value?.trim() || DEFAULT_PHP_AUTH_BASE_URL).replace(/\/+$/, '')
}

export function resolvePhpAuthBaseUrl(configuredUrl = process.env.TENGYU_PHP_AUTH_BASE_URL) {
  return normalizeBaseUrl(configuredUrl)
}

function isSuccessStatus(value: unknown) {
  return value === true || value === 1 || value === '1'
}

function anonymousState(message: string | null = null): CustomerAuthState {
  return { customer: null, message, status: 'anonymous' }
}

function nologinState(message = '登录状态失效，请重新登录'): CustomerAuthState {
  return { customer: null, message, status: 'nologin' }
}

function secondsRemaining(untilMs: number, nowMs: number) {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000))
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJsonFile(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8')
}

function safeMessage(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function makeFinger(userDataPath: string) {
  const seed = [hostname(), platform(), arch(), userDataPath].join('|')
  return `desktop_${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`
}

function parseExternalLoginUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('unsupported protocol')
    }
    return url.toString()
  } catch {
    throw new Error('微信登录页地址不正确')
  }
}

export class CustomerAuthService {
  private readonly fetcher: Fetcher
  private readonly now: () => number
  private readonly phpAuthBaseUrl: string
  private readonly secretStore: SecretStore
  private readonly onStateChanged: ((state: CustomerAuthState) => void) | undefined

  constructor(
    options: {
      fetcher?: Fetcher
      now?: () => number
      onStateChanged?: (state: CustomerAuthState) => void
      phpAuthBaseUrl?: string
      secretStore?: SecretStore
    } = {},
  ) {
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.phpAuthBaseUrl = resolvePhpAuthBaseUrl(options.phpAuthBaseUrl)
    this.secretStore = options.secretStore ?? {
      deleteSecret,
      deleteSecrets,
      getSecret,
      setSecret,
      setSecrets,
    }
    this.onStateChanged = options.onStateChanged
  }

  async getState(): Promise<CustomerAuthState> {
    const result = await this.readCredentials()
    if (!result.credentials) {
      return result.invalid ? nologinState('登录状态异常，请重新登录') : anonymousState()
    }

    const snapshot = await this.readStateFile()
    return {
      customer: snapshot?.customer ?? null,
      message: snapshot?.message ?? null,
      status: snapshot?.status ?? 'anonymous',
    }
  }

  async getQrcode(): Promise<CustomerAuthQrcode> {
    const result = await this.getPhpJson('/api/wxlogin/get_qrcode')
    const data = phpQrcodeDataSchema.safeParse(result.data)
    if (!isSuccessStatus(result.status) || !data.success) {
      throw new Error(safeMessage(result.info, '获取微信二维码失败'))
    }

    return {
      qrcode_url: data.data.qrcode_url,
      token: data.data.token,
    }
  }

  async startWechatLogin(): Promise<CustomerAuthQrcode> {
    const qrcode = await this.getQrcode()
    await shell.openExternal(parseExternalLoginUrl(qrcode.qrcode_url))
    return qrcode
  }

  async checkWechatLogin(input: z.infer<typeof checkWechatLoginInputSchema>) {
    const parsed = checkWechatLoginInputSchema.parse(input)
    const finger = await this.getOrCreateFinger()
    return this.loginWithPhpResponse(
      await this.postPhpJson('/api/wxlogin/check_login', {
        finger,
        token: parsed.token,
      }),
      '等待扫码确认',
    )
  }

  async sendSms(input: z.infer<typeof sendSmsInputSchema>): Promise<CustomerAuthSmsResult> {
    const parsed = sendSmsInputSchema.parse(input)
    const countdown = await this.getSmsCountdown()
    if (countdown.remaining_seconds > 0) {
      return {
        message: `请 ${countdown.remaining_seconds} 秒后再发送验证码`,
        ok: false,
        remaining_seconds: countdown.remaining_seconds,
      }
    }

    try {
      const result = await this.postPhpJson('/user/public/send_login_sms', {
        phone: parsed.phone,
      })
      const ok = isSuccessStatus(result.status)
      if (ok) {
        await this.patchStateFile({ last_sms_sent_at: this.now() })
      }
      return {
        message: safeMessage(result.info, ok ? '验证码已发送' : '验证码发送失败'),
        ok,
        remaining_seconds: ok ? SMS_COOLDOWN_MS / 1000 : 0,
      }
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : '验证码发送失败',
        ok: false,
        remaining_seconds: 0,
      }
    }
  }

  async getSmsCountdown() {
    const state = await this.readStateFile()
    const lastSmsSentAt = state?.last_sms_sent_at ?? 0
    if (!lastSmsSentAt) {
      return { remaining_seconds: 0 }
    }

    return {
      remaining_seconds: secondsRemaining(lastSmsSentAt + SMS_COOLDOWN_MS, this.now()),
    }
  }

  async loginByPhone(input: z.infer<typeof phoneLoginInputSchema>) {
    const parsed = phoneLoginInputSchema.parse(input)
    const finger = await this.getOrCreateFinger()
    return this.loginWithPhpResponse(
      await this.postPhpJson('/user/public/login', {
        code: parsed.code,
        finger,
        invite: parsed.invite?.trim() ?? '',
        method: 'phone',
        phone: parsed.phone,
      }),
      '登录失败',
    )
  }

  async verify(): Promise<CustomerAuthState> {
    const result = await this.readCredentials()
    if (!result.credentials) {
      return this.commitState(
        result.invalid ? nologinState('登录状态异常，请重新登录') : anonymousState(),
      )
    }

    try {
      const finger = await this.getOrCreateFinger()
      const response = await this.fetcher(serverUrl(API_PATHS.customerAuthVerify), {
        body: JSON.stringify({
          finger,
          secret: result.credentials.secret,
          uid: result.credentials.uid,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const raw = (await response.json().catch(() => null)) as unknown
      const parsed = nextVerifyResponseSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error('客户授权服务返回格式不正确')
      }

      if (parsed.data.status === 'nologin') {
        await this.clearCredentials()
        return this.commitState(nologinState(parsed.data.error?.message))
      }

      const status = parsed.data.data?.status ?? parsed.data.status
      const customer = parsed.data.data?.customer
      if (parsed.data.ok && status && customer) {
        return this.commitState({
          customer,
          message: null,
          status,
        })
      }

      const message = parsed.data.error?.message ?? '客户授权校验失败'
      if (response.status === 401) {
        await this.clearCredentials()
        return this.commitState(nologinState(message))
      }
      return this.commitState(anonymousState(message))
    } catch (error) {
      return this.commitState(
        anonymousState(error instanceof Error ? error.message : '客户授权服务暂不可用'),
      )
    }
  }

  async logout() {
    await this.clearCredentials()
    return this.commitState(anonymousState())
  }

  private async loginWithPhpResponse(raw: unknown, fallbackMessage: string) {
    const result = phpResponseSchema.safeParse(raw)
    if (!result.success) {
      return anonymousState('旧登录服务返回格式不正确')
    }

    const login = phpLoginDataSchema.safeParse(result.data.data)
    if (!isSuccessStatus(result.data.status) || !login.success) {
      return anonymousState(safeMessage(result.data.info, fallbackMessage))
    }

    await this.saveCredentials(login.data)
    return this.verify()
  }

  private async getPhpJson(path: string) {
    const response = await this.fetcher(`${this.phpAuthBaseUrl}${path}`, {
      method: 'GET',
    })
    return this.parsePhpResponse(response)
  }

  private async postPhpJson(path: string, body: Record<string, unknown>) {
    const response = await this.fetcher(`${this.phpAuthBaseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    return this.parsePhpResponse(response)
  }

  private async parsePhpResponse(response: Response) {
    const raw = (await response.json().catch(() => null)) as unknown
    const parsed = phpResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error('旧登录服务返回格式不正确')
    }
    return parsed.data
  }

  private async saveCredentials(credentials: LoginCredentials) {
    await this.secretStore.setSecrets({
      [CUSTOMER_SECRET_KEY]: credentials.secret,
      [CUSTOMER_UID_KEY]: String(credentials.uid),
    })
  }

  private async readCredentials(): Promise<CredentialsReadResult> {
    const [uid, secret] = await Promise.all([
      this.secretStore.getSecret(CUSTOMER_UID_KEY),
      this.secretStore.getSecret(CUSTOMER_SECRET_KEY),
    ])
    const parsedUid = Number(uid)
    if (!Number.isInteger(parsedUid) || parsedUid <= 0 || !secret) {
      if (uid || secret) {
        await this.clearCredentials()
        return { credentials: null, invalid: true }
      }
      return { credentials: null, invalid: false }
    }
    return { credentials: { secret, uid: parsedUid }, invalid: false }
  }

  private async clearCredentials() {
    await this.secretStore.deleteSecrets([CUSTOMER_UID_KEY, CUSTOMER_SECRET_KEY])
  }

  private async getOrCreateFinger() {
    const state = await this.readStateFile()
    if (state?.finger) {
      return state.finger
    }

    const finger = makeFinger(app.getPath('userData'))
    await this.patchStateFile({ finger })
    return finger
  }

  private async readStateFile() {
    return readJsonFile<CustomerAuthStateFile>(stateFilePath())
  }

  private async patchStateFile(patch: CustomerAuthStateFile) {
    const current = (await this.readStateFile()) ?? {}
    await writeJsonFile(stateFilePath(), { ...current, ...patch })
  }

  private async commitState(state: CustomerAuthState) {
    await this.patchStateFile({
      customer: state.customer,
      message: state.message,
      status: state.status,
      verified_at: new Date(this.now()).toISOString(),
    })
    this.onStateChanged?.(state)
    return state
  }
}

export function registerCustomerAuthIpc(service = new CustomerAuthService()) {
  ipcMain.handle('customerAuth:getState', () => service.getState())
  ipcMain.handle('customerAuth:getQrcode', () => service.getQrcode())
  ipcMain.handle('customerAuth:startWechatLogin', () => service.startWechatLogin())
  ipcMain.handle('customerAuth:checkWechatLogin', (_event, input: unknown) =>
    service.checkWechatLogin(checkWechatLoginInputSchema.parse(input)),
  )
  ipcMain.handle('customerAuth:sendSms', (_event, input: unknown) =>
    service.sendSms(sendSmsInputSchema.parse(input)),
  )
  ipcMain.handle('customerAuth:getSmsCountdown', () => service.getSmsCountdown())
  ipcMain.handle('customerAuth:loginByPhone', (_event, input: unknown) =>
    service.loginByPhone(phoneLoginInputSchema.parse(input)),
  )
  ipcMain.handle('customerAuth:verify', () => service.verify())
  ipcMain.handle('customerAuth:logout', () => service.logout())
}
