import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

export const LOCAL_IMAGE_PROTOCOL = 'tengyu-local-image'

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export function registerLocalImageProtocolScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_IMAGE_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
      },
    },
  ])
}

export function registerLocalImageProtocolHandler() {
  protocol.handle(LOCAL_IMAGE_PROTOCOL, async (request) => {
    const filePath = parseLocalImageRequest(request.url)
    if (!filePath) {
      return new Response(null, { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function parseLocalImageRequest(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${LOCAL_IMAGE_PROTOCOL}:` || parsed.hostname !== 'image') {
      return null
    }

    const encodedPath = parsed.pathname.replace(/^\//, '')
    const filePath = decodeURIComponent(encodedPath)
    if (!filePath || filePath.includes('\0')) {
      return null
    }

    if (!ALLOWED_IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      return null
    }

    return filePath
  } catch {
    return null
  }
}
