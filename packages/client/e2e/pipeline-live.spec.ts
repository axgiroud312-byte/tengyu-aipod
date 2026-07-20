import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { type ElectronApplication, type Page, _electron as electron, test } from '@playwright/test'
import {
  type PipelineRunConfig,
  type PipelineRunStats,
  type PipelineRunStatus,
  type PipelineStepKey,
  sanitizeTemplateName,
} from '@tengyu-aipod/shared'
import ExcelJS from 'exceljs'
import sharp from 'sharp'
import { openSqliteDatabase } from '../src/main/lib/sqlite'

type LiveProvider = 'grsai' | 'comfyui-chenyu'
type LiveSourceMode = 'txt2img' | 'img2img'
type LiveFailureKind =
  | 'preflight-config'
  | 'preflight-api'
  | 'pipeline-start'
  | 'pipeline-status'
  | 'stall'
  | 'timeout'
  | 'database-check'
  | 'xlsx-check'
  | 'image-check'
  | 'cleanup-check'

type LiveRound = {
  id: `R${string}`
  provider: LiveProvider
  sourceMode: LiveSourceMode
  templateFile: string
}

type SafeStepSnapshot = {
  stepKey: PipelineStepKey
  status: string
  inputCount: number
  outputCount: number
  startedAt: number | null
  completedAt: number | null
  updatedAt: number
}

type SafeItemSnapshot = {
  stepKey: PipelineStepKey
  status: string
  printId: string | null
  artifactId: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

type SafeRunSnapshot = {
  run: {
    id: string
    status: PipelineRunStatus
    createdAt: number
    startedAt: number | null
    completedAt: number | null
  }
  stats: PipelineRunStats
  steps: SafeStepSnapshot[]
  items: SafeItemSnapshot[]
}

type LivePreflight = {
  generationSkillVersions: Record<'txt2img-local-print' | 'img2img-local-reference', string>
  textModel: string
  visionModel: string
  chenyuInstanceUuid: string
  workflows: {
    txt2img: { id: string; name: string; version: string }
    img2img: { id: string; name: string; version: string }
  }
}

type ArtifactSummary = {
  sourceItems: number
  waitingImages: number
  productImages: number
  printIds: number
  titleRows: number
  databaseMatched: boolean
  temporaryEntriesRemaining: number
  pendingTitleWrites: number
}

type LiveReport = {
  schemaVersion: 2
  round: string
  runId: string
  printId: string | null
  skuPrefix: string
  skuCode: string
  provider: LiveProvider
  sourceMode: LiveSourceMode
  template: string
  status: PipelineRunStatus | 'unknown'
  failureKind: LiveFailureKind | null
  startedAt: string
  completedAt: string
  durationMs: number | null
  stageDurationMs: Record<'source' | 'photoshop' | 'title', number | null>
  stats: PipelineRunStats | null
  stepStatuses: Partial<Record<PipelineStepKey, string>>
  itemStatuses: Record<string, number>
  artifacts: ArtifactSummary | null
}

type TempBaseline = {
  photoshop: Set<string>
  title: Set<string>
}

type WaitResult = {
  failureKind: Extract<LiveFailureKind, 'pipeline-status' | 'stall' | 'timeout'> | null
  snapshot: SafeRunSnapshot | null
}

type LiveAppState = {
  app: ElectronApplication
  page: Page
  runId: string | null
  snapshot: SafeRunSnapshot | null
}

const RUN_LIVE_PIPELINE = process.env.TENGYU_LIVE_PIPELINE === '1'
const ROUND_FILTER = process.env.TENGYU_LIVE_PIPELINE_ROUND?.trim().toUpperCase() ?? ''
const WORKBENCH_ROOT = join(homedir(), 'Desktop', 'pod套版测试')
const TEMPLATE_ROOT = join(homedir(), 'Desktop', '定制模板')
const REFERENCE_FOLDER = join(
  WORKBENCH_ROOT,
  '02-印花工作区',
  '文生图',
  '5bae9e45-87c3-4e58-a3c5-7c4c07d05572-txt2img-4',
)
const REFERENCE_IMAGE = join(REFERENCE_FOLDER, '2222-0001.png')
const STALE_RUN_ID = 'b566c604-5105-4d27-a8e6-ea649a783a48'
const TXT2IMG_WORKFLOW_ID = 'txt2img-文生图api-1-07d2e50b'
const IMG2IMG_WORKFLOW_ID = 'img2img-图生图api-1-1-b94e7fd6'
const ROUND_TIMEOUT_MS = 45 * 60_000
const STALL_TIMEOUT_MS = 10 * 60_000
const CANCEL_SETTLE_TIMEOUT_MS = 2 * 60_000
const POLL_INTERVAL_MS = 2_000
const FILE_TIME_TOLERANCE_MS = 2_000
const IPC_TIMEOUT_MS = 30_000
const STATUS_IPC_TIMEOUT_MS = 10_000
const APP_RESTART_TIMEOUT_MS = 30_000
const TERMINAL_STATUSES = new Set<PipelineRunStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
])
const EMPTY_STATS: PipelineRunStats = {
  sourceImages: 0,
  prints: 0,
  detectionPass: 0,
  detectionReview: 0,
  detectionBlock: 0,
  photoshopGroups: 0,
  titleSucceeded: 0,
  titleFailed: 0,
}

const ALL_ROUNDS: LiveRound[] = [
  { id: 'R01', provider: 'grsai', sourceMode: 'txt2img', templateFile: '粉色.psd' },
  { id: 'R02', provider: 'grsai', sourceMode: 'txt2img', templateFile: '粉色.psd' },
  { id: 'R03', provider: 'grsai', sourceMode: 'img2img', templateFile: '碧绿色.psd' },
  { id: 'R04', provider: 'grsai', sourceMode: 'img2img', templateFile: '碧绿色.psd' },
  { id: 'R05', provider: 'comfyui-chenyu', sourceMode: 'txt2img', templateFile: '绿色.psd' },
  { id: 'R06', provider: 'comfyui-chenyu', sourceMode: 'txt2img', templateFile: '绿色.psd' },
  { id: 'R07', provider: 'comfyui-chenyu', sourceMode: 'img2img', templateFile: '灰色.psd' },
  { id: 'R08', provider: 'comfyui-chenyu', sourceMode: 'img2img', templateFile: '灰色.psd' },
  { id: 'R09', provider: 'grsai', sourceMode: 'txt2img', templateFile: '黄色.psd' },
  { id: 'R10', provider: 'grsai', sourceMode: 'txt2img', templateFile: '黄色.psd' },
]

const SELECTED_ROUNDS = ROUND_FILTER
  ? ALL_ROUNDS.filter((round) => round.id === ROUND_FILTER)
  : ALL_ROUNDS

if (ROUND_FILTER && SELECTED_ROUNDS.length === 0) {
  throw new Error(`Unknown live pipeline round: ${ROUND_FILTER}`)
}

class LivePipelineFailure extends Error {
  constructor(readonly kind: LiveFailureKind) {
    super(kind)
  }
}

class LiveOperationTimeout extends Error {}

test.describe
  .serial('complete pipeline live E2E', () => {
    test.skip(!RUN_LIVE_PIPELINE, 'TENGYU_LIVE_PIPELINE=1 is required for live pipeline tests')
    test.setTimeout(
      ROUND_TIMEOUT_MS +
        CANCEL_SETTLE_TIMEOUT_MS +
        APP_RESTART_TIMEOUT_MS * 2 +
        STATUS_IPC_TIMEOUT_MS * 2 +
        60_000,
    )

    let app: ElectronApplication | null = null
    let page: Page
    let preflight: LivePreflight
    const observedPrintIds = new Set<string>()

    test.beforeAll(async () => {
      await validateLocalInputs()
      try {
        app = await launchLiveApp()
        page = await withTimeout(app.firstWindow(), APP_RESTART_TIMEOUT_MS)
        await assertStaleRunInterrupted(page)
        preflight = await readLivePreflight(page)
      } catch (error) {
        if (app) {
          await closeLiveApp(app).catch(() => null)
        }
        app = null
        if (error instanceof LivePipelineFailure) {
          throw error
        }
        throw new LivePipelineFailure('preflight-api')
      }
    })

    test.afterAll(async () => {
      if (app) {
        await closeLiveApp(app).catch(() => null)
      }
      app = null
    })

    for (const round of SELECTED_ROUNDS) {
      test(`${round.id} ${round.provider} ${round.sourceMode}`, async () => {
        const startedAt = new Date()
        const skuPrefix = `CTREAL-20260719-${round.id}`
        const skuCode = `${skuPrefix}-0001`
        const templatePath = join(TEMPLATE_ROOT, round.templateFile)
        const tempBaseline = await readTempBaseline()
        const reportedPrintIds = await readReportedPrintIds(round)
        const historicalPrintIds = readHistoricalSourcePrintIds()
        let runId = `not-started-${round.id}-${randomUUID().slice(0, 8)}`
        let snapshot: SafeRunSnapshot | null = null
        let artifacts: ArtifactSummary | null = null
        let failureKind: LiveFailureKind | null = null
        let pipelineStarted = false
        let printId: string | null = null

        try {
          const config = await buildRoundConfig(round, preflight, skuPrefix, templatePath)
          try {
            runId = await withTimeout(
              page.evaluate((input) => window.api.pipeline.run(input), config),
              IPC_TIMEOUT_MS,
            )
            pipelineStarted = true
          } catch {
            let recovered: LiveAppState
            try {
              recovered = await recoverUnknownStart(
                requireValue(app, 'cleanup-check'),
                `真实完整任务 ${round.id}`,
                startedAt.getTime(),
              )
            } catch {
              throw new LivePipelineFailure('cleanup-check')
            }
            app = recovered.app
            page = recovered.page
            snapshot = recovered.snapshot
            if (recovered.runId) {
              runId = recovered.runId
              pipelineStarted = true
            }
            throw new LivePipelineFailure('pipeline-start')
          }

          const waitResult = await waitForTerminalRun(page, runId)
          snapshot = waitResult.snapshot
          if (waitResult.failureKind) {
            throw new LivePipelineFailure(waitResult.failureKind)
          }
          if (!snapshot || snapshot.run.status !== 'completed') {
            throw new LivePipelineFailure('pipeline-status')
          }
          printId = assertRunContract(snapshot)
          requireLive(!observedPrintIds.has(printId), 'pipeline-status')
          requireLive(!reportedPrintIds.has(printId), 'pipeline-status')
          requireLive(!historicalPrintIds.has(printId), 'pipeline-status')
          observedPrintIds.add(printId)
          artifacts = await validateArtifacts({
            round,
            runId,
            skuCode,
            snapshot,
            tempBaseline,
            templatePath,
          })
        } catch (error) {
          const originalFailureKind =
            error instanceof LivePipelineFailure ? error.kind : ('pipeline-status' as const)
          if (pipelineStarted && (!snapshot || !TERMINAL_STATUSES.has(snapshot.run.status))) {
            try {
              const settled = await settleOrInterruptRun(
                requireValue(app, 'cleanup-check'),
                page,
                runId,
                snapshot,
              )
              app = settled.app
              page = settled.page
              snapshot = settled.snapshot
            } catch {
              failureKind = 'cleanup-check'
            }
          }
          failureKind ??= originalFailureKind
        }

        const report = createReport({
          artifacts,
          completedAt: new Date(),
          failureKind,
          round,
          runId,
          printId,
          skuCode,
          skuPrefix,
          snapshot,
          startedAt,
          templatePath,
        })
        await writeSafeReport(report)
        if (failureKind) {
          throw new LivePipelineFailure(failureKind)
        }
      })
    }
  })

async function launchLiveApp() {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  const sensitiveName = /(api.?key|token|secret|password|passwd|credential)/i
  const debugName = /(^|_)(debug|trace|verbose)($|_)/i
  for (const key of Object.keys(env)) {
    if (sensitiveName.test(key) || debugName.test(key)) {
      delete env[key]
    }
  }
  for (const key of [
    'TENGYU_ELECTRON_USER_DATA_DIR',
    'TENGYU_SERVER_URL',
    'TENGYU_PHP_AUTH_BASE_URL',
    'TENGYU_BAILIAN_BASE_URL',
    'TENGYU_GRSAI_CN_BASE_URL',
    'TENGYU_GRSAI_GLOBAL_BASE_URL',
    'ELECTRON_ENABLE_LOGGING',
    'ELECTRON_ENABLE_STACK_DUMPING',
    'NODE_DEBUG',
  ]) {
    delete env[key]
  }
  env.NODE_ENV = 'development'
  env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
  env.OPENAI_LOG = 'off'

  return electron.launch({
    args: ['out/main/index.js'],
    cwd: process.cwd(),
    env,
    timeout: 30_000,
  })
}

async function validateLocalInputs() {
  try {
    const referenceInfo = await stat(REFERENCE_IMAGE)
    requireLive(referenceInfo.isFile() && referenceInfo.size > 0, 'preflight-config')
    await assertDecodableImage(REFERENCE_IMAGE)
    for (const round of ALL_ROUNDS) {
      const templateInfo = await stat(join(TEMPLATE_ROOT, round.templateFile))
      requireLive(templateInfo.isFile() && templateInfo.size > 0, 'preflight-config')
    }
  } catch (error) {
    if (error instanceof LivePipelineFailure) {
      throw error
    }
    throw new LivePipelineFailure('preflight-config')
  }
}

async function assertStaleRunInterrupted(page: Page) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const result = await readSafeRunSnapshot(page, STALE_RUN_ID)
    if (!result.ok) {
      throw new LivePipelineFailure('preflight-api')
    }
    if (result.snapshot?.run.status === 'interrupted') {
      return
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw new LivePipelineFailure('preflight-config')
}

async function readLivePreflight(page: Page): Promise<LivePreflight> {
  const result = await withTimeout(
    page.evaluate(
      async ({ img2imgWorkflowId, txt2imgWorkflowId }) => {
        const skillRefresh = await window.api.skill.refresh()
        const [
          onboarding,
          auth,
          hasGrsai,
          hasBailian,
          hasChenyu,
          photoshop,
          generationSettings,
          generationSkills,
          titleSkills,
          txt2imgWorkflows,
          img2imgWorkflows,
          instances,
        ] = await Promise.all([
          window.api.onboarding.getState(),
          window.api.customerAuth.getState(),
          window.api.keychain.has('grsai'),
          window.api.keychain.has('bailian'),
          window.api.keychain.has('chenyu'),
          window.api.photoshop.getStatus(),
          window.api.generationSettings.get(),
          window.api.skill.list({ module: 'generation' }),
          window.api.skill.list({ module: 'title' }),
          window.api.generation.listComfyuiTxt2imgWorkflows(),
          window.api.generation.listComfyuiImg2imgWorkflows(),
          window.api.chenyu.listInstances(),
        ])
        const txt2imgSkill = generationSkills.find(
          (skill) => skill.id === 'txt2img-local-print' && skill.enabled,
        )
        const img2imgSkill = generationSkills.find(
          (skill) => skill.id === 'img2img-local-reference' && skill.enabled,
        )
        const titleSkill = titleSkills.find(
          (skill) =>
            skill.enabled &&
            ((['temu', 'temu_pop', 'temu_full'].includes(skill.platform ?? '') &&
              skill.language === 'en') ||
              (skill.platform === 'generic' && skill.language === 'generic')),
        )
        const txt2imgWorkflow = txt2imgWorkflows.find(
          (workflow) => workflow.id === txt2imgWorkflowId,
        )
        const img2imgWorkflow = img2imgWorkflows.find(
          (workflow) => workflow.id === img2imgWorkflowId,
        )
        const runningInstances = instances.filter(
          (instance) => instance.statusName === 'running' && Boolean(instance.comfyuiUrl),
        )
        const instance =
          runningInstances.find((candidate) => candidate.isCurrent) ?? runningInstances[0]

        return {
          authActive: auth.status === 'active',
          bailianConfigured: generationSettings.bailianKeyConfigured,
          grsaiConfigured: generationSettings.grsaiKeyConfigured,
          hasBailian,
          hasChenyu,
          hasGrsai,
          imageModelAvailable: generationSettings.grsaiModels.some(
            (model) => model.id === 'gpt-image-2',
          ),
          img2imgSkillVersion: img2imgSkill?.version ?? '',
          img2imgWorkflow:
            img2imgWorkflow && img2imgWorkflow.detection.status === 'ready'
              ? {
                  id: img2imgWorkflow.id,
                  name: img2imgWorkflow.name,
                  version: img2imgWorkflow.version,
                }
              : null,
          instanceUuid: instance?.instanceUuid ?? '',
          needsOnboarding: onboarding.needs_onboarding,
          photoshopConnected: photoshop.installed && photoshop.running && photoshop.com_connected,
          skillRefreshOk: skillRefresh.ok,
          textModel: generationSettings.config.bailian_text_model,
          titleSkillAvailable: Boolean(titleSkill),
          txt2imgSkillVersion: txt2imgSkill?.version ?? '',
          txt2imgWorkflow:
            txt2imgWorkflow && txt2imgWorkflow.detection.status === 'ready'
              ? {
                  id: txt2imgWorkflow.id,
                  name: txt2imgWorkflow.name,
                  version: txt2imgWorkflow.version,
                }
              : null,
          visionModel: generationSettings.config.bailian_vision_model,
          workbenchRoot: onboarding.workbench_root,
        }
      },
      { img2imgWorkflowId: IMG2IMG_WORKFLOW_ID, txt2imgWorkflowId: TXT2IMG_WORKFLOW_ID },
    ),
    IPC_TIMEOUT_MS,
  )

  requireLive(result.authActive, 'preflight-config')
  requireLive(result.skillRefreshOk, 'preflight-api')
  requireLive(!result.needsOnboarding, 'preflight-config')
  requireLive(samePath(result.workbenchRoot, WORKBENCH_ROOT), 'preflight-config')
  requireLive(result.hasGrsai && result.hasBailian && result.hasChenyu, 'preflight-config')
  requireLive(result.grsaiConfigured && result.bailianConfigured, 'preflight-config')
  requireLive(result.photoshopConnected, 'preflight-config')
  requireLive(result.imageModelAvailable, 'preflight-config')
  requireLive(result.titleSkillAvailable, 'preflight-config')
  requireLive(Boolean(result.txt2imgSkillVersion), 'preflight-config')
  requireLive(Boolean(result.img2imgSkillVersion), 'preflight-config')
  requireLive(Boolean(result.textModel && result.visionModel), 'preflight-config')
  requireLive(Boolean(result.instanceUuid), 'preflight-config')
  requireLive(Boolean(result.txt2imgWorkflow && result.img2imgWorkflow), 'preflight-config')

  return {
    generationSkillVersions: {
      'img2img-local-reference': result.img2imgSkillVersion,
      'txt2img-local-print': result.txt2imgSkillVersion,
    },
    textModel: result.textModel,
    visionModel: result.visionModel,
    chenyuInstanceUuid: result.instanceUuid,
    workflows: {
      img2img: requireValue(result.img2imgWorkflow, 'preflight-config'),
      txt2img: requireValue(result.txt2imgWorkflow, 'preflight-config'),
    },
  }
}

async function buildRoundConfig(
  round: LiveRound,
  preflight: LivePreflight,
  skuPrefix: string,
  templatePath: string,
): Promise<PipelineRunConfig> {
  const prompt = {
    mode: 'ai' as const,
    requirement: 'Create one commercial-safe decorative apparel print.',
    count: 1,
    skillId: round.sourceMode === 'txt2img' ? 'txt2img-local-print' : 'img2img-local-reference',
    skillVersion:
      round.sourceMode === 'txt2img'
        ? preflight.generationSkillVersions['txt2img-local-print']
        : preflight.generationSkillVersions['img2img-local-reference'],
    model: round.sourceMode === 'txt2img' ? preflight.textModel : preflight.visionModel,
  }

  let source: PipelineRunConfig['source']
  if (round.provider === 'grsai' && round.sourceMode === 'txt2img') {
    source = {
      mode: 'txt2img',
      provider: 'grsai',
      prompt,
      grsai: { model: 'gpt-image-2', aspectRatio: '1024x1024', concurrency: 1 },
    }
  } else if (round.provider === 'grsai') {
    const referenceBuffer = await readFile(REFERENCE_IMAGE)
    source = {
      mode: 'img2img',
      provider: 'grsai',
      referenceImages: [
        {
          name: basename(REFERENCE_IMAGE),
          base64: referenceBuffer.toString('base64'),
          mime_type: 'image/png',
        },
      ],
      prompt,
      sendReferenceImages: true,
      grsai: { model: 'gpt-image-2', aspectRatio: '1024x1024', concurrency: 1 },
    }
  } else if (round.sourceMode === 'txt2img') {
    source = {
      mode: 'txt2img',
      provider: 'comfyui-chenyu',
      prompt,
      comfyui: {
        workflowId: preflight.workflows.txt2img.id,
        workflowName: preflight.workflows.txt2img.name,
        workflowVersion: preflight.workflows.txt2img.version,
        instanceUuid: preflight.chenyuInstanceUuid,
        width: 1024,
        height: 1024,
        concurrency: 1,
      },
    }
  } else {
    source = {
      mode: 'img2img',
      provider: 'comfyui-chenyu',
      sourceFolder: REFERENCE_FOLDER,
      prompt,
      comfyui: {
        workflowId: preflight.workflows.img2img.id,
        workflowName: preflight.workflows.img2img.name,
        workflowVersion: preflight.workflows.img2img.version,
        instanceUuid: preflight.chenyuInstanceUuid,
        width: 1024,
        height: 1024,
        batchSize: 1,
      },
    }
  }

  return {
    name: `真实完整任务 ${round.id}`,
    printSkuCode: skuPrefix,
    filenameSeparator: '-',
    printMode: 'local',
    source,
    matting: { enabled: false, mode: 'comfyui' },
    detection: { enabled: false },
    photoshop: {
      enabled: true,
      templates: [templatePath],
      outputRoot: join(WORKBENCH_ROOT, '04-上架工作区'),
      replaceRange: 'topmost',
      format: 'jpg',
      clipMode: 'auto',
      skipCompleted: false,
      maxRetries: 1,
    },
    title: {
      enabled: true,
      platform: 'temu',
      language: 'en',
      model: preflight.visionModel,
      titleFileName: '标题',
      imageIndex: 1,
      existingStrategy: 'regenerate',
      maxRetries: 2,
      concurrency: 1,
      preprocess: {
        maxSize: 1024,
        compression: true,
        format: 'jpg',
        quality: 85,
      },
    },
  }
}

async function waitForTerminalRun(page: Page, runId: string): Promise<WaitResult> {
  const startedAt = Date.now()
  let lastChangeAt = startedAt
  let lastFingerprint = ''
  let lastSnapshot: SafeRunSnapshot | null = null

  while (Date.now() - startedAt < ROUND_TIMEOUT_MS) {
    const readResult = await readSafeRunSnapshot(page, runId)
    if (!readResult.ok) {
      return { failureKind: 'pipeline-status', snapshot: lastSnapshot }
    }
    if (readResult.snapshot) {
      lastSnapshot = readResult.snapshot
      const fingerprint = snapshotFingerprint(readResult.snapshot)
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint
        lastChangeAt = Date.now()
      }
      if (TERMINAL_STATUSES.has(readResult.snapshot.run.status)) {
        return { failureKind: null, snapshot: readResult.snapshot }
      }
    }
    if (Date.now() - lastChangeAt >= STALL_TIMEOUT_MS) {
      return { failureKind: 'stall', snapshot: lastSnapshot }
    }
    await delay(POLL_INTERVAL_MS)
  }

  return { failureKind: 'timeout', snapshot: lastSnapshot }
}

async function cancelAndSettle(page: Page, runId: string, initialSnapshot: SafeRunSnapshot | null) {
  const deadline = Date.now() + CANCEL_SETTLE_TIMEOUT_MS
  let snapshot = initialSnapshot
  let lastCancelAttemptAt = 0
  while (Date.now() < deadline) {
    if (Date.now() - lastCancelAttemptAt >= 10_000) {
      lastCancelAttemptAt = Date.now()
      await withTimeout(
        page.evaluate((id) => window.api.pipeline.cancel({ run_id: id }), runId),
        STATUS_IPC_TIMEOUT_MS,
      ).catch(() => null)
    }
    const readResult = await readSafeRunSnapshot(page, runId)
    if (!readResult.ok) {
      await delay(POLL_INTERVAL_MS)
      continue
    }
    snapshot = readResult.snapshot ?? snapshot
    if (snapshot && TERMINAL_STATUSES.has(snapshot.run.status)) {
      return snapshot
    }
    await delay(POLL_INTERVAL_MS)
  }
  return snapshot
}

async function settleOrInterruptRun(
  app: ElectronApplication,
  page: Page,
  runId: string,
  initialSnapshot: SafeRunSnapshot | null,
): Promise<LiveAppState> {
  const cancelledSnapshot = await cancelAndSettle(page, runId, initialSnapshot)
  if (cancelledSnapshot && TERMINAL_STATUSES.has(cancelledSnapshot.run.status)) {
    return { app, page, runId, snapshot: cancelledSnapshot }
  }

  const restarted = await restartLiveApp(app)
  try {
    const terminalStatus = await waitForPersistedTerminalRun(runId)
    const refreshed = await readSafeRunSnapshot(restarted.page, runId)
    const fallbackSnapshot = cancelledSnapshot
      ? {
          ...cancelledSnapshot,
          run: { ...cancelledSnapshot.run, status: terminalStatus },
        }
      : null
    return {
      ...restarted,
      runId,
      snapshot: refreshed.ok ? (refreshed.snapshot ?? fallbackSnapshot) : fallbackSnapshot,
    }
  } catch (error) {
    await closeLiveApp(restarted.app).catch(() => null)
    throw error
  }
}

async function recoverUnknownStart(
  app: ElectronApplication,
  runName: string,
  startedAt: number,
): Promise<LiveAppState> {
  const restarted = await restartLiveApp(app)
  try {
    const persistedRun = findRecentPersistedRun(runName, startedAt - FILE_TIME_TOLERANCE_MS)
    if (!persistedRun) {
      return { ...restarted, runId: null, snapshot: null }
    }
    await waitForPersistedTerminalRun(persistedRun.id)
    const refreshed = await readSafeRunSnapshot(restarted.page, persistedRun.id)
    return {
      ...restarted,
      runId: persistedRun.id,
      snapshot: refreshed.ok ? refreshed.snapshot : null,
    }
  } catch (error) {
    await closeLiveApp(restarted.app).catch(() => null)
    throw error
  }
}

async function restartLiveApp(app: ElectronApplication) {
  await closeLiveApp(app)
  const restartedApp = await launchLiveApp()
  try {
    const restartedPage = await withTimeout(restartedApp.firstWindow(), APP_RESTART_TIMEOUT_MS)
    return { app: restartedApp, page: restartedPage }
  } catch (error) {
    await closeLiveApp(restartedApp).catch(() => null)
    throw error
  }
}

async function closeLiveApp(app: ElectronApplication) {
  try {
    await withTimeout(app.close(), STATUS_IPC_TIMEOUT_MS)
    return
  } catch {
    const process = app.process()
    if (process.exitCode === null) {
      process.kill()
      await withTimeout(
        new Promise<void>((resolveExit) => {
          if (process.exitCode !== null) {
            resolveExit()
            return
          }
          process.once('exit', () => resolveExit())
        }),
        STATUS_IPC_TIMEOUT_MS,
      )
    }
  }
}

function findRecentPersistedRun(runName: string, createdAfter: number) {
  const db = openSqliteDatabase(join(WORKBENCH_ROOT, '.workbench', 'workbench.db'))
  try {
    return db
      .prepare(
        `SELECT id, status
         FROM pipeline_runs
         WHERE name = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(runName, createdAfter) as { id: string; status: PipelineRunStatus } | undefined
  } finally {
    db.close()
  }
}

async function waitForPersistedTerminalRun(runId: string) {
  const deadline = Date.now() + APP_RESTART_TIMEOUT_MS
  while (Date.now() < deadline) {
    const db = openSqliteDatabase(join(WORKBENCH_ROOT, '.workbench', 'workbench.db'))
    try {
      const row = db.prepare('SELECT status FROM pipeline_runs WHERE id = ?').get(runId) as
        | { status: PipelineRunStatus }
        | undefined
      if (row && TERMINAL_STATUSES.has(row.status)) {
        return row.status
      }
    } finally {
      db.close()
    }
    await delay(POLL_INTERVAL_MS)
  }
  throw new LivePipelineFailure('cleanup-check')
}

async function readSafeRunSnapshot(page: Page, runId: string) {
  try {
    const snapshot = await withTimeout(
      page.evaluate(
        async ({ emptyStats, id }) => {
          const detail = await window.api.pipeline.getRun({ run_id: id })
          if (!detail) {
            return null
          }
          let stats = { ...emptyStats }
          try {
            const parsed = JSON.parse(detail.run.stats_json) as Partial<PipelineRunStats>
            stats = {
              sourceImages: Number(parsed.sourceImages ?? 0),
              prints: Number(parsed.prints ?? 0),
              detectionPass: Number(parsed.detectionPass ?? 0),
              detectionReview: Number(parsed.detectionReview ?? 0),
              detectionBlock: Number(parsed.detectionBlock ?? 0),
              photoshopGroups: Number(parsed.photoshopGroups ?? 0),
              titleSucceeded: Number(parsed.titleSucceeded ?? 0),
              titleFailed: Number(parsed.titleFailed ?? 0),
            }
          } catch {
            stats = { ...emptyStats }
          }
          return {
            run: {
              id: detail.run.id,
              status: detail.run.status,
              createdAt: detail.run.created_at,
              startedAt: detail.run.started_at,
              completedAt: detail.run.completed_at,
            },
            stats,
            steps: detail.steps.map((step) => ({
              stepKey: step.step_key,
              status: step.status,
              inputCount: step.input_count,
              outputCount: step.output_count,
              startedAt: step.started_at,
              completedAt: step.completed_at,
              updatedAt: step.updated_at,
            })),
            items: (detail.items ?? []).map((item) => ({
              stepKey: item.step_key,
              status: item.status,
              printId: item.print_id,
              artifactId: item.artifact_id,
              createdAt: item.created_at,
              updatedAt: item.updated_at,
              completedAt: item.completed_at,
            })),
          }
        },
        { emptyStats: EMPTY_STATS, id: runId },
      ),
      STATUS_IPC_TIMEOUT_MS,
    )
    return { ok: true as const, snapshot }
  } catch {
    return { ok: false as const, snapshot: null }
  }
}

function assertRunContract(snapshot: SafeRunSnapshot) {
  const steps = new Map(snapshot.steps.map((step) => [step.stepKey, step.status]))
  requireLive(steps.get('source') === 'completed', 'pipeline-status')
  requireLive(steps.get('matting') === 'skipped', 'pipeline-status')
  requireLive(steps.get('detection') === 'skipped', 'pipeline-status')
  requireLive(steps.get('photoshop') === 'completed', 'pipeline-status')
  requireLive(steps.get('title') === 'completed', 'pipeline-status')
  requireLive(
    !snapshot.items.some((item) => !['completed', 'skipped'].includes(item.status)),
    'pipeline-status',
  )
  requireLive(snapshot.stats.prints === 1, 'pipeline-status')
  requireLive(snapshot.stats.photoshopGroups === 1, 'pipeline-status')
  requireLive(snapshot.stats.titleSucceeded === 1, 'pipeline-status')
  requireLive(snapshot.stats.titleFailed === 0, 'pipeline-status')

  const sourceItems = snapshot.items.filter(
    (item) => item.stepKey === 'source' && item.status === 'completed',
  )
  requireLive(sourceItems.length === 1, 'pipeline-status')
  requireLive(Boolean(sourceItems[0]?.artifactId), 'pipeline-status')
  const printIds = new Set(snapshot.items.flatMap((item) => (item.printId ? [item.printId] : [])))
  requireLive(printIds.size === 1, 'pipeline-status')
  requireLive(
    Array.from(printIds).every((printId) => /^pri_[A-Za-z0-9_-]+$/.test(printId)),
    'pipeline-status',
  )
  requireLive(
    snapshot.items.filter((item) => item.stepKey === 'photoshop' && item.status === 'completed')
      .length === 1,
    'pipeline-status',
  )
  requireLive(
    snapshot.items.filter((item) => item.stepKey === 'title' && item.status === 'completed')
      .length === 1,
    'pipeline-status',
  )
  return requireValue(Array.from(printIds)[0], 'pipeline-status')
}

async function validateArtifacts(input: {
  round: LiveRound
  runId: string
  skuCode: string
  snapshot: SafeRunSnapshot
  tempBaseline: TempBaseline
  templatePath: string
}): Promise<ArtifactSummary> {
  const runStartedAt = requireValue(input.snapshot.run.startedAt, 'database-check')
  const sourceItem = requireValue(
    input.snapshot.items.find((item) => item.stepKey === 'source' && item.status === 'completed'),
    'database-check',
  )
  const sourceArtifactId = requireValue(sourceItem.artifactId, 'database-check')
  const sourcePrintId = requireValue(sourceItem.printId, 'database-check')
  const waitingDirectory = join(WORKBENCH_ROOT, '02-印花工作区', '等待套版', input.runId)
  const batchDirectory = join(
    WORKBENCH_ROOT,
    '04-上架工作区',
    sanitizeTemplateName(input.templatePath),
  )
  const skuDirectory = join(batchDirectory, input.skuCode)
  const waitingImages = await listImageFiles(waitingDirectory).catch(() => {
    throw new LivePipelineFailure('image-check')
  })
  requireLive(waitingImages.length === 1, 'image-check')
  const waitingImage = requireValue(waitingImages[0], 'image-check')
  requireLive(basename(waitingImage, extname(waitingImage)) === input.skuCode, 'image-check')
  await assertFreshFile(waitingImage, runStartedAt, 'image-check')
  await assertDecodableImage(waitingImage)

  const productImages = (
    await listImageFiles(skuDirectory).catch(() => {
      throw new LivePipelineFailure('image-check')
    })
  ).filter((path) => ['.jpg', '.jpeg'].includes(extname(path).toLowerCase()))
  requireLive(productImages.length > 0, 'image-check')
  for (const imagePath of productImages) {
    await assertFreshFile(imagePath, runStartedAt, 'image-check')
    await assertDecodableImage(imagePath)
  }

  const workbookPath = join(batchDirectory, '标题.xlsx')
  const expectedSkuCodes = expectedTemplateSkuCodes(input.round)
  const workbookTitles = await validateTitleWorkbook(workbookPath, expectedSkuCodes, runStartedAt)
  const { pendingTitleWrites, sourceArtifactPath } = await validateDatabase({
    expectedArtifactId: sourceArtifactId,
    expectedPrintId: sourcePrintId,
    expectedTitles: workbookTitles,
    expectedXlsxPath: workbookPath,
    round: input.round,
    runId: input.runId,
    skuCode: input.skuCode,
    startedAt: runStartedAt,
    templateBatch: sanitizeTemplateName(input.templatePath),
  })
  await assertFreshFile(sourceArtifactPath, runStartedAt, 'image-check')
  await assertDecodableImage(sourceArtifactPath)

  const tempAfter = await readTempBaseline()
  const temporaryEntriesRemaining =
    setDifferenceSize(tempAfter.photoshop, input.tempBaseline.photoshop) +
    setDifferenceSize(tempAfter.title, input.tempBaseline.title)
  requireLive(temporaryEntriesRemaining === 0, 'cleanup-check')

  requireLive((await findRunCancelFlags(input.runId)).length === 0, 'cleanup-check')

  return {
    sourceItems: input.snapshot.items.filter(
      (item) => item.stepKey === 'source' && item.status === 'completed',
    ).length,
    waitingImages: waitingImages.length,
    productImages: productImages.length,
    printIds: new Set(input.snapshot.items.flatMap((item) => (item.printId ? [item.printId] : [])))
      .size,
    titleRows: expectedSkuCodes.length,
    databaseMatched: true,
    temporaryEntriesRemaining,
    pendingTitleWrites,
  }
}

async function validateTitleWorkbook(
  xlsxPath: string,
  expectedSkuCodes: string[],
  startedAt: number,
) {
  try {
    await assertFreshFile(xlsxPath, startedAt, 'xlsx-check')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsxPath)
    const sheet = workbook.worksheets[0]
    requireLive(Boolean(sheet), 'xlsx-check')
    const titlesBySku = new Map<string, string[]>()
    sheet?.eachRow((row) => {
      const skuCode = row.getCell(1).text.trim()
      if (!expectedSkuCodes.includes(skuCode)) {
        return
      }
      const titles = titlesBySku.get(skuCode) ?? []
      titles.push(row.getCell(2).text)
      titlesBySku.set(skuCode, titles)
    })
    const titles = new Map<string, string>()
    for (const skuCode of expectedSkuCodes) {
      const matchingTitles = titlesBySku.get(skuCode) ?? []
      requireLive(matchingTitles.length === 1, 'xlsx-check')
      const title = requireValue(matchingTitles[0], 'xlsx-check')
      requireLive(Boolean(title.trim()), 'xlsx-check')
      titles.set(skuCode, title)
    }
    return titles
  } catch (error) {
    if (error instanceof LivePipelineFailure) {
      throw error
    }
    throw new LivePipelineFailure('xlsx-check')
  }
}

async function validateDatabase(input: {
  expectedArtifactId: string
  expectedPrintId: string
  expectedTitles: ReadonlyMap<string, string>
  expectedXlsxPath: string
  round: LiveRound
  runId: string
  skuCode: string
  startedAt: number
  templateBatch: string
}) {
  const db = openSqliteDatabase(join(WORKBENCH_ROOT, '.workbench', 'workbench.db'))
  try {
    const run = db
      .prepare('SELECT status, stats_json, started_at FROM pipeline_runs WHERE id = ?')
      .get(input.runId) as
      | { status: string; stats_json: string; started_at: number | null }
      | undefined
    requireLive(run?.status === 'completed', 'database-check')
    requireLive(run.started_at === input.startedAt, 'database-check')
    const stats = JSON.parse(requireValue(run, 'database-check').stats_json) as PipelineRunStats
    requireLive(stats.prints === 1, 'database-check')
    requireLive(stats.photoshopGroups === 1, 'database-check')
    requireLive(stats.titleSucceeded === 1 && stats.titleFailed === 0, 'database-check')

    const steps = db
      .prepare('SELECT step_key, status FROM pipeline_steps WHERE run_id = ?')
      .all(input.runId) as Array<{ step_key: PipelineStepKey; status: string }>
    const stepStatuses = new Map(steps.map((step) => [step.step_key, step.status]))
    requireLive(stepStatuses.get('source') === 'completed', 'database-check')
    requireLive(stepStatuses.get('matting') === 'skipped', 'database-check')
    requireLive(stepStatuses.get('detection') === 'skipped', 'database-check')
    requireLive(stepStatuses.get('photoshop') === 'completed', 'database-check')
    requireLive(stepStatuses.get('title') === 'completed', 'database-check')

    const pendingTitleWrites = db
      .prepare('SELECT COUNT(*) AS count FROM pending_title_writes WHERE xlsx_path = ?')
      .get(input.expectedXlsxPath) as { count: number }
    requireLive(pendingTitleWrites.count === 0, 'database-check')

    const items = db
      .prepare(
        `SELECT step_key, status, print_id, artifact_id, output_path, created_at, completed_at
         FROM pipeline_items
         WHERE run_id = ?`,
      )
      .all(input.runId) as Array<{
      step_key: PipelineStepKey
      status: string
      print_id: string | null
      artifact_id: string | null
      output_path: string | null
      created_at: number
      completed_at: number | null
    }>
    requireLive(
      !items.some((item) => !['completed', 'skipped'].includes(item.status)),
      'database-check',
    )
    const printIds = new Set(items.flatMap((item) => (item.print_id ? [item.print_id] : [])))
    requireLive(printIds.size === 1, 'database-check')
    requireLive(
      Array.from(printIds).every((printId) => printId.startsWith('pri_')),
      'database-check',
    )

    const sourceItems = items.filter(
      (item) => item.step_key === 'source' && item.status === 'completed',
    )
    requireLive(sourceItems.length === 1, 'database-check')
    const sourceItem = requireValue(sourceItems[0], 'database-check')
    requireLive(sourceItem.artifact_id === input.expectedArtifactId, 'database-check')
    requireLive(sourceItem.print_id === input.expectedPrintId, 'database-check')
    requireLive(Boolean(sourceItem.output_path), 'database-check')
    requireLive(sourceItem.created_at >= input.startedAt, 'database-check')
    requireLive(
      sourceItem.completed_at !== null && sourceItem.completed_at >= input.startedAt,
      'database-check',
    )

    const artifact = db
      .prepare(
        `SELECT id, print_id, step, provider, model_or_workflow, file_path, created_at
         FROM artifacts
         WHERE id = ?`,
      )
      .get(input.expectedArtifactId) as
      | {
          id: string
          print_id: string | null
          step: string
          provider: string | null
          model_or_workflow: string | null
          file_path: string
          created_at: number
        }
      | undefined
    requireLive(artifact?.id === input.expectedArtifactId, 'database-check')
    requireLive(artifact.print_id === input.expectedPrintId, 'database-check')
    requireLive(artifact.step === input.round.sourceMode, 'database-check')
    requireLive(artifact.provider === input.round.provider, 'database-check')
    const expectedModelOrWorkflow =
      input.round.provider === 'grsai'
        ? 'gpt-image-2'
        : input.round.sourceMode === 'txt2img'
          ? TXT2IMG_WORKFLOW_ID
          : IMG2IMG_WORKFLOW_ID
    requireLive(artifact.model_or_workflow === expectedModelOrWorkflow, 'database-check')
    requireLive(samePath(sourceItem.output_path, artifact.file_path), 'database-check')
    requireLive(artifact.created_at >= input.startedAt, 'database-check')

    const skuStatement = db.prepare(
      `SELECT code, title, template_batch, language, platform, title_generated_at
       FROM skus
       WHERE code = ?`,
    )
    for (const [skuCode, expectedTitle] of input.expectedTitles) {
      const sku = skuStatement.get(skuCode) as
        | {
            code: string
            title: string | null
            template_batch: string | null
            language: string | null
            platform: string | null
            title_generated_at: number | null
          }
        | undefined
      requireLive(sku?.code === skuCode, 'database-check')
      requireLive(sku.title === expectedTitle, 'database-check')
      requireLive(Boolean(sku.title.trim()), 'database-check')
      requireLive(sku.template_batch === input.templateBatch, 'database-check')
      requireLive(sku.language === 'en' && sku.platform === 'temu', 'database-check')
      requireLive(sku.title_generated_at !== null, 'database-check')
      if (skuCode === input.skuCode) {
        requireLive(sku.title_generated_at >= input.startedAt, 'database-check')
      }
    }
    return {
      pendingTitleWrites: pendingTitleWrites.count,
      sourceArtifactPath: artifact.file_path,
    }
  } catch (error) {
    if (error instanceof LivePipelineFailure) {
      throw error
    }
    throw new LivePipelineFailure('database-check')
  } finally {
    db.close()
  }
}

function expectedTemplateSkuCodes(currentRound: LiveRound) {
  const currentRoundIndex = ALL_ROUNDS.findIndex((round) => round.id === currentRound.id)
  return ALL_ROUNDS.slice(0, currentRoundIndex + 1)
    .filter((round) => round.templateFile === currentRound.templateFile)
    .map((round) => `CTREAL-20260719-${round.id}-0001`)
}

async function assertDecodableImage(path: string) {
  try {
    const info = await stat(path)
    const metadata = await sharp(path).metadata()
    const pixelStats = await sharp(path).stats()
    requireLive(info.size > 0, 'image-check')
    requireLive(Number(metadata.width) >= 64 && Number(metadata.height) >= 64, 'image-check')
    requireLive(metadata.channels === 3 || metadata.channels === 4, 'image-check')
    requireLive(pixelStats.channels.length >= 3, 'image-check')
    requireLive(
      pixelStats.channels
        .slice(0, 3)
        .some((channel) => channel.max - channel.min >= 2 && channel.stdev >= 0.5),
      'image-check',
    )
  } catch (error) {
    if (error instanceof LivePipelineFailure) {
      throw error
    }
    throw new LivePipelineFailure('image-check')
  }
}

async function assertFreshFile(path: string, startedAt: number, kind: LiveFailureKind) {
  try {
    const info = await stat(path)
    requireLive(info.isFile() && info.size > 0, kind)
    requireLive(info.mtimeMs + FILE_TIME_TOLERANCE_MS >= startedAt, kind)
  } catch (error) {
    if (error instanceof LivePipelineFailure) {
      throw error
    }
    throw new LivePipelineFailure(kind)
  }
}

async function listImageFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listImageFiles(path)))
    } else if (
      entry.isFile() &&
      ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(path).toLowerCase())
    ) {
      files.push(path)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

async function readTempBaseline(): Promise<TempBaseline> {
  return {
    photoshop: await listDirectoryNames(join(WORKBENCH_ROOT, '.workbench', 'tmp', 'photoshop')),
    title: await listDirectoryNames(join(WORKBENCH_ROOT, '.workbench', 'tmp', 'title')),
  }
}

async function listDirectoryNames(directory: string) {
  try {
    return new Set((await readdir(directory, { withFileTypes: true })).map((entry) => entry.name))
  } catch (error) {
    if (filesystemErrorCode(error) === 'ENOENT') {
      return new Set<string>()
    }
    throw new LivePipelineFailure('cleanup-check')
  }
}

async function findRunCancelFlags(runId: string) {
  const root = join(WORKBENCH_ROOT, '.workbench', 'tmp', 'photoshop')
  try {
    const files = await listAllFiles(root)
    return files.filter(
      (path) => path.toLowerCase().endsWith('cancel.flag') && path.includes(runId),
    )
  } catch (error) {
    if (filesystemErrorCode(error) === 'ENOENT') {
      return []
    }
    throw new LivePipelineFailure('cleanup-check')
  }
}

async function listAllFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listAllFiles(path)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

async function readReportedPrintIds(currentRound: LiveRound) {
  const reportDirectory = join(WORKBENCH_ROOT, '.workbench')
  const currentRoundIndex = ALL_ROUNDS.findIndex((round) => round.id === currentRound.id)
  const requiredPriorRounds = new Set<string>(
    ALL_ROUNDS.slice(0, currentRoundIndex).map((round) => round.id),
  )
  const foundPriorRounds = new Set<string>()
  const printIds = new Set<string>()
  let entries: Dirent[]
  try {
    entries = await readdir(reportDirectory, { withFileTypes: true })
  } catch (error) {
    if (filesystemErrorCode(error) === 'ENOENT' && requiredPriorRounds.size === 0) {
      return printIds
    }
    throw new LivePipelineFailure('preflight-config')
  }

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith('real-pipeline-report-') ||
      !entry.name.endsWith('.json')
    ) {
      continue
    }
    try {
      const parsed = JSON.parse(
        await readFile(join(reportDirectory, entry.name), 'utf8'),
      ) as unknown
      if (!isSuccessfulPrintReport(parsed)) {
        continue
      }
      printIds.add(parsed.printId)
      if (requiredPriorRounds.has(parsed.round)) {
        foundPriorRounds.add(parsed.round)
      }
    } catch {
      throw new LivePipelineFailure('preflight-config')
    }
  }

  requireLive(
    Array.from(requiredPriorRounds).every((roundId) => foundPriorRounds.has(roundId)),
    'preflight-config',
  )
  return printIds
}

function readHistoricalSourcePrintIds() {
  const db = openSqliteDatabase(join(WORKBENCH_ROOT, '.workbench', 'workbench.db'))
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT print_id
         FROM pipeline_items
         WHERE step_key = 'source' AND print_id IS NOT NULL`,
      )
      .all() as Array<{ print_id: string }>
    return new Set(rows.map((row) => row.print_id))
  } finally {
    db.close()
  }
}

function isSuccessfulPrintReport(
  value: unknown,
): value is { schemaVersion: 2; round: string; printId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 2 &&
    'round' in value &&
    typeof value.round === 'string' &&
    'printId' in value &&
    typeof value.printId === 'string' &&
    /^pri_[A-Za-z0-9_-]+$/.test(value.printId) &&
    'status' in value &&
    value.status === 'completed' &&
    'failureKind' in value &&
    value.failureKind === null
  )
}

function createReport(input: {
  artifacts: ArtifactSummary | null
  completedAt: Date
  failureKind: LiveFailureKind | null
  round: LiveRound
  runId: string
  printId: string | null
  skuCode: string
  skuPrefix: string
  snapshot: SafeRunSnapshot | null
  startedAt: Date
  templatePath: string
}): LiveReport {
  const steps = new Map(input.snapshot?.steps.map((step) => [step.stepKey, step]) ?? [])
  const itemStatuses: Record<string, number> = {}
  for (const item of input.snapshot?.items ?? []) {
    const key = `${item.stepKey}:${item.status}`
    itemStatuses[key] = (itemStatuses[key] ?? 0) + 1
  }
  const stepStatuses: Partial<Record<PipelineStepKey, string>> = {}
  for (const [stepKey, step] of steps) {
    stepStatuses[stepKey] = step.status
  }
  return {
    schemaVersion: 2,
    round: input.round.id,
    runId: input.runId,
    printId: input.printId,
    skuPrefix: input.skuPrefix,
    skuCode: input.skuCode,
    provider: input.round.provider,
    sourceMode: input.round.sourceMode,
    template: basename(input.templatePath),
    status: input.snapshot?.run.status ?? 'unknown',
    failureKind: input.failureKind,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs:
      input.snapshot?.run.startedAt && input.snapshot.run.completedAt
        ? input.snapshot.run.completedAt - input.snapshot.run.startedAt
        : null,
    stageDurationMs: {
      source: stepDuration(steps.get('source')),
      photoshop: stepDuration(steps.get('photoshop')),
      title: stepDuration(steps.get('title')),
    },
    stats: input.snapshot?.stats ?? null,
    stepStatuses,
    itemStatuses,
    artifacts: input.artifacts,
  }
}

async function writeSafeReport(report: LiveReport) {
  const reportDirectory = join(WORKBENCH_ROOT, '.workbench')
  await mkdir(reportDirectory, { recursive: true })
  const safeRunId = report.runId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const reportPath = join(reportDirectory, `real-pipeline-report-${safeRunId}.json`)
  const temporaryPath = `${reportPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(report, null, 2), 'utf8')
    await rename(temporaryPath, reportPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => null)
  }
}

function snapshotFingerprint(snapshot: SafeRunSnapshot) {
  return JSON.stringify({
    status: snapshot.run.status,
    stats: snapshot.stats,
    steps: snapshot.steps.map((step) => [step.stepKey, step.status, step.updatedAt]),
    items: snapshot.items.map((item) => [item.stepKey, item.status, item.updatedAt]),
  })
}

function stepDuration(step: SafeStepSnapshot | undefined) {
  return step?.startedAt && step.completedAt ? step.completedAt - step.startedAt : null
}

function setDifferenceSize(current: Set<string>, baseline: Set<string>) {
  let count = 0
  for (const value of current) {
    if (!baseline.has(value)) {
      count += 1
    }
  }
  return count
}

function samePath(left: string | null, right: string) {
  if (!left) {
    return false
  }
  const normalize = (value: string) =>
    process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
  return normalize(left) === normalize(right)
}

function filesystemErrorCode(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null
}

function requireLive(condition: unknown, kind: LiveFailureKind): asserts condition {
  if (!condition) {
    throw new LivePipelineFailure(kind)
  }
}

function requireValue<T>(value: T | null | undefined, kind: LiveFailureKind): T {
  requireLive(value !== null && value !== undefined, kind)
  return value
}

function delay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new LiveOperationTimeout()), milliseconds)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
