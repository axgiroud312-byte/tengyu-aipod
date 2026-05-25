export interface PhotoshopStatus {
  installed: boolean
  running: boolean
  com_connected: boolean
  version: string | null
  last_check_at: number
  error_code?: 'PS_NOT_INSTALLED' | 'PS_NOT_RUNNING' | 'PS_COM_FAILED'
  error_message?: string
}
