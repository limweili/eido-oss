// Digest-cache v3 intentionally invalidated v2 keys so freshness now binds the
// exact provider identity, instruction, and configuration. This pin still proves Mod v2 uses
// compiler-owned treatment and sentences, never the retired emitter shape.

import { describe, expect, it } from 'vitest'
import type { Card, SavedBoard } from '../graph/types'
import { createSeedMod } from '../mods/seeds'
import { groupDigestCacheKey } from './groupDigestFreshness'

const groupCard: Card = {
  id: 'group-1',
  kind: 'group',
  blocks: [{ id: 'g1', text: '' }],
  position: { x: 0, y: 0 },
}

const memberSeed = createSeedMod('slider', {
  title: 'Idea pressure',
  createId: (_, ordinal) => `member-${ordinal}`,
})
const member: Card = {
  id: 'mod-2',
  kind: 'mod',
  blocks: [{ id: 'b2', text: '' }],
  position: { x: 0, y: 0 },
  groupId: 'group-1',
  modV2: {
    ...memberSeed,
    state: {
      ...memberSeed.state,
      items: [{ id: 'novelty', label: 'Novelty', v: 50, frame: '' }],
    },
  },
}

const board: SavedBoard = {
  version: 1,
  cards: [groupCard, member],
  connections: [],
  outputs: [],
  runs: [],
  updatedAt: '',
}

describe('mod hashing after intent removal', () => {
  it('pins the provider-aware v3 key for a Mod v2 member', () => {
    expect(groupDigestCacheKey(board, groupCard, [member], 'test-model')).toBe('digest:h091hz')
  })
})
