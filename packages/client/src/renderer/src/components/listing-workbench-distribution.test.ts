import { describe, expect, it } from 'vitest'
import { createListingDistributionPreview } from './listing-workbench-distribution'

describe('listing distribution preview', () => {
  it('shows every item for every workspace in all-workspaces mode', () => {
    expect(createListingDistributionPreview(6, ['shop-a', 'shop-b'], 'all-workspaces')).toEqual({
      allocations: [
        { profileId: 'shop-a', count: 6 },
        { profileId: 'shop-b', count: 6 },
      ],
      estimatedMinutes: 24,
      totalOperations: 12,
    })
  })

  it('shows deterministic round-robin allocations including the remainder', () => {
    expect(
      createListingDistributionPreview(7, ['shop-a', 'shop-b', 'shop-c'], 'round-robin'),
    ).toEqual({
      allocations: [
        { profileId: 'shop-a', count: 3 },
        { profileId: 'shop-b', count: 2 },
        { profileId: 'shop-c', count: 2 },
      ],
      estimatedMinutes: 12,
      totalOperations: 7,
    })
  })

  it('returns a stable empty preview before a workspace is selected', () => {
    expect(createListingDistributionPreview(4, [], 'all-workspaces')).toEqual({
      allocations: [],
      estimatedMinutes: 0,
      totalOperations: 0,
    })
  })
})
