import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const clientRoot = resolve(scriptDir, '..')
const nodeModulesDir = join(clientRoot, 'node_modules')
const require = createRequire(import.meta.url)

const ELECTRON_ABI_BY_MAJOR = new Map([[42, '146']])

function findNativeModules(root) {
  const results = []

  function visit(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        continue
      }
      if (entry.isDirectory()) {
        visit(entryPath)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.node')) {
        results.push(entryPath)
      }
    }
  }

  try {
    if (statSync(root).isDirectory()) {
      visit(root)
    }
  } catch {
    return []
  }

  return results
}

function expectedElectronAbi() {
  const result = spawnSync('electron', ['--abi'], {
    cwd: clientRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const abi = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  if (result.status === 0 && /^\d+$/.test(abi)) {
    return abi
  }

  const electronPackagePath = require.resolve('electron/package.json', { paths: [clientRoot] })
  const electronPackage = JSON.parse(readFileSync(electronPackagePath, 'utf8'))
  const major = Number(String(electronPackage.version).split('.')[0])
  const mapped = ELECTRON_ABI_BY_MAJOR.get(major)
  if (!mapped) {
    throw new Error(`Unsupported Electron major ${major}; update ELECTRON_ABI_BY_MAJOR.`)
  }
  return mapped
}

function detectNativeAbi(filePath) {
  const content = readFileSync(filePath)
  const text = content.toString('latin1')

  if (text.includes('napi_register_module_v') || text.includes('node_api_module_get_api_version')) {
    return { kind: 'napi' }
  }

  const match =
    text.match(/NODE_MODULE_VERSION\D{0,32}(\d{2,3})/) ??
    text.match(/node-v(\d{2,3})/) ??
    text.match(/modules?[-_](\d{2,3})/i)

  if (match?.[1]) {
    return { kind: 'abi', abi: match[1] }
  }

  return { kind: 'unknown' }
}

const nativeModules = findNativeModules(nodeModulesDir)
if (nativeModules.length === 0) {
  console.log('No native modules detected')
  process.exit(0)
}

const expectedAbi = expectedElectronAbi()
const failures = []

for (const filePath of nativeModules) {
  const detected = detectNativeAbi(filePath)
  const displayPath = relative(clientRoot, filePath)

  if (detected.kind === 'napi') {
    continue
  }
  if (detected.kind === 'abi' && detected.abi === expectedAbi) {
    continue
  }

  failures.push({ path: displayPath, detected })
}

if (failures.length > 0) {
  console.error(`Native ABI mismatch. Electron expects NODE_MODULE_VERSION ${expectedAbi}.`)
  for (const failure of failures) {
    const detected = failure.detected.kind === 'abi' ? failure.detected.abi : 'unknown native ABI'
    console.error(`- ${failure.path}: ${detected}`)
  }
  console.error('Fix: remove the native dependency or rebuild it for Electron before running dev.')
  process.exit(1)
}

console.log('✓ Native ABI OK')
