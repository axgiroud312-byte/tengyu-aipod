import { spawnSync } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import asar from '@electron/asar'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const clientRoot = resolve(scriptDir, '..')
const repoRoot = resolve(clientRoot, '..', '..')
const packageJson = JSON.parse(await readFile(join(clientRoot, 'package.json'), 'utf8'))
const defaultAsarPaths =
  process.platform === 'darwin'
    ? [
        join(
          clientRoot,
          'release',
          packageJson.version,
          'mac',
          '腾域 aipod.app',
          'Contents',
          'Resources',
          'app.asar',
        ),
        join(
          clientRoot,
          'release',
          packageJson.version,
          'mac-arm64',
          '腾域 aipod.app',
          'Contents',
          'Resources',
          'app.asar',
        ),
      ]
    : [join(clientRoot, 'release', packageJson.version, 'win-unpacked', 'resources', 'app.asar')]

const asarPath = process.argv[2]
  ? resolve(process.argv[2])
  : await firstExistingPath(defaultAsarPaths)
const entries = new Set(asar.listPackage(asarPath).map((entry) => entry.replaceAll('\\', '/')))

const requiredModulePaths = [
  'node_modules/exceljs',
  'node_modules/archiver',
  'node_modules/glob',
  'node_modules/fs.realpath',
  'node_modules/inflight',
  'node_modules/minimatch',
  'node_modules/once',
  'node_modules/path-is-absolute',
  'node_modules/wrappy',
  'node_modules/readdir-glob',
  'node_modules/readdir-glob/node_modules/minimatch',
  'node_modules/readable-stream',
  'node_modules/util-deprecate',
  'node_modules/string_decoder',
  'node_modules/inherits',
  'node_modules/safe-buffer',
  'node_modules/core-util-is',
  'node_modules/isarray',
  'node_modules/process-nextick-args',
  'node_modules/brace-expansion',
  'node_modules/balanced-match',
]

const missing = requiredModulePaths.filter((modulePath) => !entries.has(`/${modulePath}`))

if (missing.length > 0) {
  throw new Error(
    `Packaged app.asar is missing runtime dependencies: ${missing.join(', ')}. Checked: ${asarPath}`,
  )
}

console.log(
  `Packaged runtime dependency contract passed (${requiredModulePaths.length} paths checked).`,
)

const electronExecutable =
  process.platform === 'win32'
    ? await firstExistingPath([
        join(clientRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
        join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
      ])
    : await firstExistingPath([
        join(
          clientRoot,
          'node_modules',
          'electron',
          'dist',
          'Electron.app',
          'Contents',
          'MacOS',
          'Electron',
        ),
        join(
          repoRoot,
          'node_modules',
          'electron',
          'dist',
          'Electron.app',
          'Contents',
          'MacOS',
          'Electron',
        ),
      ])

const isolatedRoot = await mkdtemp(join(tmpdir(), 'tengyu-packaged-runtime-'))
const isolatedResources = join(isolatedRoot, 'resources')
const isolatedAsar = join(isolatedResources, 'app.asar')
const asarUnpackedPath = `${asarPath}.unpacked`
const isolatedAsarUnpacked = `${isolatedAsar}.unpacked`

try {
  await mkdir(isolatedResources, { recursive: true })
  await cp(asarPath, isolatedAsar)
  if (await pathExists(asarUnpackedPath)) {
    await cp(asarUnpackedPath, isolatedAsarUnpacked, { recursive: true })
  }

  const requireTargets = [
    ['exceljs', join(isolatedAsar, 'node_modules', 'exceljs', 'lib', 'exceljs.nodejs.js')],
    ['archiver', join(isolatedAsar, 'node_modules', 'archiver', 'index.js')],
    ['readdir-glob', join(isolatedAsar, 'node_modules', 'readdir-glob', 'index.js')],
  ]

  for (const [label, modulePath] of requireTargets) {
    const result = spawnSync(
      electronExecutable,
      ['-e', "require(process.argv[1]); console.log('packaged require ok')", modulePath],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
        encoding: 'utf8',
      },
    )

    if (result.status !== 0) {
      throw new Error(
        `Packaged runtime require failed for ${label}.\nerror:\n${result.error?.message ?? ''}\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`,
      )
    }
  }

  console.log(
    `Packaged isolated require contract passed (${requireTargets.length} modules checked).`,
  )
} finally {
  await rm(isolatedRoot, { recursive: true, force: true })
}

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next known package-manager layout.
    }
  }

  throw new Error(`Cannot find Electron executable. Checked: ${paths.join(', ')}`)
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
