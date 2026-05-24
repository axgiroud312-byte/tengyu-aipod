import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CollectionClickService } from './collection-click-service'
import type { CollectionPlatformRule } from './collection-injected-script'
import {
  exportCollectionManifest,
  insertCollectionRecord,
  openCollectionDatabase,
} from './collection-record-store'
import type { CollectionSession } from './collection-session-manager'

const platformRule: CollectionPlatformRule = {
  key: 'temu',
  name: 'Temu',
  allowed_domains: ['temu.com'],
  entry_url: 'https://www.temu.com',
  goods_url_patterns: ['/goods/'],
  login_check: { indicators: [] },
  original_image_resolver: { type: 'src_replace', config: { from: '_thumb', to: '_original' } },
}

function activeSession(overrides: Partial<CollectionSession> = {}): CollectionSession {
  return {
    id: 'session-1',
    platform: 'temu',
    profile_id: 'profile-1',
    mode: 'click',
    status: 'active',
    output_dir: '/tmp/wb/01-采集',
    started_at: 1000,
    ...overrides,
  }
}

class FakeStatement {
  constructor(
    private readonly options: {
      run?: (...values: unknown[]) => void
      all?: (...values: unknown[]) => unknown[]
      get?: (...values: unknown[]) => unknown
    },
  ) {}

  run(...values: unknown[]) {
    this.options.run?.(...values)
    return { changes: 1 }
  }

  all(...values: unknown[]) {
    return this.options.all?.(...values) ?? []
  }

  get(...values: unknown[]) {
    return this.options.get?.(...values)
  }
}

class FakeDb {
  records: unknown[][] = []
  execCalls: string[] = []
  closed = false

  exec(sql: string) {
    this.execCalls.push(sql)
  }

  prepare(sql: string) {
    return new FakeStatement({
      run: (...values) => {
        if (sql.includes('INSERT INTO collection_records')) {
          this.records.push(values)
          return
        }
        if (sql.includes('UPDATE collection_records SET')) {
          const recordId = values[9]
          const index = this.records.findIndex((record) => record[0] === recordId)
          if (index >= 0) {
            const current = this.records[index]
            this.records[index] = [
              recordId,
              current?.[1],
              values[0],
              values[1],
              values[2],
              values[3],
              values[4],
              values[5],
              values[6],
              values[7],
              values[8],
            ]
          }
        }
      },
      all: (...values) => {
        if (!sql.includes('SELECT * FROM collection_records')) {
          return []
        }
        const sessionId = values[0]
        const hasStatus = sql.includes('AND status = ?')
        const status = hasStatus ? values[1] : null
        const limit = Number(values[hasStatus ? 2 : 1] ?? 20)
        return this.records
          .filter((record) => record[1] === sessionId && (!status || record[7] === status))
          .sort((left, right) => Number(right[10]) - Number(left[10]))
          .slice(0, limit)
          .map(fakeRecordRow)
      },
      get: (...values) => {
        const recordId = values[0]
        const record = this.records.find((item) => item[0] === recordId)
        return record ? fakeRecordRow(record) : undefined
      },
    }) as never
  }

  close() {
    this.closed = true
  }
}

function fakeRecordRow(record: unknown[]) {
  return {
    id: String(record[0]),
    session_id: String(record[1]),
    sku_code: record[2] === null ? null : String(record[2]),
    source_url: String(record[3]),
    goods_link: record[4] === null ? null : String(record[4]),
    page_url: String(record[5]),
    saved_path: record[6] === null ? null : String(record[6]),
    status: String(record[7]),
    reason: record[8] === null ? null : String(record[8]),
    file_size: record[9] === null ? null : Number(record[9]),
    created_at: Number(record[10]),
  }
}

function createFs() {
  const files = new Map<string, Buffer>()
  const dirs = new Set<string>()
  return {
    files,
    mkdir: vi.fn(async (path: string) => {
      dirs.add(path)
    }),
    writeFile: vi.fn(async (path: string, buffer: Buffer) => {
      files.set(path, buffer)
    }),
    readFile: vi.fn(async (path: string) => {
      const value = files.get(path)
      if (!value) {
        throw new Error('ENOENT')
      }
      return value
    }),
    readdir: vi.fn(async (path: string) => {
      const names = Array.from(files.keys())
        .filter((filePath) => filePath.startsWith(`${path}/`))
        .map((filePath) => basename(filePath))
      return names.map((name) => ({
        name,
        isFile: () => true,
      }))
    }),
    stat: vi.fn(async (path: string) => {
      const value = files.get(path)
      if (!value) {
        throw new Error('ENOENT')
      }
      return { size: value.byteLength }
    }),
  }
}

function createService(
  options: {
    session?: CollectionSession | null
    sku?: string | null
    image?: Buffer
    db?: FakeDb
  } = {},
) {
  const fs = createFs()
  const db = options.db ?? new FakeDb()
  const requestSku = vi.fn()
  let assignedSku = options.sku ?? null
  const service = new CollectionClickService({
    sessionManager: {
      getActiveSession: () => options.session ?? activeSession(),
      assignSessionSku: (_goodsLink, skuCode) => {
        assignedSku = skuCode
      },
      getSessionSku: () => assignedSku,
      requestSku,
    },
    downloadImage: vi.fn(async () => options.image ?? Buffer.from('image-bytes')),
    openDatabase: () => db as never,
    randomId: () => `record-${db.records.length + 1}`,
    now: () => 1_779_610_000_000,
    readFile: fs.readFile as never,
    readdir: fs.readdir as never,
    writeFile: fs.writeFile as never,
    stat: fs.stat as never,
    mkdir: fs.mkdir as never,
  })
  return { service, fs, db, requestSku }
}

describe('CollectionClickService', () => {
  it('requests a low-interruption SKU prompt for first-time goods-page clicks', async () => {
    const { service, requestSku, fs, db } = createService()

    await expect(
      service.handleClick(
        {
          kind: 'click',
          img: 'https://img.temu.com/a.jpg',
          goodsLink: 'https://www.temu.com/goods/1',
          page: 'https://www.temu.com/goods/1',
        },
        platformRule,
      ),
    ).resolves.toEqual({
      status: 'pending_sku',
      goodsLink: 'https://www.temu.com/goods/1',
    })

    expect(requestSku).toHaveBeenCalledWith(
      'https://www.temu.com/goods/1',
      'https://img.temu.com/a.jpg',
    )
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(db.records).toEqual([])
  })

  it('saves goods-page clicks into the existing SKU folder', async () => {
    const { service, fs, db } = createService({ sku: 'SKU-001' })

    await expect(
      service.handleClick(
        {
          kind: 'click',
          img: 'https://img.temu.com/a.jpg',
          goodsLink: 'https://www.temu.com/goods/1',
          page: 'https://www.temu.com/goods/1',
        },
        platformRule,
      ),
    ).resolves.toMatchObject({
      status: 'success',
      savedPath: '/tmp/wb/01-采集/SKU-001/SKU-001-001.jpg',
    })

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/wb/01-采集/SKU-001/SKU-001-001.jpg',
      Buffer.from('image-bytes'),
    )
    expect(db.records[0]?.slice(0, 8)).toEqual([
      'record-1',
      'session-1',
      'SKU-001',
      'https://img.temu.com/a.jpg',
      'https://www.temu.com/goods/1',
      'https://www.temu.com/goods/1',
      '/tmp/wb/01-采集/SKU-001/SKU-001-001.jpg',
      'success',
    ])
  })

  it('saves the pending goods-page click after the user fills the SKU', async () => {
    const { service, fs, db } = createService()

    await expect(
      service.handleClick(
        {
          kind: 'click',
          img: 'https://img.temu.com/a.jpg',
          goodsLink: 'https://www.temu.com/goods/1',
          page: 'https://www.temu.com/goods/1',
        },
        platformRule,
      ),
    ).resolves.toMatchObject({ status: 'pending_sku' })

    await expect(
      service.assignSkuAndSavePending('https://www.temu.com/goods/1', 'SKU-001'),
    ).resolves.toMatchObject({
      ok: true,
      results: [
        {
          status: 'success',
          savedPath: '/tmp/wb/01-采集/SKU-001/SKU-001-001.jpg',
        },
      ],
    })
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/wb/01-采集/SKU-001/SKU-001-001.jpg',
      Buffer.from('image-bytes'),
    )
    expect(db.records[0]?.[2]).toBe('SKU-001')
  })

  it('saves non-goods-page clicks into the loose image pool', async () => {
    const { service } = createService()

    await expect(
      service.handleClick(
        {
          kind: 'click',
          img: 'https://img.temu.com/a.png',
          goodsLink: 'https://www.temu.com/listing/1',
          page: 'https://www.temu.com/search?q=shirt',
        },
        platformRule,
      ),
    ).resolves.toMatchObject({
      status: 'success',
      savedPath: '/tmp/wb/01-采集/散图池/temu-20260524-160640-001.png',
    })
  })

  it('deduplicates matching image hashes inside the target folder', async () => {
    const image = Buffer.from('same-image')
    const { service, fs, db } = createService({ sku: 'SKU-001', image })
    const existingPath = '/tmp/wb/01-采集/SKU-001/existing.jpg'
    fs.files.set(existingPath, image)

    await expect(
      service.handleClick(
        {
          kind: 'click',
          img: 'https://img.temu.com/a.jpg',
          goodsLink: 'https://www.temu.com/goods/1',
          page: 'https://www.temu.com/goods/1',
        },
        platformRule,
      ),
    ).resolves.toMatchObject({
      status: 'skipped',
      savedPath: existingPath,
      reason: 'dedup',
    })

    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(db.records[0]?.[7]).toBe('skipped')
    expect(db.records[0]?.[8]).toBe('dedup')
    expect(createHash('sha256').update(image).digest('hex')).toHaveLength(64)
  })

  it('records failed downloads without writing files', async () => {
    const fs = createFs()
    const db = new FakeDb()
    const service = new CollectionClickService({
      sessionManager: {
        assignSessionSku: vi.fn(),
        getActiveSession: () => activeSession(),
        getSessionSku: () => 'SKU-001',
        requestSku: vi.fn(),
      },
      downloadImage: vi.fn(async () => {
        throw new Error('download failed')
      }),
      openDatabase: () => db as never,
      randomId: () => 'record-1',
      now: () => 1000,
      readFile: fs.readFile as never,
      readdir: fs.readdir as never,
      writeFile: fs.writeFile as never,
      stat: fs.stat as never,
      mkdir: fs.mkdir as never,
    })

    await expect(
      service.handleClick(
        {
          kind: 'click',
          img: 'https://img.temu.com/a.jpg',
          goodsLink: 'https://www.temu.com/goods/1',
          page: 'https://www.temu.com/goods/1',
        },
        platformRule,
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: 'download failed',
    })
    expect(db.records[0]?.[7]).toBe('failed')
    expect(db.records[0]?.[8]).toBe('download failed')
  })

  it('saves scroll images into the loose image pool', async () => {
    const { service, fs, db } = createService({
      session: activeSession({ mode: 'scroll' }),
    })

    await expect(
      service.handleScroll(
        {
          kind: 'scroll',
          img: 'https://img.temu.com/a.webp',
          goodsLink: 'https://www.temu.com/goods/1',
          page: 'https://www.temu.com/search?q=shirt',
          width: 500,
          height: 300,
        },
        platformRule,
      ),
    ).resolves.toMatchObject({
      status: 'success',
      savedPath: '/tmp/wb/01-采集/散图池/temu-20260524-160640-001.webp',
    })

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/wb/01-采集/散图池/temu-20260524-160640-001.webp',
      Buffer.from('image-bytes'),
    )
    expect(db.records[0]?.slice(0, 8)).toEqual([
      'record-1',
      'session-1',
      null,
      'https://img.temu.com/a.webp',
      'https://www.temu.com/goods/1',
      'https://www.temu.com/search?q=shirt',
      '/tmp/wb/01-采集/散图池/temu-20260524-160640-001.webp',
      'success',
    ])
  })

  it('rejects scroll events unless the active session is in scroll mode', async () => {
    const { service } = createService()

    await expect(
      service.handleScroll(
        {
          kind: 'scroll',
          img: 'https://img.temu.com/a.jpg',
          page: 'https://www.temu.com/search?q=shirt',
        },
        platformRule,
      ),
    ).rejects.toMatchObject({
      code: 'HTTP_4XX',
      details: { kind: 'state_conflict', mode: 'click' },
    })
  })

  it('deduplicates scroll image hashes inside the loose image pool', async () => {
    const image = Buffer.from('same-scroll-image')
    const { service, fs, db } = createService({
      session: activeSession({ mode: 'scroll' }),
      image,
    })
    const existingPath = '/tmp/wb/01-采集/散图池/existing.jpg'
    fs.files.set(existingPath, image)

    await expect(
      service.handleScroll(
        {
          kind: 'scroll',
          img: 'https://img.temu.com/a.jpg',
          page: 'https://www.temu.com/search?q=shirt',
        },
        platformRule,
      ),
    ).resolves.toMatchObject({
      status: 'skipped',
      savedPath: existingPath,
      reason: 'dedup',
    })

    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(db.records[0]?.[7]).toBe('skipped')
    expect(db.records[0]?.[8]).toBe('dedup')
  })

  it('lists active-session records and retries failed records in place', async () => {
    const db = new FakeDb()
    const { service, fs } = createService({
      session: activeSession({ mode: 'scroll' }),
      db,
    })
    db.records.push([
      'record-1',
      'session-1',
      null,
      'https://img.temu.com/retry.jpg',
      'https://www.temu.com/goods/1',
      'https://www.temu.com/search?q=shirt',
      null,
      'failed',
      'download failed',
      null,
      1000,
    ])

    expect(service.listRecords({ sessionId: 'session-1', status: 'failed' })).toMatchObject([
      {
        id: 'record-1',
        sourceUrl: 'https://img.temu.com/retry.jpg',
        status: 'failed',
      },
    ])

    await expect(service.retryRecord('record-1')).resolves.toMatchObject({
      status: 'success',
      savedPath: '/tmp/wb/01-采集/散图池/temu-20260524-160640-001.jpg',
    })
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/wb/01-采集/散图池/temu-20260524-160640-001.jpg',
      Buffer.from('image-bytes'),
    )
    expect(db.records[0]?.[7]).toBe('success')
    expect(db.records[0]?.[8]).toBeNull()
  })
})

describe('collection manifest export', () => {
  it('writes collection_records to a CSV manifest', async () => {
    const workbenchRoot = join(tmpdir(), `collection-manifest-${Date.now()}`)
    const outputDir = join(workbenchRoot, '01-采集')
    await mkdir(join(workbenchRoot, '.workbench'), { recursive: true })
    await mkdir(outputDir, { recursive: true })
    const db = openCollectionDatabase(workbenchRoot)
    try {
      insertCollectionRecord(db, {
        id: 'record-1',
        sessionId: 'session-1',
        skuCode: 'SKU-001',
        sourceUrl: 'https://img.temu.com/a.jpg',
        goodsLink: 'https://www.temu.com/goods/1',
        pageUrl: 'https://www.temu.com/goods/1',
        savedPath: join(outputDir, 'SKU-001/SKU-001-001.jpg'),
        status: 'success',
        reason: null,
        fileSize: 123,
        createdAt: 1000,
      })

      const manifestPath = await exportCollectionManifest(db, outputDir, 'session-1')

      await expect(fsReadText(manifestPath)).resolves.toContain(
        'sku_code,saved_path,source_url,goods_link,status,file_size,created_at',
      )
      await expect(fsReadText(manifestPath)).resolves.toContain('SKU-001,')
    } finally {
      db.close()
      await rm(workbenchRoot, { force: true, recursive: true })
    }
  })
})

async function fsReadText(path: string) {
  return String(await import('node:fs/promises').then((fs) => fs.readFile(path)))
}
