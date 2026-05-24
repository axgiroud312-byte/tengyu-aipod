import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CollectionClickService } from './collection-click-service'
import type { CollectionPlatformRule } from './collection-injected-script'
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
  constructor(private readonly runFn: (...values: unknown[]) => void) {}

  run(...values: unknown[]) {
    this.runFn(...values)
    return { changes: 1 }
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
    return new FakeStatement((...values) => {
      if (sql.includes('INSERT INTO collection_records')) {
        this.records.push(values)
      }
    })
  }

  close() {
    this.closed = true
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
})
