import { AppErrorClass } from '@tengyu-aipod/shared'
import type { GenerationRunFailure } from './types'

function appErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function isFatalGenerationError(error: unknown) {
  if (!(error instanceof AppErrorClass)) {
    return false
  }
  if (error.details?.kind === 'generation_callback_fatal') {
    return true
  }
  if (
    error.code === 'CHENYU_INSTANCE_DOWN' ||
    error.code === 'CHENYU_BALANCE_INSUFFICIENT' ||
    error.code === 'HTTP_4XX'
  ) {
    return true
  }
  if (error.details?.kind !== 'network') {
    return false
  }
  return (
    error.code === 'HTTP_429' ||
    error.code === 'HTTP_5XX' ||
    error.code === 'NETWORK_OFFLINE' ||
    error.code === 'NETWORK_TIMEOUT'
  )
}

export function fatalGenerationFailure(failures: GenerationRunFailure[]) {
  return failures.find((failure) => failure.fatal === true) ?? null
}

export function appErrorFromGenerationFailure(
  failure: GenerationRunFailure,
  details: Record<string, unknown> = {},
) {
  return new AppErrorClass(
    failure.appErrorCode ?? 'HTTP_5XX',
    failure.error,
    failure.retryable ?? false,
    {
      ...failure.errorDetails,
      ...details,
    },
  )
}

export function generationFailureFromError(
  input: Pick<GenerationRunFailure, 'prompt' | 'sourcePath'>,
  error: unknown,
): GenerationRunFailure {
  const failure: GenerationRunFailure = {
    prompt: input.prompt,
    error: appErrorMessage(error),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
  }
  if (!(error instanceof AppErrorClass)) {
    return failure
  }
  return {
    ...failure,
    appErrorCode: error.code,
    retryable: error.retryable,
    ...(error.details ? { errorDetails: error.details } : {}),
    ...(isFatalGenerationError(error) ? { fatal: true } : {}),
  }
}
