import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ACTIVATION_MAX_OFFLINE_DAYS,
  type ActivationBadgeState,
  type ActivationBlockReason,
  type ActivationServerSnapshot,
} from '@tengyu-aipod/shared'
import { app } from 'electron'

const ACTIVATION_STATE_FILE_NAME = 'activation-state.json'
const DAY_MS = 24 * 60 * 60 * 1000

export interface ActivationStateFile {
  completed_at?: string
  activation?: {
    cached_status_json?: string
    last_server_check?: number
    token_code_suffix?: string
    blocked_reason?: ActivationBlockReason
    blocked_message?: string
  }
}

function activationStatePath() {
  return join(app.getPath('userData'), ACTIVATION_STATE_FILE_NAME)
}

function defaultState(): ActivationStateFile {
  return {}
}

function decodeBase64UrlJson<T>(value: string): T {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as T
}

export function extractActivationCodeSuffix(token: string) {
  const [, body] = token.split('.')
  if (!body) {
    return null
  }

  try {
    const payload = decodeBase64UrlJson<{ code?: string }>(body)
    return payload.code?.slice(-4).toUpperCase() ?? null
  } catch {
    return null
  }
}

async function readStateFile(): Promise<ActivationStateFile> {
  try {
    return JSON.parse(await readFile(activationStatePath(), 'utf8')) as ActivationStateFile
  } catch {
    return defaultState()
  }
}

async function writeStateFile(state: ActivationStateFile) {
  await mkdir(dirname(activationStatePath()), { recursive: true })
  await writeFile(activationStatePath(), JSON.stringify(state, null, 2), 'utf8')
}

export async function readActivationStateFile() {
  return readStateFile()
}

export async function updateActivationStateFile(
  updater: (state: ActivationStateFile) => ActivationStateFile | Promise<ActivationStateFile>,
) {
  const current = await readStateFile()
  const next = await updater(current)
  await writeStateFile(next)
  return next
}

export async function markOnboardingComplete() {
  return updateActivationStateFile((state) => ({
    ...state,
    completed_at: state.completed_at ?? new Date().toISOString(),
  }))
}

export async function saveActivationSnapshot(
  snapshot: ActivationServerSnapshot,
  options: {
    lastServerCheck: number
    tokenCodeSuffix?: string | null
    blockedReason?: ActivationBlockReason | null
    blockedMessage?: string | null
  },
) {
  return updateActivationStateFile((state) => {
    const tokenCodeSuffix = options.tokenCodeSuffix ?? state.activation?.token_code_suffix
    const activation: NonNullable<ActivationStateFile['activation']> = {
      cached_status_json: JSON.stringify(snapshot),
      last_server_check: options.lastServerCheck,
    }

    if (tokenCodeSuffix) {
      activation.token_code_suffix = tokenCodeSuffix
    }
    if (options.blockedReason) {
      activation.blocked_reason = options.blockedReason
    }
    if (options.blockedMessage) {
      activation.blocked_message = options.blockedMessage
    }

    return {
      ...state,
      activation,
    }
  })
}

export async function markActivationUnauthorized(message: string) {
  return updateActivationStateFile((state) => ({
    ...state,
    activation: state.activation
      ? {
          ...state.activation,
          blocked_reason: 'unauthorized',
          blocked_message: message,
        }
      : {
          blocked_reason: 'unauthorized',
          blocked_message: message,
        },
  }))
}

export async function clearActivationBlockReason() {
  return updateActivationStateFile((state) => {
    if (!state.activation) {
      return state
    }

    const {
      blocked_reason: _blockedReason,
      blocked_message: _blockedMessage,
      ...activation
    } = state.activation
    return {
      ...state,
      activation,
    }
  })
}

export function parseActivationSnapshot(value?: string | null) {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Partial<ActivationServerSnapshot>
    if (parsed.status !== 'active' && parsed.status !== 'expired' && parsed.status !== 'banned') {
      return null
    }

    if (
      typeof parsed.days_remaining !== 'number' ||
      typeof parsed.max_devices !== 'number' ||
      typeof parsed.used_devices !== 'number' ||
      typeof parsed.device_name !== 'string'
    ) {
      return null
    }

    if (
      parsed.customer !== null &&
      parsed.customer !== undefined &&
      (typeof parsed.customer !== 'object' || typeof parsed.customer.has_contact !== 'boolean')
    ) {
      return null
    }

    return {
      status: parsed.status,
      days_remaining: parsed.days_remaining,
      max_devices: parsed.max_devices,
      used_devices: parsed.used_devices,
      device_name: parsed.device_name,
      customer: parsed.customer ?? null,
    }
  } catch {
    return null
  }
}

function formatBoundDevices(snapshot: ActivationServerSnapshot) {
  return `绑定 ${snapshot.used_devices}/${snapshot.max_devices}`
}

function formatServerCheckTime(timestamp: number | null) {
  if (!timestamp) {
    return '未同步'
  }

  const date = new Date(timestamp)
  return `${date.toLocaleDateString('zh-CN')} ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function formatOfflineDays(timestamp: number, now: number) {
  return Math.max(1, Math.ceil((now - timestamp) / DAY_MS))
}

function localBlockState(
  activation: ActivationStateFile['activation'],
  now: number,
): {
  reason: ActivationBlockReason | null
  message: string | null
} {
  if (!activation) {
    return { reason: null, message: null }
  }

  if (activation.blocked_reason === 'unauthorized') {
    return {
      reason: 'unauthorized',
      message: activation.blocked_message ?? '激活已失效，请重新激活',
    }
  }

  const lastServerCheck = activation.last_server_check ?? null
  if (lastServerCheck === null) {
    return { reason: null, message: null }
  }

  if (now < lastServerCheck) {
    return {
      reason: 'clock-rolled-back',
      message: '系统时间异常，请校准',
    }
  }

  if (now - lastServerCheck > ACTIVATION_MAX_OFFLINE_DAYS * DAY_MS) {
    return {
      reason: 'offline-too-long',
      message: `已 ${formatOfflineDays(lastServerCheck, now)} 天未联网，请重新连接`,
    }
  }

  return { reason: null, message: null }
}

export function buildActivationBadgeState(
  state: ActivationStateFile,
  options: {
    now?: number
    tokenCodeSuffix?: string | null
  } = {},
): ActivationBadgeState {
  const now = options.now ?? Date.now()
  const activation = state.activation
  const cachedStatus = parseActivationSnapshot(activation?.cached_status_json)
  const codeSuffix = activation?.token_code_suffix ?? options.tokenCodeSuffix ?? null
  const localBlock = localBlockState(activation, now)

  if (!activation || !cachedStatus) {
    return {
      kind: 'inactive',
      tone: 'muted',
      label: '未激活',
      detail: '请先完成激活',
      daysRemaining: null,
      maxDevices: null,
      usedDevices: null,
      deviceName: null,
      customerName: null,
      customerHasContact: false,
      codeSuffix,
      lastServerCheck: activation?.last_server_check ?? null,
      localBlockReason: localBlock.reason,
      localBlockMessage: localBlock.message,
      cachedStatus,
    }
  }

  if (localBlock.reason) {
    const detail = localBlock.message ?? '请重新激活'
    return {
      kind: 'blocked',
      tone: 'red',
      label:
        localBlock.reason === 'unauthorized'
          ? '激活已失效'
          : localBlock.reason === 'clock-rolled-back'
            ? '系统时间异常'
            : '已离线过久',
      detail,
      daysRemaining: cachedStatus.days_remaining,
      maxDevices: cachedStatus.max_devices,
      usedDevices: cachedStatus.used_devices,
      deviceName: cachedStatus.device_name,
      customerName: cachedStatus.customer?.name ?? null,
      customerHasContact: cachedStatus.customer?.has_contact ?? false,
      codeSuffix,
      lastServerCheck: activation.last_server_check ?? null,
      localBlockReason: localBlock.reason,
      localBlockMessage: localBlock.message,
      cachedStatus,
    }
  }

  const daysRemaining = Math.max(0, cachedStatus.days_remaining)
  const baseDetail = `${cachedStatus.device_name} · ${formatBoundDevices(cachedStatus)}`

  if (cachedStatus.status === 'banned') {
    return {
      kind: 'banned',
      tone: 'red',
      label: '已封号',
      detail: cachedStatus.customer?.name
        ? `客户 ${cachedStatus.customer.name} · ${baseDetail}`
        : baseDetail,
      daysRemaining,
      maxDevices: cachedStatus.max_devices,
      usedDevices: cachedStatus.used_devices,
      deviceName: cachedStatus.device_name,
      customerName: cachedStatus.customer?.name ?? null,
      customerHasContact: cachedStatus.customer?.has_contact ?? false,
      codeSuffix,
      lastServerCheck: activation.last_server_check ?? null,
      localBlockReason: null,
      localBlockMessage: null,
      cachedStatus,
    }
  }

  if (cachedStatus.status === 'expired' || daysRemaining <= 0) {
    return {
      kind: 'expired',
      tone: 'red',
      label: '已过期',
      detail: baseDetail,
      daysRemaining: 0,
      maxDevices: cachedStatus.max_devices,
      usedDevices: cachedStatus.used_devices,
      deviceName: cachedStatus.device_name,
      customerName: cachedStatus.customer?.name ?? null,
      customerHasContact: cachedStatus.customer?.has_contact ?? false,
      codeSuffix,
      lastServerCheck: activation.last_server_check ?? null,
      localBlockReason: null,
      localBlockMessage: null,
      cachedStatus,
    }
  }

  if (!cachedStatus.customer) {
    return {
      kind: 'trial',
      tone: 'green',
      label: `试用·${daysRemaining} 天剩余`,
      detail: baseDetail,
      daysRemaining,
      maxDevices: cachedStatus.max_devices,
      usedDevices: cachedStatus.used_devices,
      deviceName: cachedStatus.device_name,
      customerName: null,
      customerHasContact: false,
      codeSuffix,
      lastServerCheck: activation.last_server_check ?? null,
      localBlockReason: null,
      localBlockMessage: null,
      cachedStatus,
    }
  }

  if (daysRemaining < 7) {
    return {
      kind: 'expiring',
      tone: 'yellow',
      label: `即将过期·${daysRemaining} 天内`,
      detail: baseDetail,
      daysRemaining,
      maxDevices: cachedStatus.max_devices,
      usedDevices: cachedStatus.used_devices,
      deviceName: cachedStatus.device_name,
      customerName: cachedStatus.customer.name ?? null,
      customerHasContact: cachedStatus.customer.has_contact,
      codeSuffix,
      lastServerCheck: activation.last_server_check ?? null,
      localBlockReason: null,
      localBlockMessage: null,
      cachedStatus,
    }
  }

  return {
    kind: 'active',
    tone: 'green',
    label: `激活·剩余 ${daysRemaining} 天`,
    detail: baseDetail,
    daysRemaining,
    maxDevices: cachedStatus.max_devices,
    usedDevices: cachedStatus.used_devices,
    deviceName: cachedStatus.device_name,
    customerName: cachedStatus.customer.name ?? null,
    customerHasContact: cachedStatus.customer.has_contact,
    codeSuffix,
    lastServerCheck: activation.last_server_check ?? null,
    localBlockReason: null,
    localBlockMessage: null,
    cachedStatus,
  }
}
