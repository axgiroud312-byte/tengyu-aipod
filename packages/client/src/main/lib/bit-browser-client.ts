import { AppErrorClass } from '@tengyu-aipod/shared'
import { getSecret } from './keychain'

export const BIT_BROWSER_DEFAULT_BASE_URL = 'http://127.0.0.1:54345'

export type BitBrowserClientOptions = {
  baseUrl?: string
  getSecret?: (key: string) => Promise<string | null>
  timeoutMs?: number
}

export type BitBrowserProfile = {
  id: string
  name: string
  seq?: number
  status?: number | string
  platform?: string
  url?: string
  remark?: string
}

export type BitBrowserProfileWithStatus = BitBrowserProfile & {
  online: boolean
}

export type BitBrowserCdpEndpoint = {
  http: string
  ws: string
  debugPort?: number
  coreVersion?: string
  driverPath?: string
}

type BitBrowserEnvelope = {
  success?: boolean
  msg?: string
  message?: string
  data?: unknown
}

type RecordValue = Record<string, unknown>

const DEFAULT_TIMEOUT_MS = 10_000

export class BitBrowserClient {
  private readonly baseUrl: string | null
  private readonly getSecret: (key: string) => Promise<string | null>
  private readonly timeoutMs: number

  constructor(options: BitBrowserClientOptions = {}) {
    const configuredBaseUrl = options.baseUrl ?? process.env.TENGYU_BIT_BROWSER_BASE_URL
    this.baseUrl = configuredBaseUrl?.trim() ? normalizeBaseUrl(configuredBaseUrl) : null
    this.getSecret = options.getSecret ?? getSecret
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async listProfiles(): Promise<BitBrowserProfile[]> {
    const payload = await this.post('/browser/list', { page: 0, pageSize: 100 })
    const profiles = collectProfileRecords(payload)
      .map(readProfile)
      .filter((profile): profile is BitBrowserProfile => profile !== null)

    return profiles
  }

  async listOpenProfileIds(): Promise<string[]> {
    const payload = await this.post('/browser/pids/all', {})
    return collectOpenProfileIds(payload)
  }

  async openProfile(profileId: string): Promise<BitBrowserCdpEndpoint> {
    const payload = await this.post('/browser/open', { id: profileId })
    const record = asRecord(payload)
    if (!record) {
      throw protocolError('比特浏览器打开响应格式不正确', { profileId })
    }

    const endpoint = readCdpEndpoint(record)
    if (!endpoint) {
      throw protocolError('比特浏览器打开响应缺少 CDP 端点', { profileId })
    }

    return endpoint
  }

  async getCdpEndpoint(profileId: string): Promise<BitBrowserCdpEndpoint> {
    const payload = await this.post('/browser/ports', { id: profileId })
    const endpoint = readCdpEndpointFromPayload(payload, profileId)
    if (!endpoint) {
      throw protocolError('比特浏览器端口响应缺少 CDP 端点', { profileId })
    }
    return endpoint
  }

  async closeProfile(profileId: string): Promise<void> {
    await this.post('/browser/close', { id: profileId })
  }

  async getProfileStatus(profileId: string): Promise<BitBrowserProfile> {
    const payload = await this.post('/browser/detail', { id: profileId })
    const profile = readProfile(payload)
    if (!profile) {
      throw profileNotFound(profileId, '比特浏览器未返回该 profile 状态')
    }
    return profile
  }

  private async post(path: string, body: Record<string, unknown>) {
    const url = `${await this.resolveBaseUrl()}${path}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw httpErrorFromResponse(path, response.status, text)
      }

      const parsed = parseJsonBody(text, path)
      return unwrapEnvelope(parsed, path, body)
    } catch (error) {
      if (error instanceof AppErrorClass) {
        throw error
      }
      throw browserNotConnected(path, error)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async resolveBaseUrl() {
    if (this.baseUrl) {
      return this.baseUrl
    }
    const savedBaseUrl = await this.getSecret('bit_browser_url').catch(() => null)
    return normalizeBaseUrl(savedBaseUrl?.trim() || BIT_BROWSER_DEFAULT_BASE_URL)
  }
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return `http://${trimmed}`
}

function parseJsonBody(text: string, path: string): unknown {
  if (!text.trim()) {
    throw protocolError('比特浏览器返回空响应', { path })
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw protocolError('比特浏览器返回格式无法解析', { path }, error)
  }
}

function unwrapEnvelope(parsed: unknown, path: string, requestBody: Record<string, unknown>) {
  const envelope = asEnvelope(parsed)
  if (!envelope) {
    return parsed
  }

  if (envelope.success === false) {
    const message = envelope.msg ?? envelope.message ?? '比特浏览器请求失败'
    if (looksLikeProfileNotFound(message)) {
      throw profileNotFound(String(requestBody.id ?? ''), message)
    }
    throw new AppErrorClass('HTTP_4XX', message, false, {
      kind: 'failed',
      provider: 'bit-browser',
      path,
    })
  }

  return envelope.data ?? parsed
}

function asEnvelope(value: unknown): BitBrowserEnvelope | null {
  if (!isRecord(value) || typeof value.success !== 'boolean') {
    return null
  }

  return {
    success: value.success,
    ...(typeof value.msg === 'string' ? { msg: value.msg } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(Object.hasOwn(value, 'data') ? { data: value.data } : {}),
  }
}

function collectProfileRecords(payload: unknown): RecordValue[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord)
  }
  const record = asRecord(payload)
  if (!record) {
    return []
  }

  for (const key of ['list', 'rows', 'browserList']) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.filter(isRecord)
    }
  }

  return [record]
}

function collectOpenProfileIds(payload: unknown): string[] {
  const ids = new Set<string>()
  visitOpenProfilePayload(payload, ids)
  return Array.from(ids)
}

function visitOpenProfilePayload(value: unknown, ids: Set<string>): void {
  if (typeof value === 'string' && value.trim()) {
    ids.add(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visitOpenProfilePayload(item, ids)
    }
    return
  }

  const record = asRecord(value)
  if (!record) {
    return
  }

  const directId = readString(record, ['id', 'browserId', 'profileId'])
  if (directId) {
    ids.add(directId)
  }

  let visitedNested = false
  for (const key of ['ids', 'list', 'rows', 'browserIds', 'browser_ids', 'pids']) {
    if (Object.hasOwn(record, key)) {
      visitedNested = true
      visitOpenProfilePayload(record[key], ids)
    }
  }

  if (!directId && !visitedNested) {
    for (const [key, item] of Object.entries(record)) {
      if (
        (typeof item === 'number' ||
          typeof item === 'string' ||
          typeof item === 'boolean' ||
          isRecord(item)) &&
        key.trim()
      ) {
        ids.add(key)
      }
    }
  }
}

function readProfile(payload: unknown): BitBrowserProfile | null {
  const record = asRecord(payload)
  if (!record) {
    return null
  }

  const id = readString(record, ['id', 'browserId', 'profileId'])
  if (!id) {
    return null
  }

  const name = readString(record, ['name', 'browserName', 'profileName', 'remark']) ?? id
  const seq = readNumber(record, ['seq'])
  const status = readStatus(record)
  const platform = readString(record, ['platform'])
  const url = readString(record, ['url'])
  const remark = readString(record, ['remark'])

  return {
    id,
    name,
    ...(seq !== undefined ? { seq } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(platform !== undefined ? { platform } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(remark !== undefined ? { remark } : {}),
  }
}

function readCdpEndpoint(record: RecordValue): BitBrowserCdpEndpoint | null {
  const http = readString(record, ['http'])
  const ws = readString(record, ['ws'])
  const debugPort = readNumber(record, ['debug_port', 'debugPort', 'debuggingPort'])

  const normalizedHttp = http
    ? normalizeCdpHttpEndpoint(http)
    : debugPort
      ? `http://127.0.0.1:${debugPort}`
      : null
  if (!normalizedHttp || !ws) {
    return null
  }

  const coreVersion = readString(record, ['coreVersion', 'core_version'])
  const driverPath = readString(record, ['driver', 'driverPath'])

  return {
    http: normalizedHttp,
    ws,
    ...(debugPort !== undefined ? { debugPort } : {}),
    ...(coreVersion !== undefined ? { coreVersion } : {}),
    ...(driverPath !== undefined ? { driverPath } : {}),
  }
}

function readCdpEndpointFromPayload(payload: unknown, profileId: string) {
  const record = asRecord(payload)
  if (!record) {
    return null
  }

  const direct = readCdpEndpoint(record)
  if (direct) {
    return direct
  }

  const nestedValue = record[profileId]
  const nested = asRecord(nestedValue)
  if (nested) {
    return readCdpEndpoint(nested)
  }
  const debugPort = readPortValue(nestedValue)
  return debugPort
    ? {
        http: `http://127.0.0.1:${debugPort}`,
        ws: '',
        debugPort,
      }
    : null
}

function normalizeCdpHttpEndpoint(value: string) {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.replace(/\/+$/, '')
  }
  return `http://${value.replace(/\/+$/, '')}`
}

function httpErrorFromResponse(path: string, status: number, body: string) {
  if (status >= 500) {
    return new AppErrorClass('HTTP_5XX', '比特浏览器本地服务暂时不可用', true, {
      kind: 'network',
      provider: 'bit-browser',
      path,
      status,
      body,
    })
  }

  return new AppErrorClass('HTTP_4XX', '比特浏览器本地接口请求失败', false, {
    kind: 'failed',
    provider: 'bit-browser',
    path,
    status,
    body,
  })
}

function browserNotConnected(path: string, cause: unknown) {
  return new AppErrorClass(
    'BROWSER_NOT_CONNECTED',
    '无法连接比特浏览器本地服务',
    true,
    {
      kind: 'network',
      provider: 'bit-browser',
      path,
    },
    cause,
  )
}

function profileNotFound(profileId: string, message: string) {
  return new AppErrorClass('PROFILE_NOT_FOUND', message, false, {
    kind: 'failed',
    provider: 'bit-browser',
    profileId,
  })
}

function protocolError(message: string, details?: Record<string, unknown>, cause?: unknown) {
  return new AppErrorClass(
    'HTTP_5XX',
    message,
    true,
    {
      kind: 'protocol',
      provider: 'bit-browser',
      ...details,
    },
    cause,
  )
}

function looksLikeProfileNotFound(message: string) {
  return /not\s*found|not\s*exist|不存在|未找到|找不到/i.test(message)
}

function readString(record: RecordValue, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return undefined
}

function readNumber(record: RecordValue, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return Number(value)
    }
  }
  return undefined
}

function readPortValue(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value)
  }
  return undefined
}

function readStatus(record: RecordValue) {
  for (const key of ['status', 'state']) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return undefined
}

function asRecord(value: unknown): RecordValue | null {
  return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const bitBrowserClient = new BitBrowserClient()
