import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'

const SECRETS_FILE_NAME = 'secrets.json'
const PLAIN_PREFIX = 'plain:'
const ENCRYPTED_PREFIX = 'safe:'

function secretsPath() {
  return join(app.getPath('userData'), SECRETS_FILE_NAME)
}

async function readStore(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(secretsPath(), 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

async function writeStore(store: Record<string, string>) {
  await mkdir(dirname(secretsPath()), { recursive: true })
  await writeFile(secretsPath(), JSON.stringify(store, null, 2), 'utf8')
}

function encryptionAvailable() {
  return safeStorage.isEncryptionAvailable()
}

function encodeSecret(value: string) {
  if (!encryptionAvailable()) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('safeStorage not available; falling back to plain secret storage in development')
      return `${PLAIN_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`
    }

    throw new Error('safeStorage encryption is not available')
  }

  return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
}

function decodeSecret(value: string) {
  if (value.startsWith(PLAIN_PREFIX)) {
    return Buffer.from(value.slice(PLAIN_PREFIX.length), 'base64').toString('utf8')
  }

  const encrypted = value.startsWith(ENCRYPTED_PREFIX)
    ? value.slice(ENCRYPTED_PREFIX.length)
    : value

  if (!encryptionAvailable()) {
    throw new Error('safeStorage encryption is not available')
  }

  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

export async function setSecret(key: string, value: string) {
  const store = await readStore()
  store[key] = encodeSecret(value)
  await writeStore(store)
}

export async function getSecret(key: string) {
  const store = await readStore()
  const value = store[key]
  if (!value) {
    return null
  }

  return decodeSecret(value)
}

export async function deleteSecret(key: string) {
  const store = await readStore()
  delete store[key]
  await writeStore(store)
}

export async function hasSecret(key: string) {
  const store = await readStore()
  return Boolean(store[key])
}
