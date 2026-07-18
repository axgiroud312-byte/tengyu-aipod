import type { SqliteDatabase } from './sqlite'

export const CURRENT_WORKBENCH_SCHEMA_VERSION = 3

type MigrationDatabase = Pick<SqliteDatabase, 'exec' | 'prepare'>

const WORKBENCH_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  module TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  params_snapshot TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_task ON workflow_steps(task_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  sku_code TEXT,
  print_id TEXT,
  step TEXT NOT NULL,
  provider TEXT,
  model_or_workflow TEXT,
  skill_id TEXT,
  skill_version TEXT,
  source_artifact_ids TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_hash TEXT,
  prompt_snapshot TEXT,
  params_snapshot TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_provider_path ON artifacts(provider, file_path);

CREATE TABLE IF NOT EXISTS collection_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  platform TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  scroll_keywords TEXT NOT NULL,
  min_width INTEGER NOT NULL,
  max_width INTEGER NOT NULL,
  min_height INTEGER NOT NULL,
  max_height INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sku_code TEXT,
  source_url TEXT NOT NULL,
  goods_link TEXT,
  page_url TEXT NOT NULL,
  saved_path TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  file_size INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_session ON collection_records(session_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON collection_records(status);

CREATE TABLE IF NOT EXISTS collection_sessions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  task_id TEXT
);

CREATE TABLE IF NOT EXISTS comfyui_instances (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL,
  instance_uuid TEXT NOT NULL,
  comfyui_url TEXT NOT NULL,
  pod_uuid TEXT,
  gpu_uuid TEXT,
  gpu_name TEXT,
  status TEXT NOT NULL,
  pod_price_hour REAL NOT NULL DEFAULT 0,
  gpu_price_hour REAL NOT NULL DEFAULT 0,
  auto_shutdown_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

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

CREATE TABLE IF NOT EXISTS detection_results (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  risk_score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  reason TEXT,
  model TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  threshold_snapshot TEXT NOT NULL,
  output_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_detection_artifact ON detection_results(artifact_id);
CREATE INDEX IF NOT EXISTS idx_detection_level ON detection_results(risk_level);

CREATE TABLE IF NOT EXISTS matting_candidates (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  print_id TEXT,
  source_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(artifact_id)
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  result_sections_json TEXT DEFAULT '[]',
  logs_json TEXT DEFAULT '[]',
  error_summary TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS pipeline_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  module TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  output_json TEXT,
  error_json TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, step_key)
);

CREATE TABLE IF NOT EXISTS pipeline_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL,
  source_path TEXT,
  output_path TEXT,
  artifact_id TEXT,
  print_id TEXT,
  source_artifact_ids_json TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(run_id, item_key, step_key)
);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_run ON pipeline_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_items_run ON pipeline_items(run_id);

CREATE TABLE IF NOT EXISTS psd_templates (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  doc_size_w INTEGER NOT NULL,
  doc_size_h INTEGER NOT NULL,
  smart_objects TEXT NOT NULL,
  guides TEXT NOT NULL,
  clip_areas TEXT NOT NULL,
  native_slices TEXT NOT NULL DEFAULT '[]',
  scanner_version INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL,
  representative_so_count INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL,
  layers TEXT NOT NULL DEFAULT '[]',
  text_layers TEXT NOT NULL DEFAULT '[]',
  UNIQUE(file_hash)
);
CREATE INDEX IF NOT EXISTS idx_psd_templates_file_path ON psd_templates(file_path);

CREATE TABLE IF NOT EXISTS skus (
  code TEXT PRIMARY KEY,
  template_batch TEXT,
  title TEXT,
  language TEXT,
  platform TEXT,
  title_skill_id TEXT,
  title_skill_version TEXT,
  title_model TEXT,
  title_generated_at INTEGER,
  created_at INTEGER NOT NULL
);
`

const COLUMN_MIGRATIONS: Array<{ table: string; column: string; definition: string }> = [
  { table: 'artifacts', column: 'sku_code', definition: 'sku_code TEXT' },
  { table: 'artifacts', column: 'print_id', definition: 'print_id TEXT' },
  { table: 'artifacts', column: 'step', definition: 'step TEXT' },
  { table: 'artifacts', column: 'model_or_workflow', definition: 'model_or_workflow TEXT' },
  { table: 'artifacts', column: 'skill_id', definition: 'skill_id TEXT' },
  { table: 'artifacts', column: 'skill_version', definition: 'skill_version TEXT' },
  { table: 'artifacts', column: 'source_artifact_ids', definition: 'source_artifact_ids TEXT' },
  { table: 'artifacts', column: 'file_size', definition: 'file_size INTEGER' },
  { table: 'artifacts', column: 'prompt_snapshot', definition: 'prompt_snapshot TEXT' },
  { table: 'artifacts', column: 'params_snapshot', definition: 'params_snapshot TEXT' },
  {
    table: 'pipeline_runs',
    column: 'result_sections_json',
    definition: "result_sections_json TEXT DEFAULT '[]'",
  },
  { table: 'pipeline_runs', column: 'logs_json', definition: "logs_json TEXT DEFAULT '[]'" },
  { table: 'psd_templates', column: 'layers', definition: "layers TEXT NOT NULL DEFAULT '[]'" },
  {
    table: 'psd_templates',
    column: 'native_slices',
    definition: "native_slices TEXT NOT NULL DEFAULT '[]'",
  },
  {
    table: 'psd_templates',
    column: 'scanner_version',
    definition: 'scanner_version INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: 'psd_templates',
    column: 'text_layers',
    definition: "text_layers TEXT NOT NULL DEFAULT '[]'",
  },
]

export function runWorkbenchMigrations(db: MigrationDatabase): void {
  if (userVersion(db) >= CURRENT_WORKBENCH_SCHEMA_VERSION) {
    return
  }

  db.exec('BEGIN')
  try {
    db.exec(WORKBENCH_SCHEMA_DDL)
    for (const migration of COLUMN_MIGRATIONS) {
      ensureColumn(db, migration.table, migration.column, migration.definition)
    }
    db.exec(`PRAGMA user_version = ${CURRENT_WORKBENCH_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Ignore rollback errors so the original migration failure is preserved.
    }
    throw error
  }
}

function userVersion(db: MigrationDatabase): number {
  const row = db.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined
  const value = row?.user_version
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function ensureColumn(
  db: MigrationDatabase,
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>
  if (rows.some((row) => row.name === column)) {
    return
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
}
