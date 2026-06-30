export const ErrorCode = {
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  HTTP_429: 'HTTP_429',
  HTTP_5XX: 'HTTP_5XX',
  HTTP_4XX: 'HTTP_4XX',
  INVALID_INPUT: 'INVALID_INPUT',
  CHENYU_INSTANCE_DOWN: 'CHENYU_INSTANCE_DOWN',
  CHENYU_BALANCE_INSUFFICIENT: 'CHENYU_BALANCE_INSUFFICIENT',
  GRSAI_VIOLATION: 'GRSAI_VIOLATION',
  GRSAI_FAILED: 'GRSAI_FAILED',
  BAILIAN_QUOTA_EXCEEDED: 'BAILIAN_QUOTA_EXCEEDED',
  PROMPT_PARSE_FAILED: 'PROMPT_PARSE_FAILED',
  COMFYUI_IMG2IMG_PROMPT_FAILED: 'COMFYUI_IMG2IMG_PROMPT_FAILED',
  BROWSER_NOT_CONNECTED: 'BROWSER_NOT_CONNECTED',
  PROFILE_LOCKED: 'PROFILE_LOCKED',
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
  PLATFORM_RULE_NOT_FOUND: 'PLATFORM_RULE_NOT_FOUND',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  SELECTOR_NOT_FOUND: 'SELECTOR_NOT_FOUND',
  PAGE_NOT_READY: 'PAGE_NOT_READY',
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  PS_NOT_INSTALLED: 'PS_NOT_INSTALLED',
  PS_NOT_RUNNING: 'PS_NOT_RUNNING',
  PS_COM_FAILED: 'PS_COM_FAILED',
  JSX_EXEC_FAILED: 'JSX_EXEC_FAILED',
  XLSX_LOCKED: 'XLSX_LOCKED',
  OUTPUT_VERIFY_FAILED: 'OUTPUT_VERIFY_FAILED',
  PS_UNSUPPORTED_PLATFORM: 'PS_UNSUPPORTED_PLATFORM',
  TEMPLATE_SCAN_FAILED: 'TEMPLATE_SCAN_FAILED',
  SKU_DUPLICATE: 'SKU_DUPLICATE',
  TEMPLATE_NESTED_SO_UNSUPPORTED: 'TEMPLATE_NESTED_SO_UNSUPPORTED',
} as const

export interface AppError {
  code: keyof typeof ErrorCode
  message: string
  details?: Record<string, unknown>
  retryable: boolean
  cause?: unknown
}

export class AppErrorClass extends Error implements AppError {
  public readonly details?: Record<string, unknown>
  public override readonly cause?: unknown

  constructor(
    public code: keyof typeof ErrorCode,
    override message: string,
    public retryable = false,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
    if (details !== undefined) {
      this.details = details
    }
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}
