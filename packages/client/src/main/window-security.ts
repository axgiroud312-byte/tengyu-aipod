import type { HeadersReceivedResponse, OnHeadersReceivedListenerDetails } from 'electron'

export function rendererContentSecurityPolicy(isPackaged: boolean) {
  const scriptSources = isPackaged ? "'self'" : "'self' 'unsafe-inline'"
  const imageSources = isPackaged
    ? "'self' data: blob: https: tengyu-local-image:"
    : "'self' data: blob: http://localhost:* http://127.0.0.1:* https: tengyu-local-image:"
  const connectSources = isPackaged ? "'self'" : "'self' ws://localhost:* ws://127.0.0.1:*"

  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources}`,
    "media-src 'self' blob: file:",
    "font-src 'self'",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export function rendererContentSecurityPolicyResponse(
  details: Pick<OnHeadersReceivedListenerDetails, 'resourceType' | 'responseHeaders'>,
  isPackaged: boolean,
): HeadersReceivedResponse {
  if (details.resourceType !== 'mainFrame') {
    return details.responseHeaders ? { responseHeaders: details.responseHeaders } : {}
  }

  const responseHeaders = Object.fromEntries(
    Object.entries(details.responseHeaders ?? {}).filter(
      ([name]) => name.toLowerCase() !== 'content-security-policy',
    ),
  )
  responseHeaders['Content-Security-Policy'] = [rendererContentSecurityPolicy(isPackaged)]
  return { responseHeaders }
}
