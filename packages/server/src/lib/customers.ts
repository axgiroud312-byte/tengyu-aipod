import { computeRemainingDays, computeStatus } from '@/lib/codes'
import type { ActivationCode, Customer, DeviceActivation } from '@prisma/client'

export type CustomerWithRelations = Customer & {
  codes: Array<ActivationCode & { devices: DeviceActivation[] }>
}

export type CustomerCodeItem = {
  code: string
  days_total: number
  max_devices: number
  used_devices: number
  remaining_days: number | null
  batch_id: string | null
  is_active: boolean
  activated_at: string | null
  expires_at: string | null
  created_at: string
  status: 'activated' | 'not_activated' | 'banned' | 'expired'
  devices: Array<{
    id: string
    device_fingerprint: string
    device_name: string | null
    activated_at: string
    last_active_at: string
  }>
}

export type CustomerDeviceItem = {
  id: string
  code: string
  code_id: string
  device_fingerprint: string
  device_name: string | null
  activated_at: string
  last_active_at: string
}

export type CustomerListItem = {
  id: string
  name: string
  phone: string
  email: string | null
  wechat: string | null
  notes: string | null
  is_active: boolean
  status: 'active' | 'banned'
  code_count: number
  max_remaining_days: number | null
  total_devices: number
  total_device_slots: number
  recent_active_at: string | null
  created_at: string
}

export type CustomerDetailItem = CustomerListItem & {
  codes: CustomerCodeItem[]
  devices: CustomerDeviceItem[]
}

function toIso(value: Date | null | undefined) {
  return value?.toISOString() ?? null
}

function serializeDevice(code: ActivationCode, device: DeviceActivation): CustomerDeviceItem {
  return {
    id: device.id,
    code: code.code,
    code_id: device.code_id,
    device_fingerprint: device.device_fingerprint,
    device_name: device.device_name,
    activated_at: device.activated_at.toISOString(),
    last_active_at: device.last_active_at.toISOString(),
  }
}

export function serializeCustomerCode(
  code: ActivationCode & { devices: DeviceActivation[] },
): CustomerCodeItem {
  const remaining_days = computeRemainingDays(code.expires_at)

  return {
    code: code.code,
    days_total: code.days_total,
    max_devices: code.max_devices,
    used_devices: code.devices.length,
    remaining_days,
    batch_id: code.batch_id,
    is_active: code.is_active,
    activated_at: toIso(code.activated_at),
    expires_at: toIso(code.expires_at),
    created_at: code.created_at.toISOString(),
    status: computeStatus(code),
    devices: code.devices.map((device) => ({
      id: device.id,
      device_fingerprint: device.device_fingerprint,
      device_name: device.device_name,
      activated_at: device.activated_at.toISOString(),
      last_active_at: device.last_active_at.toISOString(),
    })),
  }
}

export function buildCustomerSummary(customer: CustomerWithRelations): CustomerListItem {
  const devices = customer.codes.flatMap((code) =>
    code.devices.map((device) => serializeDevice(code, device)),
  )
  const activeRemainingDays = customer.codes
    .filter((code) => code.is_active)
    .map((code) => computeRemainingDays(code.expires_at))
    .filter((value): value is number => value !== null && value >= 0)

  const recentActiveAt = devices.reduce<string | null>((latest, device) => {
    if (!latest) {
      return device.last_active_at
    }
    return new Date(device.last_active_at).getTime() > new Date(latest).getTime()
      ? device.last_active_at
      : latest
  }, null)

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    wechat: customer.wechat,
    notes: customer.notes,
    is_active: customer.is_active,
    status: customer.is_active ? 'active' : 'banned',
    code_count: customer.codes.length,
    max_remaining_days: activeRemainingDays.length ? Math.max(...activeRemainingDays) : null,
    total_devices: devices.length,
    total_device_slots: customer.codes.reduce((sum, code) => sum + code.max_devices, 0),
    recent_active_at: recentActiveAt,
    created_at: customer.created_at.toISOString(),
  }
}

export function serializeCustomer(customer: CustomerWithRelations): CustomerDetailItem {
  const summary = buildCustomerSummary(customer)
  const codes = customer.codes.map(serializeCustomerCode)
  const devices = customer.codes
    .flatMap((code) => code.devices.map((device) => serializeDevice(code, device)))
    .sort((a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime())

  return {
    ...summary,
    codes,
    devices,
  }
}
