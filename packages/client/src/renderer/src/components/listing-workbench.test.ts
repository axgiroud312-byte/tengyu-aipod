import { describe, expect, it } from 'vitest'
import { reconcileSelectedListingProfileIds } from './listing-workbench-profile-selection'

describe('ListingWorkbench profile selection', () => {
  it('does not preselect a profile for a fresh listing workspace', () => {
    expect(
      reconcileSelectedListingProfileIds(
        [],
        [{ id: '2-1111', name: 'Temu main', remark: 'preferred', seq: 1111 }],
      ),
    ).toEqual([])
  })

  it('keeps existing selections that still exist after refreshing profiles', () => {
    expect(
      reconcileSelectedListingProfileIds(
        ['profile-a', 'missing-profile'],
        [
          { id: 'profile-a', name: 'A' },
          { id: 'profile-b', name: 'B' },
        ],
      ),
    ).toEqual(['profile-a'])
  })
})
