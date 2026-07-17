import type { ListingDistributionMode } from '@tengyu-aipod/shared'

const MINUTES_PER_LISTING = 4

export function createListingDistributionPreview(
  itemCount: number,
  profileIds: string[],
  mode: ListingDistributionMode,
) {
  const normalizedItemCount = Math.max(0, Math.floor(itemCount))
  if (profileIds.length === 0) {
    return {
      allocations: [],
      estimatedMinutes: 0,
      totalOperations: 0,
    }
  }

  const baseCount = Math.floor(normalizedItemCount / profileIds.length)
  const remainder = normalizedItemCount % profileIds.length
  const allocations = profileIds.map((profileId, index) => ({
    profileId,
    count:
      mode === 'all-workspaces' ? normalizedItemCount : baseCount + (index < remainder ? 1 : 0),
  }))
  const maximumWorkspaceCount = allocations.reduce(
    (maximum, allocation) => Math.max(maximum, allocation.count),
    0,
  )

  return {
    allocations,
    estimatedMinutes: maximumWorkspaceCount * MINUTES_PER_LISTING,
    totalOperations: allocations.reduce((total, allocation) => total + allocation.count, 0),
  }
}
