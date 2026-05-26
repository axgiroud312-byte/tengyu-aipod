import { ListingActionError } from '@tengyu-aipod/shared'
import { describe, expect, it } from 'vitest'
import {
  failureFromUnknown,
  isListingActionError,
  isListingFailure,
  isRetryableListingActionCode,
} from './error-utils'

describe('listing error utils commons', () => {
  it('classifies retryable action codes', () => {
    expect(isRetryableListingActionCode('TIMEOUT')).toBe(true)
    expect(isRetryableListingActionCode('SELECTOR_NOT_FOUND')).toBe(false)
  })

  it('detects listing failures and action errors', () => {
    const actionError = new ListingActionError({
      action: 'fillTitle',
      code: 'FIELD_VALUE_MISMATCH',
      message: 'title mismatch',
    })

    expect(isListingActionError(actionError)).toBe(true)
    expect(
      isListingFailure({
        code: 'UNKNOWN',
        stage: 'replace_title',
        retryable: true,
      }),
    ).toBe(true)
  })

  it('converts unknown errors to listing failures', () => {
    const failure = failureFromUnknown(new Error('boom'), 'publish_result')

    expect(failure).toMatchObject({
      code: 'UNKNOWN',
      stage: 'publish_result',
      retryable: true,
      cause: 'boom',
    })
  })
})
