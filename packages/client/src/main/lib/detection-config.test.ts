import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type DetectionConfigRow = {
  pass_max: number
  review_max: number
  skill_id: string
  skill_version: string
  model: string
  variables_json: string
  updated_at: number
}

type FakeDbState = {
  tableCreated: boolean
  row: DetectionConfigRow | null
}

type FakeStatement = {
  get: () => unknown | undefined
  all: () => unknown[]
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
    if (sql.includes('CREATE TABLE IF NOT EXISTS detection_config')) {
      this.state.tableCreated = true
    }
  }

  prepare(sql: string): FakeStatement {
    if (sql.includes('SELECT name FROM sqlite_master')) {
      return {
        get: () => (this.state.tableCreated ? { name: 'detection_config' } : undefined),
        all: () => [],
        run: () => undefined,
      }
    }

    if (sql.includes('SELECT COUNT(*) AS count FROM detection_config')) {
      return {
        get: () => ({ count: this.state.row ? 1 : 0 }),
        all: () => [],
        run: () => undefined,
      }
    }

    if (
      sql.includes('SELECT pass_max, review_max, variables_json FROM detection_config WHERE id = 1')
    ) {
      return {
        get: () =>
          this.state.row
            ? {
                pass_max: this.state.row.pass_max,
                review_max: this.state.row.review_max,
                variables_json: this.state.row.variables_json,
              }
            : undefined,
        all: () => [],
        run: () => undefined,
      }
    }

    if (
      sql.includes('SELECT') &&
      sql.includes('FROM detection_config') &&
      sql.includes('WHERE id = 1')
    ) {
      return {
        get: () =>
          this.state.row
            ? {
                passMax: this.state.row.pass_max,
                reviewMax: this.state.row.review_max,
                skillId: this.state.row.skill_id,
                skillVersion: this.state.row.skill_version,
                model: this.state.row.model,
                variablesJson: this.state.row.variables_json,
                updatedAt: this.state.row.updated_at,
              }
            : undefined,
        all: () => [],
        run: () => undefined,
      }
    }

    if (sql.includes('INSERT INTO detection_config')) {
      return {
        run: (...values: unknown[]) => {
          this.state.tableCreated = true
          this.state.row = {
            pass_max: Number(values[0]),
            review_max: Number(values[1]),
            skill_id: String(values[2]),
            skill_version: String(values[3]),
            model: String(values[4]),
            variables_json: String(values[5]),
            updated_at: Number(values[6]),
          }
        },
        all: () => [],
        get: () => undefined,
      }
    }

    return {
      get: () => undefined,
      all: () => [],
      run: () => undefined,
    }
  }

  close() {}
}

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler)
    },
  },
}))

vi.mock('./sqlite', () => ({
  openSqliteDatabase: (path: string) => new FakeDatabase(path),
}))

vi.mock('../onboarding', () => ({
  readAppConfig: () => ({ workbench_root: workbenchRoot }),
}))

const { getDetectionConfig, registerDetectionConfigIpc, saveDetectionConfig } = await import(
  './detection-config'
)

function dbPath() {
  return join(workbenchRoot, '.workbench', 'workbench.db')
}

function openDb() {
  return new FakeDatabase(dbPath())
}

beforeEach(() => {
  workbenchRoot = `workbench-${randomUUID()}`
  fakeDbs.clear()
  electronMocks.handlers.clear()
})

afterEach(() => {
  fakeDbs.clear()
})

describe('detection-config', () => {
  it('creates the detection_config table and returns null before the first save', async () => {
    await expect(getDetectionConfig()).resolves.toBeNull()

    const db = openDb()
    try {
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'detection_config'",
        )
        .get() as { name: string } | undefined
      expect(table?.name).toBe('detection_config')
    } finally {
      db.close()
    }
  })

  it('saves the default config and round-trips variables JSON', async () => {
    const input = {
      threshold: { passMax: 39, reviewMax: 69 },
      skillId: 'infringement-v2',
      skillVersion: '2.0.0',
      model: 'qwen3.6-flash',
      variables: {
        focus: ['brand', 'movie'],
        output_reason: true,
        custom_keywords: 'nike\nadidas',
      },
    }

    const saved = await saveDetectionConfig(input)
    const loaded = await getDetectionConfig()
    expect(saved).toEqual(input)
    expect(loaded).toEqual(input)
  })

  it('normalizes thresholds and keeps a single upsert row', async () => {
    const first = {
      threshold: { passMax: 120.9, reviewMax: -5.2 },
      skillId: 'infringement-v2',
      skillVersion: '2.0.0',
      model: 'qwen3.6-flash',
      variables: { focus: ['brand'] },
    }
    const second = {
      threshold: { passMax: 70.2, reviewMax: 40.8 },
      skillId: 'infringement-v3',
      skillVersion: '2.1.0',
      model: 'qwen3.6-flash',
      variables: {
        focus: ['cartoon', 'celebrity'],
        output_reason: false,
        custom_keywords: ['hello', 'world'],
      },
    }

    const savedFirst = await saveDetectionConfig(first)
    const loadedFirst = await getDetectionConfig()
    expect(savedFirst).toEqual({
      threshold: { passMax: 0, reviewMax: 100 },
      skillId: first.skillId,
      skillVersion: first.skillVersion,
      model: first.model,
      variables: first.variables,
    })
    expect(loadedFirst).toEqual({
      threshold: { passMax: 0, reviewMax: 100 },
      skillId: first.skillId,
      skillVersion: first.skillVersion,
      model: first.model,
      variables: first.variables,
    })
    const savedSecond = await saveDetectionConfig(second)
    const loadedSecond = await getDetectionConfig()
    expect(savedSecond).toEqual({
      threshold: { passMax: 40, reviewMax: 70 },
      skillId: second.skillId,
      skillVersion: second.skillVersion,
      model: second.model,
      variables: second.variables,
    })
    expect(loadedSecond).toEqual({
      threshold: { passMax: 40, reviewMax: 70 },
      skillId: second.skillId,
      skillVersion: second.skillVersion,
      model: second.model,
      variables: second.variables,
    })

    const db = openDb()
    try {
      const rowCount = db.prepare('SELECT COUNT(*) AS count FROM detection_config').get() as {
        count: number
      }
      expect(rowCount.count).toBe(1)

      const row = db
        .prepare('SELECT pass_max, review_max, variables_json FROM detection_config WHERE id = 1')
        .get() as { pass_max: number; review_max: number; variables_json: string }
      expect(row).toEqual({
        pass_max: 40,
        review_max: 70,
        variables_json: JSON.stringify(second.variables),
      })
    } finally {
      db.close()
    }
  })

  it('rejects invalid detection:save-config input at the IPC boundary', () => {
    registerDetectionConfigIpc()
    const handler = electronMocks.handlers.get('detection:save-config')
    if (!handler) {
      throw new Error('detection:save-config handler was not registered')
    }

    expect(() => handler({}, { threshold: { passMax: 39, reviewMax: 69 } })).toThrow(
      '侵权检测配置参数不正确',
    )
  })
})
