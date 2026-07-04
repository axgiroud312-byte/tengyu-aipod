import { formatIpcError } from '@tengyu-aipod/shared'
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type SuccessMessage<TResult> = string | ((result: TResult) => string)

type IpcMutationOptions<TResult> = {
  silent?: boolean
  successMessage?: SuccessMessage<TResult>
}

export function useIpcMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: IpcMutationOptions<TResult> = {},
) {
  const runningRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setError(null)
  }, [])

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (runningRef.current) {
        return undefined
      }

      runningRef.current = true
      setLoading(true)
      setError(null)
      try {
        const result = await fn(...args)
        const message = successMessageText(options.successMessage, result)
        if (message) {
          toast.success(message)
        }
        return result
      } catch (nextError) {
        const message = formatIpcError(nextError)
        setError(message)
        if (!options.silent) {
          toast.error(message)
        }
        return undefined
      } finally {
        runningRef.current = false
        setLoading(false)
      }
    },
    [fn, options.silent, options.successMessage],
  )

  return { run, loading, error, reset }
}

export function useIpcQuery<TResult>(fn: () => Promise<TResult>, deps: DependencyList) {
  const [data, setData] = useState<TResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async (): Promise<TResult | undefined> => {
    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      setData(result)
      return result
    } catch (nextError) {
      const message = formatIpcError(nextError)
      setError(message)
      return undefined
    } finally {
      setLoading(false)
    }
  }, [fn])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    fn()
      .then((result) => {
        if (active) {
          setData(result)
        }
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(formatIpcError(nextError))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [fn, ...deps])

  return { data, loading, error, refetch }
}

function successMessageText<TResult>(
  successMessage: SuccessMessage<TResult> | undefined,
  result: TResult,
) {
  if (typeof successMessage === 'function') {
    return successMessage(result)
  }
  return successMessage
}
