export type ActivationServerStatus = 'active' | 'expired' | 'banned'

export interface ActivationServerCustomerSummary {
  name?: string
  has_contact: boolean
}

export interface ActivationServerSnapshot {
  status: ActivationServerStatus
  days_remaining: number
  max_devices: number
  used_devices: number
  device_name: string
  customer: ActivationServerCustomerSummary | null
}

export type ActivationBlockReason = 'unauthorized' | 'clock-rolled-back' | 'offline-too-long'

export type ActivationBadgeTone = 'muted' | 'green' | 'yellow' | 'red'

export interface ActivationBadgeState {
  kind: 'inactive' | 'active' | 'trial' | 'expiring' | 'expired' | 'banned' | 'blocked'
  tone: ActivationBadgeTone
  label: string
  detail: string
  daysRemaining: number | null
  maxDevices: number | null
  usedDevices: number | null
  deviceName: string | null
  customerName: string | null
  customerHasContact: boolean
  codeSuffix: string | null
  lastServerCheck: number | null
  localBlockReason: ActivationBlockReason | null
  localBlockMessage: string | null
  cachedStatus: ActivationServerSnapshot | null
}
