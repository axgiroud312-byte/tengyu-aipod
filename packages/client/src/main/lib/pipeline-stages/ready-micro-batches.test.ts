import { describe, expect, it, vi } from 'vitest'
import { readyMicroBatches } from './ready-micro-batches'

describe('readyMicroBatches', () => {
  it('closes the upstream iterator when the consumer stops early', async () => {
    let upstreamClosed = false
    async function* source() {
      try {
        yield 1
        yield 2
      } finally {
        upstreamClosed = true
      }
    }

    for await (const batch of readyMicroBatches(source(), 1)) {
      expect(batch).toEqual([1])
      break
    }

    await vi.waitFor(() => expect(upstreamClosed).toBe(true))
  })

  it('does not wait for a pending upstream next call when the consumer stops', async () => {
    let releasePending: (() => void) | undefined
    let upstreamClosed = false
    const pending = new Promise<void>((resolve) => {
      releasePending = resolve
    })
    async function* source() {
      try {
        yield 1
        await pending
        yield 2
      } finally {
        upstreamClosed = true
      }
    }

    const consume = (async () => {
      for await (const batch of readyMicroBatches(source(), 2)) {
        expect(batch).toEqual([1])
        break
      }
      return 'closed'
    })()
    const outcome = await Promise.race([
      consume,
      new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 100)),
    ])

    releasePending?.()
    await consume
    await vi.waitFor(() => expect(upstreamClosed).toBe(true))
    expect(outcome).toBe('closed')
  })
})
