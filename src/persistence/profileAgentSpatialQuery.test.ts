import { describe, expect, it } from 'vitest'
import type { Card, Connection } from '../graph/types'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import { projectProfileSnapshot } from './profileLogicalProjection'
import {
  isProfileAgentCardSetBounds,
  queryProfileAgentCardSetBounds,
  queryProfileAgentCardNeighbors,
  queryProfileAgentCardPlacement,
} from './profileAgentSpatialQuery'

describe('Profile Agent spatial projection', () => {
  it('places beside the connected cluster identically for a raw Card ID and Card Deep Link', () => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards['idea-second']!.cards = [
      card('anchor', 0, 0),
      card('cluster-peer', 290, 0),
      card('right-blocker', 580, 0),
    ]
    fixture.snapshot.boards['idea-second']!.connections = [
      connection('edge', 'anchor', 'cluster-peer'),
    ]
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const raw = queryProfileAgentCardPlacement(document, {
      ideaId: 'idea-second',
      near: ['anchor'],
      kind: 'note',
    })
    const linked = queryProfileAgentCardPlacement(document, {
      ideaId: 'idea-second',
      near: ['eido://app/?idea=idea-second&card=anchor&x=900&y=-20&zoom=0.25'],
      kind: 'note',
    })

    expect(raw).toEqual({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 7,
        ideaId: 'idea-second',
        anchors: [{
          cardId: 'anchor',
          deepLink: 'eido://app/?idea=idea-second&card=anchor',
        }],
        position: { x: 0, y: 210 },
      },
    })
    expect(linked).toEqual(raw)
  })

  it('returns bounded neighboring Cards with canonical Deep Links and connection meaning', () => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards['idea-second']!.cards = [
      card('target', 0, 0),
      { ...card('upstream', -350, 20), kind: 'title' },
      { ...card('downstream', 350, 20), kind: 'conversation' },
    ]
    fixture.snapshot.boards['idea-second']!.connections = [
      { ...connection('a-in', 'upstream', 'target'), polarity: 'pushesAgainst' },
      connection('z-out', 'target', 'downstream'),
    ]
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const result = queryProfileAgentCardNeighbors(document, {
      ideaId: 'idea-second',
      card: 'eido://app/?idea=idea-second&card=target&x=1&y=2&zoom=3',
      limit: 1,
      byteLimit: 4_096,
    })

    expect(result).toEqual({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 7,
        ideaId: 'idea-second',
        card: {
          cardId: 'target',
          deepLink: 'eido://app/?idea=idea-second&card=target',
        },
        items: [{
          cardId: 'upstream',
          deepLink: 'eido://app/?idea=idea-second&card=upstream',
          kind: 'title',
          position: { x: -350, y: 20 },
          size: { width: 260, height: 180 },
          connection: {
            id: 'a-in',
            direction: 'incoming',
            strength: 'strong',
            polarity: 'pushesAgainst',
            role: 'feeds',
          },
        }],
        truncated: true,
      },
    })
    if (result.ok) {
      expect(new TextEncoder().encode(JSON.stringify(result.value.items)).byteLength)
        .toBeLessThanOrEqual(4_096)
    }
  })

  it('bounds a deduplicated Card set addressed by raw IDs and Deep Links', () => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards['idea-second']!.cards = [
      cardWithoutSize('second-group', 'group', -100, -50),
      cardWithoutSize('second-title', 'title', 400, 300),
      cardWithoutSize('second-ignored', 'note', 2_000, 2_000),
    ]
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    expect(queryProfileAgentCardSetBounds(document, {
      ideaId: 'idea-second',
      cards: [
        'second-title',
        'eido://app/?idea=idea-second&card=second-group&x=999&y=999&zoom=0.1',
        'second-title',
      ],
    })).toEqual({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 7,
        ideaId: 'idea-second',
        cards: [{
          cardId: 'second-group',
          deepLink: 'eido://app/?idea=idea-second&card=second-group',
          kind: 'group',
          position: { x: -100, y: -50 },
          size: { width: 360, height: 360 },
        }, {
          cardId: 'second-title',
          deepLink: 'eido://app/?idea=idea-second&card=second-title',
          kind: 'title',
          position: { x: 400, y: 300 },
          size: { width: 320, height: 82 },
        }],
        bounds: { x: -100, y: -50, width: 820, height: 432 },
      },
    })
  })

  it('rejects an aggregate rectangle that does not equal its resolved Card-box union', () => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards['idea-second']!.cards = [
      cardWithoutSize('second-note', 'note', 20, 40),
    ]
    const result = queryProfileAgentCardSetBounds(
      projectProfileSnapshot(fixture.snapshot, fixture.projectAsset),
      { ideaId: 'idea-second', cards: ['second-note'] },
    )
    if (!result.ok) throw new Error('Synthetic Card bounds were unavailable')
    expect(isProfileAgentCardSetBounds(result.value)).toBe(true)
    expect(isProfileAgentCardSetBounds({
      ...result.value,
      bounds: { ...result.value.bounds, width: result.value.bounds.width + 1 },
    })).toBe(false)
  })

  it('classifies a malformed Card address as request failure before reading Profile state', () => {
    expect(queryProfileAgentCardPlacement({} as never, {
      ideaId: 'idea-second',
      near: ['eido://app/?idea=idea-second'],
      kind: 'note',
    })).toEqual({ ok: false, reason: 'invalid-request' })
  })

  it('reports the exact Profile revision when bounded placement has no space', () => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards['idea-second']!.cards = [
      card('edge-low', -1_000_000, -1_000_000),
      card('edge-high', 1_000_000, 1_000_000),
    ]
    fixture.snapshot.boards['idea-second']!.connections = [
      connection('edge-extremes', 'edge-low', 'edge-high'),
    ]
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    expect(queryProfileAgentCardPlacement(document, {
      ideaId: 'idea-second',
      near: ['edge-low'],
      kind: 'note',
    })).toEqual({
      ok: false,
      reason: 'no-bounded-space',
      profileId: 'profile-synthetic',
      revision: 7,
      ideaId: 'idea-second',
    })
  })

  it('rejects an oversized raw Card ID instead of misreporting it as missing', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    expect(queryProfileAgentCardSetBounds(document, {
      ideaId: 'idea-second',
      cards: ['x'.repeat(513)],
    })).toEqual({ ok: false, reason: 'invalid-request' })
  })

  it('distinguishes malformed Profile state, missing records, and cross-Idea links', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    expect(queryProfileAgentCardNeighbors({} as never, {
      ideaId: 'idea-second',
      card: 'card-second',
    })).toEqual({ ok: false, reason: 'profile-invalid' })
    expect(queryProfileAgentCardNeighbors(document, {
      ideaId: 'idea-absent',
      card: 'card-second',
    })).toEqual({ ok: false, reason: 'idea-not-found', ideaId: 'idea-absent' })
    expect(queryProfileAgentCardNeighbors(document, {
      ideaId: 'idea-second',
      card: 'card-absent',
    })).toEqual({
      ok: false,
      reason: 'card-not-found',
      ideaId: 'idea-second',
      cardId: 'card-absent',
    })
    expect(queryProfileAgentCardNeighbors(document, {
      ideaId: 'idea-second',
      card: 'eido://app/?idea=idea-main&card=card-note',
    })).toEqual({
      ok: false,
      reason: 'card-idea-mismatch',
      ideaId: 'idea-second',
      linkedIdeaId: 'idea-main',
      cardId: 'card-note',
    })
  })
})

function card(id: string, x: number, y: number): Card {
  return {
    id,
    kind: 'note',
    position: { x, y },
    size: { width: 260, height: 180 },
    blocks: [{ id: `block-${id}`, text: id }],
  }
}

function connection(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

function cardWithoutSize(
  id: string,
  kind: Card['kind'],
  x: number,
  y: number,
): Card {
  return {
    id,
    kind,
    position: { x, y },
    blocks: [{ id: `block-${id}`, text: id }],
  }
}
