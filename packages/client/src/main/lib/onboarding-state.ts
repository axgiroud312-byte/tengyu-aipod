import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'

const SETUP_STATE_FILE_NAME = 'setup-state.json'

export interface OnboardingStateFile {
  completed_at?: string
}

function setupStatePath() {
  return join(app.getPath('userData'), SETUP_STATE_FILE_NAME)
}

function defaultState(): OnboardingStateFile {
  return {}
}

async function readJsonState(path: string): Promise<OnboardingStateFile | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<OnboardingStateFile>
    return { ...(parsed.completed_at ? { completed_at: parsed.completed_at } : {}) }
  } catch {
    return null
  }
}

export async function readOnboardingStateFile() {
  return (await readJsonState(setupStatePath())) ?? defaultState()
}

export async function updateOnboardingStateFile(
  updater: (state: OnboardingStateFile) => OnboardingStateFile | Promise<OnboardingStateFile>,
) {
  const current = await readOnboardingStateFile()
  const next = await updater(current)
  await mkdir(dirname(setupStatePath()), { recursive: true })
  await writeFile(setupStatePath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

export async function markOnboardingComplete() {
  return updateOnboardingStateFile((state) => ({
    ...state,
    completed_at: state.completed_at ?? new Date().toISOString(),
  }))
}
