import { describe, expect, it, vi } from 'vitest'
import type { CardAsset } from '../graph/types'
import {
  hydrateProfileLogicalAsset,
  toProfileLogicalAssetPayload,
  type ProfileLogicalAssetPayload,
} from './profileAssetKernel'
import {
  extractProfileIdeaClosure,
  hydrateProfileIdeaClosure,
  preflightProfileIdeaRemap,
  PROFILE_IDEA_REMAP_V1_LIMITS,
  ProfileIdeaClosureError,
} from './profileIdeaClosure'
import { remapProfileIdea } from './profileIdeaIdentityRemap'
import { projectProfileSnapshot } from './profileLogicalProjection'
import {
  createCompleteProfileFixture,
  createProfileAgentEventFixture,
} from './fixtures/profileLogicalProjectionFixture'

const AT = '2026-07-19T05:00:00.000Z'

describe('Profile Idea closure (#463)', () => {
  it('extracts and hydrates only the selected Idea before remapping', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    snapshot.profileAgentEvents = [createProfileAgentEventFixture(snapshot.profileId)]
    const unrelated = asset('asset-unrelated', 1)
    snapshot.boards['idea-second']!.cards[0]!.assets = [unrelated]
    const document = projectProfileSnapshot(snapshot, (candidate) => (
      candidate.id === unrelated.id
        ? toProfileLogicalAssetPayload(candidate, '3'.repeat(64))
        : fixture.projectAsset(candidate)
    ))
    const hydrate = vi.fn((payload: ProfileLogicalAssetPayload) => {
      if (payload.id === unrelated.id) throw new Error('unrelated Idea must not hydrate')
      return fixture.hydrateAsset(payload)
    })

    const closure = extractProfileIdeaClosure(document, 'idea-main')
    expect(closure.records.some((record) => record.ownerId === 'board:idea-second')).toBe(false)
    expect(closure.records.some((record) => record.kind === 'profile-agent-event')).toBe(false)
    expect(closure.assets.some((entry) => entry.logicalAssetId === unrelated.id)).toBe(false)

    const remapped = remapProfileIdea({
      sourceDocument: document,
      sourceIdeaId: 'idea-main',
      destinationDocument: document,
      targetIdea: {
        id: 'idea-selected-copy',
        name: 'Selected copy',
        createdAt: AT,
        updatedAt: AT,
        lastOpenedAt: AT,
      },
      hydrateSourceAsset: hydrate,
      allocateIdentity: ({ kind, sourceId }) => `copy:${kind}:${sourceId}`,
    })

    expect(remapped.document.head.activeIdeaId).toBe('idea-selected-copy')
    const remappedProfileAgentEvents = remapped.document.records
      .filter((record) => record.kind === 'profile-agent-event')
    expect(remappedProfileAgentEvents).toHaveLength(1)
    expect(remappedProfileAgentEvents).toEqual(
      document.records.filter((record) => record.kind === 'profile-agent-event'),
    )
    expect(hydrate.mock.calls.some(([payload]) => payload.id === unrelated.id)).toBe(false)
  })

  it('accepts the exact decoded v1 bound and refuses one byte more before hydration', () => {
    const accepted = closureWithAssets([
      asset('asset-at-bound', PROFILE_IDEA_REMAP_V1_LIMITS.maxUniqueDecodedAssetBytes),
    ])
    const hydrate = vi.fn((payload: ProfileLogicalAssetPayload) => (
      hydrateProfileLogicalAsset(payload, `data:${payload.mimeType};base64,AA==`)
    ))

    expect(preflightProfileIdeaRemap(accepted)).toMatchObject({
      uniqueDecodedAssetBytes: PROFILE_IDEA_REMAP_V1_LIMITS.maxUniqueDecodedAssetBytes,
    })
    expect(hydrateProfileIdeaClosure(accepted, hydrate).snapshot.boards['idea-main']).toBeDefined()
    expect(hydrate).toHaveBeenCalled()

    const rejected = closureWithAssets([
      asset('asset-over-bound', PROFILE_IDEA_REMAP_V1_LIMITS.maxUniqueDecodedAssetBytes + 1),
    ])
    hydrate.mockClear()
    expect(closureErrorCode(() => hydrateProfileIdeaClosure(rejected, hydrate)))
      .toBe('idea-remap-too-large')
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('counts decoded bytes by unique digest and hydrated URLs by logical asset', () => {
    const sharedSize = 10 * 1024 * 1024
    const first = asset('asset-shared-a', sharedSize)
    const second = asset('asset-shared-b', sharedSize)
    const closure = closureWithAssets([first, second], '4'.repeat(64))
    const hydrate = vi.fn((payload: ProfileLogicalAssetPayload) => (
      hydrateProfileLogicalAsset(payload, `data:${payload.mimeType};base64,AA==`)
    ))

    expect(closureErrorCode(() => preflightProfileIdeaRemap(closure))).toBe('idea-remap-too-large')
    expect(closureErrorCode(() => hydrateProfileIdeaClosure(closure, hydrate)))
      .toBe('idea-remap-too-large')
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('counts one digest under distinct MIME types as distinct hydrated content', () => {
    const sharedSize = Math.floor(8.5 * 1024 * 1024)
    const first = asset('asset-shared-mime-a', sharedSize, 'application/octet-stream')
    const second = asset('asset-shared-mime-b', sharedSize, 'application/x-eido-proof')
    const closure = closureWithAssets([first, second], '7'.repeat(64))

    expect(closureErrorCode(() => preflightProfileIdeaRemap(closure)))
      .toBe('idea-remap-too-large')
  })
})

function closureWithAssets(assets: CardAsset[], digest?: string) {
  const fixture = createCompleteProfileFixture()
  const snapshot = clone(fixture.snapshot)
  const board = snapshot.boards['idea-main']!
  for (const card of board.cards) delete card.assets
  board.cards[0]!.assets = assets
  board.intentLog = []
  const document = projectProfileSnapshot(snapshot, (candidate) => (
    toProfileLogicalAssetPayload(candidate, digest ?? digestFor(candidate.id))
  ))
  return extractProfileIdeaClosure(document, 'idea-main')
}

function asset(id: string, size: number, mimeType = 'application/octet-stream'): CardAsset {
  return {
    id,
    kind: 'file',
    name: `${id}.bin`,
    mimeType,
    dataUrl: `data:${mimeType};base64,AA==`,
    size,
    createdAt: AT,
  }
}

function digestFor(id: string): string {
  return id.includes('bound') ? '5'.repeat(64) : '6'.repeat(64)
}

function closureErrorCode(run: () => unknown): ProfileIdeaClosureError['code'] | undefined {
  try {
    run()
    return undefined
  } catch (error) {
    if (!(error instanceof ProfileIdeaClosureError)) throw error
    return error.code
  }
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
