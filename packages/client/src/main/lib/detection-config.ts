import { join } from 'node:path'
import { AppErrorClass } from '@tengyu-aipod/shared'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { readAppConfig } from '../onboarding'
import { type SqliteDatabase, openSqliteDatabase } from './sqlite'

export type DetectionThresholdConfig = {
  passMax: number
  reviewMax: number
}

export type DetectionConfig = {
  threshold: DetectionThresholdConfig
  skillId: string
  skillVersion: string
  model: string
  variables: Record<string, unknown>
}

type DetectionConfigRow = {
  passMax: number
  reviewMax: number
  skillId: string
  skillVersion: string
  model: string
  variablesJson: string
  updatedAt: number
}

const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  threshold: { passMax: 39, reviewMax: 69 },
  skillId: '',
  skillVersion: '',
  model: 'qwen3.6-flash',
  variables: {},
}
const detectionConfigSchema = z.object({
  threshold: z.object({
    passMax: z.number(),
    reviewMax: z.number(),
  }),
  skillId: z.string(),
  skillVersion: z.string(),
  model: z.string(),
  variables: z.record(z.unknown()),
})

function parseDetectionConfigIpcInput(input: unknown): DetectionConfig {
  const parsed = detectionConfigSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppErrorClass('INVALID_INPUT', '侵权检测配置参数不正确', false, {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

function workbenchDbPath(workbenchRoot: string) {
  return join(workbenchRoot, '.workbench', 'workbench.db')
}

function openWorkbenchDatabase(workbenchRoot: string) {
  return openSqliteDatabase(workbenchDbPath(workbenchRoot))
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.floor(value)))
}

function normalizeThreshold(threshold?: Partial<DetectionThresholdConfig>) {
  const passMax = clampScore(threshold?.passMax ?? 39)
  const reviewMax = clampScore(threshold?.reviewMax ?? 69)
  return {
    passMax: Math.min(passMax, reviewMax),
    reviewMax: Math.max(passMax, reviewMax),
  }
}

function ensureDetectionConfigTable(db: Pick<SqliteDatabase, 'exec'>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS detection_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pass_max INTEGER NOT NULL,
      review_max INTEGER NOT NULL,
      skill_id TEXT NOT NULL,
      skill_version TEXT NOT NULL,
      model TEXT NOT NULL,
      variables_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

export async function getDetectionConfig() {
  const config = await readAppConfig()
  if (!config.workbench_root) {
    throw new Error('workbench_root is required before detection config can be read')
  }

  const db = openWorkbenchDatabase(config.workbench_root)
  try {
    ensureDetectionConfigTable(db)
    const row = db
      .prepare(
        `
          SELECT
            pass_max AS passMax,
            review_max AS reviewMax,
            skill_id AS skillId,
            skill_version AS skillVersion,
            model,
            variables_json AS variablesJson,
            updated_at AS updatedAt
          FROM detection_config
          WHERE id = 1
        `,
      )
      .get() as DetectionConfigRow | undefined

    if (!row) {
      return null
    }

    return {
      threshold: normalizeThreshold(row),
      skillId: row.skillId,
      skillVersion: row.skillVersion,
      model: row.model,
      variables: JSON.parse(row.variablesJson) as Record<string, unknown>,
    }
  } finally {
    db.close()
  }
}

export async function saveDetectionConfig(input: DetectionConfig) {
  const config = await readAppConfig()
  if (!config.workbench_root) {
    throw new Error('workbench_root is required before detection config can be saved')
  }

  const db = openWorkbenchDatabase(config.workbench_root)
  const threshold = normalizeThreshold(input.threshold)
  const variables = input.variables ?? {}
  try {
    ensureDetectionConfigTable(db)
    db.prepare(
      `
        INSERT INTO detection_config (
          id,
          pass_max,
          review_max,
          skill_id,
          skill_version,
          model,
          variables_json,
          updated_at
        )
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          pass_max = excluded.pass_max,
          review_max = excluded.review_max,
          skill_id = excluded.skill_id,
          skill_version = excluded.skill_version,
          model = excluded.model,
          variables_json = excluded.variables_json,
          updated_at = excluded.updated_at
      `,
    ).run(
      threshold.passMax,
      threshold.reviewMax,
      input.skillId,
      input.skillVersion,
      input.model,
      JSON.stringify(variables),
      Date.now(),
    )

    return {
      threshold,
      skillId: input.skillId,
      skillVersion: input.skillVersion,
      model: input.model,
      variables,
    }
  } finally {
    db.close()
  }
}

export function resetDetectionConfig() {
  return {
    threshold: { ...DEFAULT_DETECTION_CONFIG.threshold },
    skillId: DEFAULT_DETECTION_CONFIG.skillId,
    skillVersion: DEFAULT_DETECTION_CONFIG.skillVersion,
    model: DEFAULT_DETECTION_CONFIG.model,
    variables: {},
  }
}

export function registerDetectionConfigIpc() {
  ipcMain.handle('detection:get-config', () => getDetectionConfig())
  ipcMain.handle('detection:save-config', (_event, input: unknown) =>
    saveDetectionConfig(parseDetectionConfigIpcInput(input)),
  )
}
