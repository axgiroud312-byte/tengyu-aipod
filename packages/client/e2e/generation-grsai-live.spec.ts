import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'
import sharp from 'sharp'

type LiveRunResult = {
  taskId: string
  total: number
  succeeded: number
  failed: number
  images: unknown[]
  failures: unknown[]
}

type LivePromptCase = {
  label: string
  capability: 'txt2img' | 'img2img'
  prompt: string
  sendReference: boolean
}

const liveRunId =
  process.env.TENGYU_LIVE_GENERATION_RUN_ID ??
  new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)

const runLiveGeneration = process.env.TENGYU_LIVE_GENERATION === '1'
const workbenchRoot =
  process.env.TENGYU_LIVE_WORKBENCH_ROOT ?? join(homedir(), 'Documents', '腾域aipod工作区')
const referencePath = join(
  workbenchRoot,
  '.workbench',
  `live-generation-reference-${liveRunId}.png`,
)
const reportPath = join(workbenchRoot, '.workbench', `live-generation-report-${liveRunId}.json`)

test.describe('generation Grsai live E2E', () => {
  test.skip(!runLiveGeneration, 'TENGYU_LIVE_GENERATION=1 is required for live generation tests')
  test.setTimeout(45 * 60_000)

  let app: ElectronApplication | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => null)
    app = null
  })

  test('runs live skill, LLM 1000-prompt, txt2img, and img2img matrix', async () => {
    await createReferenceImage(referencePath)
    const referenceBase64 = (await readFile(referencePath)).toString('base64')
    const referenceImage = { base64: referenceBase64, mime_type: 'image/png' }

    app = await launchLiveApp()
    const page = await app.firstWindow()
    await prepareLiveApp(page, workbenchRoot)

    const skills = await page.evaluate(async () => {
      const refresh = await window.api.skill.refresh()
      const list = await window.api.skill.list({ module: 'generation' })
      const txt2img = await window.api.skill.get({ id: 'txt2img-local-print', version: '1.0.0' })
      const img2img = await window.api.skill.get({
        id: 'img2img-local-reference',
        version: '1.0.0',
      })
      const extract = await window.api.skill.get({ id: 'extract-paid-model', version: '1.0.0' })
      return {
        refresh,
        ids: list.map((skill) => skill.id),
        prompts: [txt2img.systemPrompt, img2img.systemPrompt, extract.systemPrompt],
      }
    })
    expect(skills.refresh.ok).toBe(true)
    expect(skills.ids).toEqual(
      expect.arrayContaining([
        'txt2img-local-print',
        'txt2img-full-print',
        'img2img-local-reference',
        'img2img-full-reference',
        'extract-paid-model',
      ]),
    )
    expect(skills.prompts.every((prompt) => prompt.trim().length > 0)).toBe(true)

    const thousandPrompts = await page.evaluate(() =>
      window.api.generation.generatePrompts({
        capability: 'txt2img',
        printMode: 'local',
        requirement: 'live automation test batch, simple commercial-safe decorative print prompts',
        count: 1000,
      }),
    )
    expect(thousandPrompts).toHaveLength(1000)

    const txtLocal = await generateOnePrompt(page, {
      capability: 'txt2img',
      printMode: 'local',
      requirement: 'live local print, vintage floral badge',
    })
    const txtFull = await generateOnePrompt(page, {
      capability: 'txt2img',
      printMode: 'full',
      requirement: 'live full repeat print, small botanical pattern',
    })

    const imgPrompts = {
      layout: await generateOnePrompt(page, {
        capability: 'img2img',
        printMode: 'local',
        requirement: 'live img2img layout reference, new flower content',
        modeInstruction: 'Use the reference image composition only. Create a new print.',
        referenceImages: [referenceImage],
      }),
      style: await generateOnePrompt(page, {
        capability: 'img2img',
        printMode: 'local',
        requirement: 'live img2img style reference, new flower content',
        modeInstruction: 'Use the reference image style only. Create a new print.',
        referenceImages: [referenceImage],
      }),
      layoutStyle: await generateOnePrompt(page, {
        capability: 'img2img',
        printMode: 'local',
        requirement: 'live img2img composition and style reference, new flower content',
        modeInstruction: 'Use the reference image composition and style. Create a new print.',
        referenceImages: [referenceImage],
      }),
      manual: 'live manual img2img prompt, clean centered floral print on white background',
    }

    const cases: LivePromptCase[] = [
      { label: 'txt2img-local', capability: 'txt2img', prompt: txtLocal, sendReference: false },
      { label: 'txt2img-full', capability: 'txt2img', prompt: txtFull, sendReference: false },
      {
        label: 'img2img-layout-off',
        capability: 'img2img',
        prompt: imgPrompts.layout,
        sendReference: false,
      },
      {
        label: 'img2img-layout-on',
        capability: 'img2img',
        prompt: imgPrompts.layout,
        sendReference: true,
      },
      {
        label: 'img2img-style-off',
        capability: 'img2img',
        prompt: imgPrompts.style,
        sendReference: false,
      },
      {
        label: 'img2img-style-on',
        capability: 'img2img',
        prompt: imgPrompts.style,
        sendReference: true,
      },
      {
        label: 'img2img-layout-style-off',
        capability: 'img2img',
        prompt: imgPrompts.layoutStyle,
        sendReference: false,
      },
      {
        label: 'img2img-layout-style-on',
        capability: 'img2img',
        prompt: imgPrompts.layoutStyle,
        sendReference: true,
      },
      {
        label: 'img2img-manual-off',
        capability: 'img2img',
        prompt: imgPrompts.manual,
        sendReference: false,
      },
      {
        label: 'img2img-manual-on',
        capability: 'img2img',
        prompt: imgPrompts.manual,
        sendReference: true,
      },
    ]

    const results: Array<LivePromptCase & { result: LiveRunResult }> = []
    for (const item of cases) {
      const result = await runGeneration(page, {
        capability: item.capability,
        prompts: [item.prompt],
        model: 'gpt-image-2',
        aspectRatio: '1024x1024',
        concurrency: 1,
        ...(item.sendReference ? { referenceImages: [referenceImage] } : {}),
      })
      expect(result).toMatchObject({ total: 1, succeeded: 1, failed: 0 })
      results.push({ ...item, result })
    }

    await writeFile(
      reportPath,
      JSON.stringify(
        {
          runId: liveRunId,
          workbenchRoot,
          referencePath,
          thousandPromptCount: thousandPrompts.length,
          skills,
          results,
        },
        null,
        2,
      ),
      'utf8',
    )
  })
})

async function launchLiveApp() {
  return electron.launch({
    args: ['out/main/index.js'],
    cwd: process.cwd(),
    timeout: 30_000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  })
}

async function prepareLiveApp(page: Page, root: string) {
  await page.evaluate(
    async ({ workbenchRoot, bailianApiKey, grsaiApiKey }) => {
      await window.api.onboarding.saveWorkbenchRoot(workbenchRoot)
      if (bailianApiKey || grsaiApiKey) {
        await window.api.onboarding.saveApiKeys({
          ...(bailianApiKey ? { bailian: bailianApiKey } : {}),
          ...(grsaiApiKey ? { grsai: grsaiApiKey } : {}),
        })
      }
      await window.api.onboarding.complete()

      const [hasBailian, hasGrsai] = await Promise.all([
        window.api.keychain.has('bailian'),
        window.api.keychain.has('grsai'),
      ])
      if (!hasBailian || !hasGrsai) {
        throw new Error(`live API keys missing: bailian=${hasBailian} grsai=${hasGrsai}`)
      }
      try {
        await window.api.generationSettings.get()
      } catch (error) {
        throw new Error(
          [
            'live API keys exist but cannot be decrypted by this Electron test process',
            'set TENGYU_LIVE_BAILIAN_API_KEY and TENGYU_LIVE_GRSAI_API_KEY to inject fresh keys',
            error instanceof Error ? error.message : String(error),
          ].join(': '),
        )
      }
    },
    {
      workbenchRoot: root,
      bailianApiKey: process.env.TENGYU_LIVE_BAILIAN_API_KEY ?? '',
      grsaiApiKey: process.env.TENGYU_LIVE_GRSAI_API_KEY ?? '',
    },
  )
}

async function generateOnePrompt(
  page: Page,
  input: Parameters<Window['api']['generation']['generatePrompts']>[0],
) {
  const prompts = await page.evaluate((promptInput) => {
    return window.api.generation.generatePrompts({ ...promptInput, count: 1 })
  }, input)
  const prompt = prompts[0]?.text.trim()
  if (!prompt) {
    throw new Error('live LLM did not return a prompt')
  }
  return prompt
}

async function runGeneration(
  page: Page,
  input: Parameters<Window['api']['generation']['runTxt2img']>[0],
) {
  return page.evaluate(async (runInput) => {
    return new Promise<Awaited<ReturnType<Window['api']['generation']['runTxt2img']>>>(
      (resolve, reject) => {
        let taskId = ''
        const timer = window.setTimeout(() => {
          offCompleted()
          reject(new Error('live generation task timed out'))
        }, 8 * 60_000)
        const offCompleted = window.api.generation.onCompleted((event) => {
          const eventTaskId = event.ok ? event.result.taskId : event.taskId
          if (taskId && eventTaskId !== taskId) {
            return
          }

          window.clearTimeout(timer)
          offCompleted()
          if (event.ok) {
            resolve(event.result)
            return
          }
          reject(new Error(event.error))
        })
        window.api.generation
          .runTxt2img(runInput)
          .then((nextTaskId) => {
            taskId = nextTaskId
          })
          .catch((error) => {
            window.clearTimeout(timer)
            offCompleted()
            reject(error)
          })
      },
    )
  }, input)
}

async function createReferenceImage(path: string) {
  await mkdir(dirname(path), { recursive: true })
  await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 236, g: 242, b: 231, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg"><circle cx="128" cy="128" r="72" fill="#d45b6a"/><circle cx="96" cy="104" r="24" fill="#f2c14e"/><circle cx="160" cy="104" r="24" fill="#6aa84f"/></svg>',
        ),
      },
    ])
    .png()
    .toFile(path)
}
