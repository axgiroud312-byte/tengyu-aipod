export async function* readyMicroBatches<T>(
  input: AsyncIterable<T>,
  maxBatchSize: number,
): AsyncGenerator<T[]> {
  const limit = Math.max(1, Math.floor(maxBatchSize))
  const iterator = input[Symbol.asyncIterator]()
  let inputDone = false

  try {
    let next = iterator.next()
    while (!inputDone) {
      const first = await next
      if (first.done) {
        inputDone = true
        return
      }

      const batch = [first.value]
      next = iterator.next()
      while (batch.length < limit) {
        const ready = await Promise.race([
          next.then((result) => ({ ready: true as const, result })),
          new Promise<{ ready: false }>((resolve) => {
            setImmediate(() => resolve({ ready: false }))
          }),
        ])
        if (!ready.ready) {
          break
        }
        if (ready.result.done) {
          inputDone = true
          break
        }
        batch.push(ready.result.value)
        next = iterator.next()
      }

      yield batch
    }
  } finally {
    if (!inputDone) {
      void iterator.return?.().catch(() => undefined)
    }
  }
}
