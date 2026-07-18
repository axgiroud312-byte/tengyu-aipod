import type { PsdTemplate } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import { SqlitePsdTemplateCache } from './psd-template-cache'

type Row = Record<string, unknown>

function createFakeDb() {
  const rows = new Map<string, Row>()
  return {
    rows,
    exec: () => undefined,
    prepare: (sql: string) => ({
      get: (fileHash: string, scannerVersion?: number) => {
        const row = rows.get(fileHash)
        if (sql.includes('scanner_version') && row?.scanner_version !== scannerVersion) {
          return undefined
        }
        return row
      },
      all: (scannerVersion?: number) =>
        [...rows.values()]
          .filter((row) =>
            sql.includes('scanner_version') ? row.scanner_version === scannerVersion : true,
          )
          .sort((a, b) => Number(b.scanned_at) - Number(a.scanned_at)),
      run: (row: Row) => {
        if (sql.includes('INSERT INTO psd_templates')) {
          rows.set(String(row.file_hash), row)
        }
      },
    }),
  }
}

function template(hash: string, scannedAt: number): PsdTemplate {
  return {
    id: `psd_${hash}`,
    file_path: `C:\\${hash}.psd`,
    file_hash: hash,
    doc_size: { w: 1000, h: 800 },
    smart_objects: [
      {
        name: 'Artwork',
        path: 'Artwork',
        sort_order: 0,
        is_top_level: true,
        bounds: [0, 0, 500, 500],
        shared_indicator: 'artwork',
      },
    ],
    guides: { horizontal: [400], vertical: [] },
    clip_areas: [{ x: 0, y: 0, w: 1000, h: 400, is_full: false }],
    native_slices: [{ name: 'Front', kind: 'user', bounds: [0, 0, 1000, 400] }],
    mode: 'single',
    representative_so_count: 1,
    scanned_at: scannedAt,
    layers: [
      {
        name: 'Artwork',
        path: 'Artwork',
        typename: 'ArtLayer',
        is_group: false,
        is_smart_object: true,
        is_text: false,
        bounds: [0, 0, 500, 500],
      },
    ],
    text_layers: [{ name: 'Title', path: 'Title', text: 'Sample' }],
  }
}

describe('SqlitePsdTemplateCache', () => {
  it('maps psd template scan results to and from database rows', async () => {
    const cache = new SqlitePsdTemplateCache({
      db: createFakeDb() as never,
    })

    await cache.save(template('hash-a', 1000))
    await cache.save(template('hash-b', 2000))

    await expect(cache.findByHash('hash-a')).resolves.toMatchObject({
      file_hash: 'hash-a',
      doc_size: { w: 1000, h: 800 },
      smart_objects: [{ name: 'Artwork' }],
      text_layers: [{ text: 'Sample' }],
      native_slices: [{ name: 'Front', kind: 'user' }],
    })
    await expect(cache.list()).resolves.toMatchObject([
      { file_hash: 'hash-b' },
      { file_hash: 'hash-a' },
    ])
  })

  it('invalidates legacy scanner rows but caches current no-slice templates', async () => {
    const db = createFakeDb()
    const cache = new SqlitePsdTemplateCache({ db: db as never })
    const noSliceTemplate = { ...template('no-slices', 1000), native_slices: [] }

    await cache.save(noSliceTemplate)
    await expect(cache.findByHash('no-slices')).resolves.toMatchObject({ native_slices: [] })

    const row = db.rows.get('no-slices')
    expect(row?.scanner_version).toBeGreaterThan(0)
    if (row) {
      row.scanner_version = 0
    }
    await expect(cache.findByHash('no-slices')).resolves.toBeNull()
    await expect(cache.list()).resolves.toEqual([])
  })
})
