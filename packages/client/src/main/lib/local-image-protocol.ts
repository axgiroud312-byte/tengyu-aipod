import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { assertPathInsideWorkbench } from './workbench-path-guard'

export const LOCAL_IMAGE_PROTOCOL = 'tengyu-local-image'

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

type LocalImageProtocolDependencies = {
  readConfig?: () => Promise<{ workbench_root?: string | undefined }>
}

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
    const filePath = await resolveLocalImageRequestPath(request.url)
    if (!filePath) {
      return new Response(null, { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

export async function resolveLocalImageRequestPath(
  url: string,
  dependencies: LocalImageProtocolDependencies = {},
) {
  const filePath = parseLocalImageRequest(url)
  if (!filePath) {
    return null
  }

  try {
    const readConfig = dependencies.readConfig ?? defaultReadConfig
    const config = await readConfig()
    if (!config.workbench_root) {
      return null
    }
    await assertPathInsideWorkbench(config.workbench_root, filePath, {
      domain: 'local-image',
      label: '本地图片路径',
    })
    return filePath
  } catch {
    return null
  }
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

async function defaultReadConfig() {
  return (await import('../onboarding')).readAppConfig()
}
