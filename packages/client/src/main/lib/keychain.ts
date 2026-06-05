import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SECRETS_FILE_NAME = 'secrets.json'
const PLAIN_PREFIX = 'plain:'
const ENCRYPTED_PREFIX = 'safe:'
let storeWriteQueue = Promise.resolve()

type ElectronRuntime = {
  app: typeof import('electron').app
  safeStorage: typeof import('electron').safeStorage
}

async function electronRuntime(): Promise<ElectronRuntime> {
  const electron = await import('electron')
  if (!electron.app || !electron.safeStorage) {
    throw new Error('Electron keychain runtime is not available')
  }
  return {
    app: electron.app,
    safeStorage: electron.safeStorage,
  }
}

async function secretsPath() {
  const { app } = await electronRuntime()
  return join(app.getPath('userData'), SECRETS_FILE_NAME)
}

async function readStore(): Promise<Record<string, string>> {
  const path = await secretsPath()
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

async function writeStore(store: Record<string, string>) {
  const path = await secretsPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(store, null, 2), 'utf8')
}

function enqueueStoreWrite(operation: (store: Record<string, string>) => Promise<void>) {
  const next = storeWriteQueue.then(async () => {
    const store = await readStore()
    await operation(store)
    await writeStore(store)
  })
  storeWriteQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function encryptionAvailable(safeStorage: ElectronRuntime['safeStorage']) {
  return safeStorage.isEncryptionAvailable()
}

async function encodeSecret(value: string) {
  const { safeStorage } = await electronRuntime()
  if (!encryptionAvailable(safeStorage)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('safeStorage not available; falling back to plain secret storage in development')
      return `${PLAIN_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`
    }

    throw new Error('safeStorage encryption is not available')
  }

  return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
}

async function decodeSecret(value: string) {
  if (value.startsWith(PLAIN_PREFIX)) {
    return Buffer.from(value.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')
  }

  const encrypted = value.startsWith(ENCRYPTED_PREFIX)
    ? value.slice(ENCRYPTED_PREFIX.length)
    : value

  const { safeStorage } = await electronRuntime()
  if (!encryptionAvailable(safeStorage)) {
    throw new Error('safeStorage encryption is not available')
  }

  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

export async function setSecret(key: string, value: string) {
  await enqueueStoreWrite(async (store) => {
    store[key] = await encodeSecret(value)
  })
}

export async function setSecrets(entries: Record<string, string>) {
  await enqueueStoreWrite(async (store) => {
    for (const [key, value] of Object.entries(entries)) {
      store[key] = await encodeSecret(value)
    }
  })
}

export async function getSecret(key: string) {
  await storeWriteQueue
  const store = await readStore()
  const value = store[key]
  if (!value) {
    return null
  }

  return decodeSecret(value)
}

export async function deleteSecret(key: string) {
  await enqueueStoreWrite(async (store) => {
    delete store[key]
  })
}

export async function deleteSecrets(keys: string[]) {
  await enqueueStoreWrite(async (store) => {
    for (const key of keys) {
      delete store[key]
    }
  })
}

export async function hasSecret(key: string) {
  await storeWriteQueue
  const store = await readStore()
  return Boolean(store[key])
}
