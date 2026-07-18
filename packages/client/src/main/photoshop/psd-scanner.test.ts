import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { PsdTemplate } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TempFileManager } from '../lib/temp-file-manager'
import { PsdScanner, buildPsdTemplateFromScanResult, deriveClipAreas } from './psd-scanner'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tengyu-psd-scanner-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function createMemoryCache() {
  const templates = new Map<string, PsdTemplate>()
  return {
    findByHash: async (fileHash: string) => templates.get(fileHash) ?? null,
    save: async (template: PsdTemplate) => {
      templates.set(template.file_hash, template)
    },
    list: async () => [...templates.values()].sort((a, b) => b.scanned_at - a.scanned_at),
  }
}

function createScanner(
  options: {
    runJsxFile?: (filePath: string) => Promise<void>
    platform?: NodeJS.Platform
    now?: () => number
    cache?: ReturnType<typeof createMemoryCache>
  } = {},
) {
  return new PsdScanner({
    platform: options.platform ?? 'win32',
    comAdapter: {
      runJsxFile: options.runJsxFile ?? (async () => undefined),
    },
    tempFiles: new TempFileManager({ rootDir: join(tempDir, 'tmp') }),
    cache: options.cache ?? createMemoryCache(),
    now: options.now ?? (() => 1234),
  })
}

async function writeFakePsd(name = 'template.psd') {
  const psdPath = join(tempDir, name)
  await writeFile(psdPath, 'fake-psd-content', 'utf8')
  return psdPath
}

describe('PsdScanner', () => {
  it('derives a full-document clip area for none mode', () => {
    expect(
      deriveClipAreas(
        {
          doc_size: { w: 1000, h: 800 },
          guides: { horizontal: [400], vertical: [500] },
          smart_objects: [],
          layers: [],
        },
        'none',
      ),
    ).toEqual([{ x: 0, y: 0, w: 1000, h: 800, is_full: true }])
  })

  it('derives a guide grid for guides mode', () => {
    expect(
      deriveClipAreas(
        {
          doc_size: { w: 1000, h: 800 },
          guides: { horizontal: [400], vertical: [500] },
          smart_objects: [],
          layers: [],
        },
        'guides',
      ),
    ).toEqual([
      { x: 0, y: 0, w: 500, h: 400, is_full: false },
      { x: 500, y: 0, w: 500, h: 400, is_full: false },
      { x: 0, y: 400, w: 500, h: 400, is_full: false },
      { x: 500, y: 400, w: 500, h: 400, is_full: false },
    ])
  })

  it('falls back to smart object ancestor bounds for auto mode without guides', () => {
    expect(
      deriveClipAreas(
        {
          doc_size: { w: 1000, h: 800 },
          guides: { horizontal: [], vertical: [] },
          smart_objects: [
            {
              name: 'print',
              path: 'SKU A/print',
              sort_order: 0,
              is_top_level: false,
              bounds: [120, 140, 420, 540],
              shared_indicator: 'print-a',
            },
          ],
          layers: [
            {
              name: 'SKU A',
              path: 'SKU A',
              typename: 'LayerSet',
              is_group: true,
              is_smart_object: false,
              is_text: false,
              bounds: [100, 120, 500, 620],
            },
          ],
        },
        'auto',
      ),
    ).toEqual([{ x: 100, y: 120, w: 400, h: 500, is_full: false }])
  })

  it('falls back to full-document clipping when auto has no guides or ancestors', () => {
    expect(
      deriveClipAreas(
        {
          doc_size: { w: 1000, h: 800 },
          guides: { horizontal: [], vertical: [] },
          smart_objects: [
            {
              name: 'print',
              path: 'print',
              sort_order: 0,
              is_top_level: true,
              bounds: [120, 140, 420, 540],
              shared_indicator: 'print-a',
            },
          ],
          layers: [],
        },
        'auto',
      ),
    ).toEqual([{ x: 0, y: 0, w: 1000, h: 800, is_full: true }])
  })

  it('matches guide regions and removes White hoodie unnamed nested edge fragments', () => {
    const template = buildPsdTemplateFromScanResult(
      {
        ok: true,
        doc_size: { w: 322, h: 3340 },
        smart_objects: [],
        guides: {
          horizontal: [428.4375, 856.90625, 1285.34375, 1713.8125, 2142.25, 2570.71875, 2999.15625],
          vertical: [],
        },
        clip_areas: [],
        native_slices: [
          { name: '', kind: 'user', bounds: [0, 3319, 21, 3341] },
          { name: '', kind: 'user', bounds: [0, 3340, 322, 3341] },
          { name: '', kind: 'user', bounds: [0, 3319, 322, 3341] },
          { name: '', kind: 'user', bounds: [0, 2998, 322, 3322] },
          { name: '', kind: 'user', bounds: [0, 2569, 322, 3001] },
          { name: '', kind: 'user', bounds: [0, 2141, 322, 2572] },
          { name: '', kind: 'user', bounds: [0, 1712, 322, 2144] },
          { name: '', kind: 'user', bounds: [0, 1284, 322, 1715] },
          { name: '', kind: 'user', bounds: [0, 855, 322, 1287] },
          { name: '', kind: 'user', bounds: [0, 427, 322, 858] },
          { name: '', kind: 'user', bounds: [0, 0, 322, 430] },
        ],
        layers: [],
        text_layers: [],
      },
      { psdPath: 'C:\\templates\\White hoodie.psd', fileHash: 'white', scannedAt: 123 },
    )

    expect(template.native_slices.map((slice) => slice.bounds)).toEqual([
      [0, 0, 322, 430],
      [0, 427, 322, 858],
      [0, 855, 322, 1287],
      [0, 1284, 322, 1715],
      [0, 1712, 322, 2144],
      [0, 2141, 322, 2572],
      [0, 2569, 322, 3001],
      [0, 2998, 322, 3322],
    ])
  })

  it('preserves legitimate unnamed edge slices outside the fragment pattern', () => {
    const matchedSlices = [
      { name: '', kind: 'user' as const, bounds: [0, 0, 100, 100] },
      { name: '', kind: 'user' as const, bounds: [0, 100, 100, 200] },
    ]
    const unmatchedSets = [
      [{ name: '', kind: 'user' as const, bounds: [0, 195, 5, 200] }],
      [
        { name: '', kind: 'user' as const, bounds: [0, 195, 5, 200] },
        { name: '', kind: 'user' as const, bounds: [95, 195, 100, 200] },
      ],
    ]

    for (const [index, unmatchedSlices] of unmatchedSets.entries()) {
      const template = buildPsdTemplateFromScanResult(
        {
          ok: true,
          doc_size: { w: 100, h: 200 },
          smart_objects: [],
          guides: { horizontal: [100], vertical: [] },
          clip_areas: [],
          native_slices: [...matchedSlices, ...unmatchedSlices],
          layers: [],
          text_layers: [],
        },
        { psdPath: 'C:\\templates\\edge.psd', fileHash: `edge-${index}`, scannedAt: 123 },
      )

      expect(template.native_slices).toHaveLength(matchedSlices.length + unmatchedSlices.length)
    }
  })

  it('preserves native slices when unmatched slices fail the edge-fragment guard', () => {
    const matchedSlices = [
      { name: 'slice-1', kind: 'user' as const, bounds: [0, 0, 100, 100] },
      { name: 'slice-2', kind: 'user' as const, bounds: [0, 100, 100, 200] },
    ]
    const unmatchedSlices = [
      { name: 'interior', kind: 'user' as const, bounds: [10, 10, 15, 15] },
      { name: 'large-edge', kind: 'user' as const, bounds: [0, 180, 100, 200] },
    ]

    for (const unmatchedSlice of unmatchedSlices) {
      const template = buildPsdTemplateFromScanResult(
        {
          ok: true,
          doc_size: { w: 100, h: 200 },
          smart_objects: [],
          guides: { horizontal: [100], vertical: [] },
          clip_areas: [],
          native_slices: [...matchedSlices, unmatchedSlice],
          layers: [],
          text_layers: [],
        },
        { psdPath: 'C:\\templates\\guard.psd', fileHash: unmatchedSlice.name, scannedAt: 123 },
      )

      expect(template.native_slices.map((slice) => slice.name)).toEqual([
        'slice-1',
        'slice-2',
        unmatchedSlice.name,
      ])
    }
  })

  it('scans a PSD through JSX and stores the template cache', async () => {
    const psdPath = await writeFakePsd()
    const scanner = createScanner({
      runJsxFile: async (jsxPath) => {
        const jsx = await readFile(jsxPath, 'utf8')
        expect(jsx).toContain(JSON.stringify(psdPath))
        expect(jsx).toContain("reference.putProperty(stringIDToTypeID('property'), slicesKey)")
        expect(jsx).toContain('executeActionGet(reference)')
        expect(jsx).toContain("return 'unknown';")
        expect(jsx).toContain(": 'unknown';")
        expect(jsx).toContain("slice.hasKey(nameKey) ? slice.getString(nameKey) : ''")
        expect(jsx).not.toContain('doc.slices')
        await writeFile(
          join(jsxPath, '..', 'scan-result.json'),
          JSON.stringify({
            ok: true,
            doc_size: { w: 1000, h: 800 },
            smart_objects: [
              {
                name: 'print',
                path: 'print',
                is_top_level: true,
                bounds: [100, 120, 500, 620],
              },
              {
                name: 'print copy 1',
                path: 'group/print copy 1',
                is_top_level: false,
                bounds: [100, 120, 500, 620],
              },
            ],
            guides: { horizontal: [400], vertical: [500] },
            clip_areas: [{ x: 0, y: 0, w: 500, h: 400, is_full: false }],
            native_slices: [
              { name: 'Front', kind: 'user', bounds: [0, 0, 500, 400] },
              { name: 'Back', kind: 'layer', bounds: [500, 0, 1000, 400] },
              { name: 'Auto 1', kind: 'auto', bounds: [0, 400, 500, 800] },
              { name: 'Empty', kind: 'user', bounds: [0, 0, 0, 0] },
            ],
            layers: [],
            text_layers: [],
          }),
          'utf8',
        )
      },
    })

    const template = await scanner.scanPsd(psdPath)

    expect(template.file_path).toBe(resolve(psdPath))
    expect(template.doc_size).toEqual({ w: 1000, h: 800 })
    expect(template.smart_objects).toHaveLength(2)
    expect(template.smart_objects[0]?.bounds).toEqual([100, 120, 500, 620])
    expect(template.mode).toBe('shared')
    expect(template.representative_so_count).toBe(1)
    expect(template.native_slices).toEqual([
      { name: 'Front', kind: 'user', bounds: [0, 0, 500, 400] },
      { name: 'Back', kind: 'layer', bounds: [500, 0, 1000, 400] },
    ])
    await expect(scanner.listCachedTemplates()).resolves.toEqual([template])
  })

  it('returns cached templates by PSD hash without rerunning JSX', async () => {
    const psdPath = await writeFakePsd()
    let runCount = 0
    const scanner = createScanner({
      runJsxFile: async (jsxPath) => {
        runCount += 1
        await writeFile(
          join(jsxPath, '..', 'scan-result.json'),
          JSON.stringify({
            ok: true,
            doc_size: { w: 100, h: 100 },
            smart_objects: [],
            guides: { horizontal: [], vertical: [] },
            clip_areas: [],
            layers: [],
            text_layers: [],
          }),
          'utf8',
        )
      },
    })

    const first = await scanner.scanPsd(psdPath)
    const second = await scanner.scanPsd(psdPath)

    expect(runCount).toBe(1)
    expect(second).toEqual(first)
    expect(second.mode).toBe('none')
    expect(second.clip_areas).toEqual([{ x: 0, y: 0, w: 100, h: 100, is_full: true }])
  })

  it('rebinds a cached template to the path selected after the PSD is moved', async () => {
    const cache = createMemoryCache()
    const originalPath = await writeFakePsd('original.psd')
    const movedDir = join(tempDir, 'moved')
    const movedPath = join(movedDir, 'template.psd')
    await mkdir(movedDir, { recursive: true })
    let runCount = 0
    const scanner = createScanner({
      cache,
      runJsxFile: async (jsxPath) => {
        runCount += 1
        await writeFile(
          join(jsxPath, '..', 'scan-result.json'),
          JSON.stringify({
            ok: true,
            doc_size: { w: 100, h: 100 },
            smart_objects: [],
            guides: { horizontal: [], vertical: [] },
            clip_areas: [],
            layers: [],
            text_layers: [],
          }),
          'utf8',
        )
      },
    })

    const original = await scanner.scanPsd(originalPath)
    await writeFile(movedPath, 'fake-psd-content', 'utf8')
    await rm(originalPath)
    const moved = await scanner.scanPsd(movedPath)

    expect(runCount).toBe(1)
    expect(moved.file_path).toBe(resolve(movedPath))
    await expect(cache.findByHash(original.file_hash)).resolves.toMatchObject({
      file_path: resolve(movedPath),
    })
  })

  it('omits cached templates whose PSD file no longer exists', async () => {
    const psdPath = await writeFakePsd()
    const scanner = createScanner({
      runJsxFile: async (jsxPath) => {
        await writeFile(
          join(jsxPath, '..', 'scan-result.json'),
          JSON.stringify({
            ok: true,
            doc_size: { w: 100, h: 100 },
            smart_objects: [],
            guides: { horizontal: [], vertical: [] },
            clip_areas: [],
            layers: [],
            text_layers: [],
          }),
          'utf8',
        )
      },
    })

    await scanner.scanPsd(psdPath)
    await rm(psdPath)

    await expect(scanner.listCachedTemplates()).resolves.toEqual([])
  })

  it('rejects non-Windows scans before running JSX', async () => {
    const psdPath = await writeFakePsd()
    const scanner = createScanner({
      platform: 'darwin',
      runJsxFile: async () => {
        throw new Error('should not run')
      },
    })

    await expect(scanner.scanPsd(psdPath)).rejects.toMatchObject({
      code: 'PS_UNSUPPORTED_PLATFORM',
      retryable: false,
    })
  })

  it('surfaces scan result errors as template scan failures', async () => {
    const psdPath = await writeFakePsd()
    const scanner = createScanner({
      runJsxFile: async (jsxPath) => {
        await writeFile(
          join(jsxPath, '..', 'scan-result.json'),
          JSON.stringify({ error: 'Cannot open PSD' }),
          'utf8',
        )
      },
    })

    await expect(scanner.scanPsd(psdPath)).rejects.toMatchObject({
      code: 'TEMPLATE_SCAN_FAILED',
      retryable: false,
    })
  })

  it('scans real PSD templates through Photoshop when REAL_PS=1', async () => {
    if (process.env.REAL_PS !== '1') {
      return
    }

    const scanner = new PsdScanner({
      platform: 'win32',
      tempFiles: {
        createTaskDir: async (_module, taskId) => {
          const taskDir = join(tempDir, 'real-tmp', taskId)
          await mkdir(taskDir, { recursive: true })
          return taskDir
        },
        cleanupTask: async () => undefined,
      },
      cache: createMemoryCache(),
    })
    const psdPaths = (process.env.PS_PSD_PATHS ?? '')
      .split(';')
      .map((path) => path.trim())
      .filter(Boolean)
    expect(psdPaths.length).toBeGreaterThan(0)

    for (const psdPath of psdPaths) {
      const template = await scanner.scanPsd(psdPath)

      expect(template.doc_size.w).toBeGreaterThan(0)
      expect(template.doc_size.h).toBeGreaterThan(0)
      expect(template.layers.length).toBeGreaterThan(0)
      if (basename(psdPath).toLowerCase() === 'white hoodie.psd') {
        expect(template.native_slices).toHaveLength(8)
      }
    }
  }, 300_000)
})
