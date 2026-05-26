import { type BitBrowserProfile, bitBrowserClient } from '../../../../main/lib/bit-browser-client'

export async function findBitBrowserProfile2_1111(): Promise<BitBrowserProfile> {
  const profiles = await bitBrowserClient.listProfiles()
  const profile = profiles.find((item) => {
    const candidates = [
      item.id,
      item.name,
      item.remark,
      item.seq === undefined ? undefined : String(item.seq),
      item.seq === undefined ? undefined : `${item.seq}-${item.name}`,
    ]
    return candidates.some((candidate) => candidate === '2-1111')
  })
  if (!profile) {
    throw new Error('BitBrowser profile 2-1111 not found')
  }
  return profile
}

export function createState<TState>(base: TState, overrides: Partial<TState> = {}): TState {
  return { ...base, ...overrides }
}

export function textField(value: string) {
  return {
    found: true,
    current_value: value,
    is_disabled: false,
    selector: 'css=.example',
  } as const
}

export function control(text: string) {
  return {
    found: true,
    enabled: true,
    text,
    selector: 'css=.example',
  } as const
}

export function toast(message: string | null) {
  return {
    found: message !== null,
    message,
    selector: message === null ? null : ('css=.example' as const),
  }
}

export function imageSection(
  value: number,
  options: { kind: 'upload' },
): {
  readonly found: true
  readonly image_count: number
  readonly upload_button_found: true
  readonly upload_button_enabled: true
  readonly selector: 'css=.example'
}
export function imageSection(
  value: number,
  options?: { kind?: 'count' },
): {
  readonly found: true
  readonly count: number
  readonly selector: 'css=.example'
}
export function imageSection(value: number, options: { kind?: 'count' | 'upload' } = {}) {
  if (options.kind === 'upload') {
    return {
      found: true,
      image_count: value,
      upload_button_found: true,
      upload_button_enabled: true,
      selector: 'css=.example',
    } as const
  }
  return {
    found: true,
    count: value,
    selector: 'css=.example',
  } as const
}
