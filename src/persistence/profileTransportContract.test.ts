import { describe, expect, it } from 'vitest'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import { PROFILE_CONTRACT_VERSIONS, profileServiceFailure } from './profileServiceContract'
import {
  isProfileTransportQueryPage,
  isProfileTransportServiceFailure,
  isProfileTransportSnapshot,
} from './profileTransportContract'

describe('Profile structured-clone transport contract', () => {
  it('reuses the canonical logical validators for complete snapshots and rejects hostile nested data', () => {
    const { snapshot } = createCompleteProfileFixture()
    expect(isProfileTransportSnapshot(snapshot)).toBe(true)

    const hostile = structuredClone(snapshot) as typeof snapshot
    const block = hostile.boards[hostile.activeIdeaId]?.cards[0]?.blocks[0]
    expect(block).toBeDefined()
    ;(block as unknown as Record<string, unknown>).databasePath = 'C:\\private\\profile.sqlite'
    expect(isProfileTransportSnapshot(hostile)).toBe(false)
  })

  it('admits only canonical stable failures and never transports diagnostic path text', () => {
    expect(isProfileTransportServiceFailure(profileServiceFailure('busy'))).toBe(true)
    expect(isProfileTransportServiceFailure({
      ...profileServiceFailure('internal'),
      message: 'Failed at C:\\private\\profile.sqlite',
    })).toBe(false)
    expect(isProfileTransportServiceFailure({
      ...profileServiceFailure('busy'),
      retryable: false,
    })).toBe(false)
  })

  it('validates bounded query item payloads as inert JSON values', () => {
    const valid = {
      profileId: 'profile-synthetic',
      revision: 1,
      items: [{
        recordId: 'idea-synthetic',
        kind: 'idea',
        ownerId: 'profile-synthetic',
        parentId: 'profile-synthetic',
        ordinal: 0,
        recordVersion: PROFILE_CONTRACT_VERSIONS.record,
        payload: { title: 'Synthetic' },
      }],
      truncated: false,
    }
    expect(isProfileTransportQueryPage(valid)).toBe(true)
    expect(isProfileTransportQueryPage({
      ...valid,
      items: [{ ...valid.items[0], payload: { hidden: undefined } }],
    })).toBe(false)
  })
})
