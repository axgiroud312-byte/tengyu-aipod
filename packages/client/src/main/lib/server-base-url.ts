import { app } from 'electron'

const DEV_SERVER_BASE_URL = 'http://localhost:3000'

export function resolveServerBaseUrl(input: {
  configuredUrl?: string | undefined
  isPackaged?: boolean
}) {
  const configuredUrl = input.configuredUrl?.trim()
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '')
  }

  if (input.isPackaged) {
    throw new Error('TENGYU_SERVER_URL is required for packaged app')
  }

  return DEV_SERVER_BASE_URL
}

export function getServerBaseUrl() {
  return resolveServerBaseUrl({
    configuredUrl: process.env.TENGYU_SERVER_URL,
    isPackaged: Boolean(app.isPackaged),
  })
}

export function serverUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${getServerBaseUrl()}${normalizedPath}`
}
