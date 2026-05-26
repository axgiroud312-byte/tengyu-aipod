import {
  type ListingActionError,
  type ListingErrorCode,
  type ListingFailure,
  type ListingStage,
  createListingFailure,
  isListingRetryable,
} from '@tengyu-aipod/shared'

export function isRetryableListingActionCode(code: ListingErrorCode): boolean {
  return isListingRetryable(code)
}

export function isListingFailure(error: unknown): error is ListingFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'stage' in error &&
    'retryable' in error
  )
}

export function isListingActionError(error: unknown): error is ListingActionError {
  return error instanceof Error && 'action' in error && 'code' in error && 'retryable' in error
}

export function failureFromUnknown(error: unknown, stage: ListingStage): ListingFailure {
  if (isListingFailure(error)) {
    return error
  }
  if (isListingActionError(error)) {
    return createListingFailure({
      code: error.code,
      message: error.message,
      stage,
      ...(error.selector ? { selector: error.selector } : {}),
      ...(error.url ? { url: error.url } : {}),
      ...(error.evidencePath ? { screenshotPath: error.evidencePath } : {}),
      cause: error.cause,
    })
  }
  return createListingFailure({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    stage,
    cause: error,
  })
}
