import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKBENCH_DIRECTORIES } from '@tengyu-aipod/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChenyuWorkflowExecution } from './chenyu-cloud-client'
import { ChenyuWorkflowRunner } from './chenyu-workflow-runner'
import type { SqliteDatabase } from './sqlite'

type TestDatabase = Pick<SqliteDatabase, 'exec' | 'prepare' | 'close'>

class FakeDb {
  execCalls: string[] = []
  artifacts: unknown[][] = []
  closed = false

  exec(sql: string) {
    this.execCalls.push(sql)
  }

  prepare(sql: string) {
    return {
      run: (...values: unknown[]) => {
        if (sql.includes('INSERT INTO artifacts')) {
          this.artifacts.push(values)
        }
      },
      get: () => undefined,
    }
  }

  close() {
    this.closed = true
  }
}

let tempRoot = ''
let db: FakeDb

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'tengyu-chenyu-workflow-'))
  db = new FakeDb()
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function createRunner(input?: {
  executions?: Array<Pick<ChenyuWorkflowExecution, 'status' | 'outputs' | 'error'>>
  fetch?: typeof fetch
  now?: () => number
}) {
  const executions = input?.executions ?? [
    { status: 'running' },
    { status: 'succeeded', outputs: { n9_images: 'https://file.example/output.png' } },
  ]
  const chenyu = {
    listWorkflowMarket: vi.fn(async () => ({ items: [], total: 0 })),
    getWorkflowMarketInfo: vi.fn(async () => ({ workflow_id: 'wf-1', title: 'Workflow' })),
    submitWorkflowRun: vi.fn(async () => ({
      run_order_id: 'wfrun-1',
      workflow_id: 'wf-1',
      revision_id: 'rev-1',
    })),
    getWorkflowRunExecution: vi.fn(async () => {
      const next = executions.shift() ?? executions.at(-1) ?? { status: 'succeeded' }
      return {
        task_id: 'task-1',
        workflow_id: 'wf-1',
        progress_percent: next.status === 'succeeded' ? 100 : 50,
        error: null,
        ...next,
      }
    }),
  }

  return {
    chenyu,
    runner: new ChenyuWorkflowRunner({
      chenyu,
      workbenchRoot: tempRoot,
      openDatabase: () => db as unknown as TestDatabase,
      fetch:
        input?.fetch ??
        (vi.fn(async () => new Response(Buffer.from('image-bytes'))) as unknown as typeof fetch),
      sleep: async () => undefined,
      pollIntervalMs: 1,
      pollTimeoutMs: 10,
      now: input?.now ?? Date.now,
    }),
  }
}

describe('ChenyuWorkflowRunner', () => {
  it('submits, polls execution, downloads image outputs, and registers artifacts', async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from('image-bytes')))
    const { chenyu, runner } = createRunner({ fetch: fetchMock as unknown as typeof fetch })

    const result = await runner.runImageWorkflow({
      workflowId: 'wf-1',
      revisionId: 'rev-1',
      capability: 'txt2img',
      prompt: 'flower print',
      inputs: { n6_text: 'flower print' },
      idempotencyKey: 'idem-1',
      taskId: 'task-local',
    })

    expect(chenyu.submitWorkflowRun).toHaveBeenCalledWith({
      workflow_id: 'wf-1',
      revision_id: 'rev-1',
      inputs: { n6_text: 'flower print' },
      idempotency_key: 'idem-1',
    })
    expect(chenyu.getWorkflowRunExecution).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith('https://file.example/output.png')
    expect(result.images).toHaveLength(1)
    const firstImage = result.images[0]
    expect(firstImage).toBeDefined()
    if (!firstImage) {
      throw new Error('missing image')
    }
    expect(firstImage.local_path).toContain(
      join(WORKBENCH_DIRECTORIES.generation, '文生图', 'task-local'),
    )
    await expect(readFile(firstImage.local_path, 'utf8')).resolves.toBe('image-bytes')
    expect(db.artifacts).toHaveLength(1)
    expect(db.artifacts[0]).toEqual(
      expect.arrayContaining(['task-local', 'txt2img', 'comfyui-chenyu-workflow', 'wf-1']),
    )
    expect(db.closed).toBe(true)
  })

  it('downloads nested image output objects from execution results', async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from('nested-image')))
    const { runner } = createRunner({
      executions: [
        {
          status: 'succeeded',
          outputs: {
            images: {
              value: [
                { url: 'https://file.example/a.png' },
                { src: 'https://file.example/b.png' },
                { href: 'https://file.example/a.png' },
              ],
            },
          },
        },
      ],
      fetch: fetchMock as unknown as typeof fetch,
    })

    const result = await runner.runImageWorkflow({
      workflowId: 'wf-1',
      capability: 'txt2img',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://file.example/a.png')
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://file.example/b.png')
    expect(result.images).toHaveLength(2)
    expect(db.artifacts).toHaveLength(2)
  })

  it('throws when execution reaches failed status', async () => {
    const { runner } = createRunner({
      executions: [{ status: 'failed', error: { message: 'bad input' } }],
    })

    await expect(
      runner.runImageWorkflow({ workflowId: 'wf-1', capability: 'txt2img' }),
    ).rejects.toMatchObject({
      code: 'HTTP_5XX',
      message: 'bad input',
    })
  })

  it('throws when execution succeeds without image outputs', async () => {
    const { runner } = createRunner({
      executions: [{ status: 'succeeded', outputs: { text: 'not image' } }],
    })

    await expect(
      runner.runImageWorkflow({ workflowId: 'wf-1', capability: 'txt2img' }),
    ).rejects.toMatchObject({
      code: 'HTTP_5XX',
      message: '晨羽工作流未返回图片输出',
    })
  })

  it('times out while polling non-terminal execution', async () => {
    let now = 0
    const { runner } = createRunner({
      executions: [{ status: 'running' }, { status: 'running' }, { status: 'running' }],
      now: () => {
        now += 20
        return now
      },
    })

    await expect(
      runner.runImageWorkflow({ workflowId: 'wf-1', capability: 'txt2img' }),
    ).rejects.toMatchObject({
      code: 'NETWORK_TIMEOUT',
    })
  })
})
