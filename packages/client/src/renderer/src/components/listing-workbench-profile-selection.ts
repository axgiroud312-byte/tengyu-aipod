export function reconcileSelectedListingProfileIds(
  current: string[],
  profiles: Array<{ id: string } & Record<string, unknown>>,
) {
  if (current.length === 0) {
    return []
  }
  return current.filter((profileId) => profiles.some((profile) => profile.id === profileId))
}
