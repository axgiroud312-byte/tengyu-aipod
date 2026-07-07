import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportDiagnosticLogZip } from './diagnostic-log-export-service'
import { openWorkbenchDatabase, workbenchDatabasePath } from './workbench-db'

let workbenchRoot = ''

beforeEach(async () => {
  workbenchRoot = join(tmpdir(), `diagnostic-export-${Date.now()}-${Math.random()}`)
  await mkdir(workbenchRoot, { recursive: true })
})

afterEach(async () => {
  if (workbenchRoot) {
    await rm(workbenchRoot, { recursive: true, force: true })
  }
})

describe('diagnostic log export service', () => {
  it('exports workbench logs, listing evidence, and sqlite runtime logs into a zip', async () => {
    const logsRoot = join(workbenchRoot, '.workbench', 'logs')
    const evidenceDir = join(
      workbenchRoot,
      '.workbench',
      'tmp',
      'listing',
      'task-1',
      'evidence',
      'profile-a',
      'SKU-1',
    )
    await mkdir(join(logsRoot, 'diagnostics', 'generation'), { recursive: true })
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(join(logsRoot, 'main.log'), 'main log')
    await writeFile(join(logsRoot, 'diagnostics', 'generation', 'task.jsonl'), '{"ok":true}\n')
    await writeFile(join(evidenceDir, 'state.json'), '{"stage":"publish_result"}')

    const db = openWorkbenchDatabase(workbenchDatabasePath(workbenchRoot))
    db.prepare(
      `INSERT INTO pipeline_runs (
        id, name, source_mode, status, config_json, stats_json, logs_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'run-1',
      '完整任务 1',
      'txt2img',
      'failed',
      '{}',
      '{}',
      JSON.stringify([{ level: 'error', message: '完整任务失败' }]),
      123,
    )
    db.exec(`
      CREATE TABLE IF NOT EXISTS listing_status (
        id TEXT PRIMARY KEY,
        batch_path TEXT NOT NULL,
        sku_code TEXT NOT NULL,
        platform TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_dir TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(batch_path, sku_code, platform, workspace_id)
      );
    `)
    db.prepare(
      `INSERT INTO listing_status (
        id, batch_path, sku_code, platform, workspace_id, status, evidence_dir, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('ls-1', '/batch', 'SKU-1', 'temu-pop', 'profile-a', 'failed', evidenceDir, 123)
    db.prepare(
      `INSERT INTO workflow_steps (
        id, task_id, module, step, status, attempt, params_snapshot, error_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'ps-step-1',
      'ps-task-1',
      'photoshop',
      'mockup',
      'failed',
      2,
      '{}',
      JSON.stringify({ code: 'JSX_EXEC_FAILED', message: '脚本失败' }),
      123,
    )
    db.close()

    const outputPath = join(workbenchRoot, 'diagnostic.zip')
    const result = await exportDiagnosticLogZip({ outputPath, workbenchRoot })

    expect(result.path).toBe(outputPath)
    expect(result.files).toBeGreaterThanOrEqual(6)
    await expect(stat(outputPath)).resolves.toMatchObject({ size: expect.any(Number) })

    const entries = readZip(await readFile(outputPath))
    expect(entries.get('logs/main.log')).toBe('main log')
    expect(entries.get('logs/diagnostics/generation/task.jsonl')).toBe('{"ok":true}\n')
    expect(entries.get('.workbench/tmp/listing/task-1/evidence/profile-a/SKU-1/state.json')).toBe(
      '{"stage":"publish_result"}',
    )
    expect(entries.get('sqlite/pipeline/logs.jsonl')).toContain('完整任务失败')
    expect(entries.get('sqlite/photoshop/workflow-steps.jsonl')).toContain('JSX_EXEC_FAILED')
    expect(entries.get('manifest.json')).toContain('"version"')
  })

  it('redacts local paths and prompt or skill content from exported diagnostic data', async () => {
    const logsRoot = join(workbenchRoot, '.workbench', 'logs')
    const diagnosticLogPath = join(logsRoot, 'diagnostics', 'title', 'task.jsonl')
    const localImagePath = join(workbenchRoot, '04-上架工作区', 'SKU-1', '01.jpg')
    const outputPath = join(workbenchRoot, '04-上架工作区', 'SKU-1', '标题.xlsx')
    const fullPrompt = 'Generate a private prompt with buyer-specific wording.'
    const skillPrompt = 'Private skill system prompt for internal title generation.'

    await mkdir(join(logsRoot, 'diagnostics', 'title'), { recursive: true })
    await writeFile(
      diagnosticLogPath,
      `${JSON.stringify({
        type: 'request',
        data: {
          diagnosticsLogPath: diagnosticLogPath,
          sourcePath: localImagePath,
          outputPath,
          prompt: fullPrompt,
          skill: {
            id: 'skill-title',
            version: 'v1',
            systemPrompt: skillPrompt,
          },
        },
      })}\n`,
    )

    const db = openWorkbenchDatabase(workbenchDatabasePath(workbenchRoot))
    db.prepare(
      `INSERT INTO pipeline_runs (
        id, name, source_mode, status, config_json, stats_json, logs_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'run-1',
      '完整任务 1',
      'txt2img',
      'failed',
      '{}',
      '{}',
      JSON.stringify([
        {
          level: 'error',
          message: '标题失败',
          details: {
            xlsxPath: outputPath,
            prompt: fullPrompt,
            skill: { id: 'skill-title', systemPrompt: skillPrompt },
          },
        },
      ]),
      123,
    )
    db.prepare(
      `INSERT INTO workflow_steps (
        id, task_id, module, step, status, attempt, params_snapshot, error_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'ps-step-1',
      'ps-task-1',
      'photoshop',
      'mockup',
      'failed',
      1,
      JSON.stringify({ mockup_path: localImagePath, prompt_snapshot: fullPrompt }),
      JSON.stringify({ outputPath, skill: { systemPrompt: skillPrompt } }),
      123,
    )
    db.close()

    const zipPath = join(workbenchRoot, 'diagnostic.zip')
    await exportDiagnosticLogZip({ outputPath: zipPath, workbenchRoot })

    const entries = readZip(await readFile(zipPath))
    const exportedText = Array.from(entries.values()).join('\n')

    expect(exportedText).not.toContain(workbenchRoot)
    expect(exportedText).not.toContain(localImagePath)
    expect(exportedText).not.toContain(outputPath)
    expect(exportedText).not.toContain(diagnosticLogPath)
    expect(exportedText).not.toContain(fullPrompt)
    expect(exportedText).not.toContain(skillPrompt)
    expect(exportedText).toContain('"redacted":"local-path"')
    expect(exportedText).toContain('"redacted":"prompt"')
    expect(exportedText).toContain('"redacted":"skill"')
  })
})

function readZip(buffer: Buffer) {
  const entries = new Map<string, string>()
  let offset = 0

  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8')
    const dataStart = nameStart + nameLength + extraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    const data = method === 0 ? compressed : inflateRawSync(compressed)
    entries.set(name, data.toString('utf8'))
    offset = dataStart + compressedSize
  }

  return entries
}
