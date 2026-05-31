import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type CollectionConfigRow = {
  platform: string
  profile_id: string
  mode: string
  output_dir: string
  scroll_keywords: string
  min_width: number
  max_width: number
  min_height: number
  max_height: number
  updated_at: number
}

type FakeDbState = {
  tableCreated: boolean
  row: CollectionConfigRow | null
}

type FakeStatement = {
  get: () => unknown | undefined
  run: (...values: unknown[]) => void
}

const fakeDbs = new Map<string, FakeDbState>()

let workbenchRoot = ''

class FakeDatabase {
  private readonly state: FakeDbState

  constructor(private readonly path: string) {
    const existing = fakeDbs.get(path)
    if (existing) {
      this.state = existing
      return
    }

    this.state = { tableCreated: false, row: null }
    fakeDbs.set(path, this.state)
  }

  exec(sql: string) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS collection_config')) {
      this.state.tableCreated = true
    }
  }

  prepare(sql: string): FakeStatement {
    if (sql.includes('SELECT name FROM sqlite_master')) {
      return {
        get: () => (this.state.tableCreated ? { name: 'collection_config' } : undefined),
        run: () => undefined,
      }
    }

    if (sql.includes('SELECT COUNT(*) AS count FROM collection_config')) {
      return {
        get: () => ({ count: this.state.row ? 1 : 0 }),
        run: () => undefined,
      }
    }

    if (sql.includes('SELECT') && sql.includes('FROM collection_config')) {
      return {
        get: () => this.state.row,
        run: () => undefined,
      }
    }

    if (sql.includes('INSERT INTO collection_config')) {
      return {
        get: () => undefined,
        run: (...values: unknown[]) => {
          this.state.tableCreated = true
          this.state.row = {
            platform: String(values[0]),
            profile_id: String(values[1]),
            mode: String(values[2]),
            output_dir: String(values[3]),
            scroll_keywords: String(values[4]),
            min_width: Number(values[5]),
            max_width: Number(values[6]),
            min_height: Number(values[7]),
            max_height: Number(values[8]),
            updated_at: Number(values[9]),
          }
        },
      }
    }

    return {
      get: () => undefined,
      run: () => undefined,
    }
  }

  close() {}
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('./sqlite', () => ({
  openSqliteDatabase: (path: string) => new FakeDatabase(path),
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: workbenchRoot }),
}))

const { getCollectionConfig, saveCollectionConfig } = await import('./collection-config')

function dbPath() {
  return `${workbenchRoot}/.workbench/workbench.db`
}

function openDb() {
  return new FakeDatabase(dbPath())
}

beforeEach(() => {
  workbenchRoot = `workbench-${randomUUID()}`
  fakeDbs.clear()
})

afterEach(() => {
  fakeDbs.clear()
})

describe('collection-config', () => {
  it('creates the collection_config table and returns null before the first save', async () => {
    await expect(getCollectionConfig()).resolves.toBeNull()

    const db = openDb()
    try {
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collection_config'",
        )
        .get() as { name: string } | undefined
      expect(table?.name).toBe('collection_config')
    } finally {
      db.close()
    }
  })

  it('saves and loads the selected collection settings', async () => {
    const input = {
      platform: 'temu',
      profile_id: 'profile-1',
      mode: 'scroll',
      output_dir: '/tmp/workbench/01-采集工作区/temu-20260531-120000',
      scroll_keywords: 'dress,summer',
      size_filter: {
        min_width: 800,
        max_width: 1200,
        min_height: 1000,
        max_height: 1600,
      },
    }

    await expect(saveCollectionConfig(input)).resolves.toEqual(input)
    await expect(getCollectionConfig()).resolves.toEqual(input)
  })

  it('normalizes invalid values and keeps a single upsert row', async () => {
    await saveCollectionConfig({
      platform: '',
      profile_id: '  profile-1  ',
      mode: 'other',
      output_dir: '  /tmp/out  ',
      scroll_keywords: '  shirt  ',
      size_filter: {
        min_width: 800.8,
        max_width: -1,
        min_height: '1600',
        max_height: 'bad',
      },
    })
    const saved = await saveCollectionConfig({
      platform: 'ozon',
      profile_id: 'profile-2',
      mode: 'click',
      output_dir: '',
      scroll_keywords: '',
      size_filter: {
        min_width: 0,
        max_width: 900,
        min_height: 0,
        max_height: 1100,
      },
    })

    expect(saved).toEqual({
      platform: 'ozon',
      profile_id: 'profile-2',
      mode: 'click',
      output_dir: '',
      scroll_keywords: '',
      size_filter: {
        min_width: 0,
        max_width: 900,
        min_height: 0,
        max_height: 1100,
      },
    })

    const db = openDb()
    try {
      const rowCount = db.prepare('SELECT COUNT(*) AS count FROM collection_config').get() as {
        count: number
      }
      expect(rowCount.count).toBe(1)
    } finally {
      db.close()
    }
  })
})
