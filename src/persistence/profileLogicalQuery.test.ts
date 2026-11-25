import { describe, expect, it } from 'vitest'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import { projectProfileSnapshot, type ProfileLogicalDocument } from './profileLogicalProjection'
import { queryProfileLogicalDocument } from './profileLogicalQuery'
import { PROFILE_CONTRACT_VERSIONS } from './profileServiceContract'

describe('bounded Profile logical query (#523)', () => {
  it('filters and projects complete logical records through Unicode-safe revision-bound pages', () => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.ideas[0]!.name = 'Alpha 🧠'
    fixture.snapshot.ideas[1]!.name = '第二のアイデア'
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const request = {
      recordKinds: ['idea'],
      ownerIds: ['profile-synthetic'],
      parentIds: ['profile-synthetic'],
      projection: ['name'],
      limit: 10,
      byteLimit: 220,
    }

    const first = queryProfileLogicalDocument(document, request)
    expect(first).toMatchObject({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 7,
        truncated: true,
        items: [{
          recordId: 'idea-main',
          kind: 'idea',
          ownerId: 'profile-synthetic',
          parentId: 'profile-synthetic',
          ordinal: 0,
          recordVersion: PROFILE_CONTRACT_VERSIONS.record,
          payload: { name: 'Alpha 🧠' },
        }],
      },
    })
    if (!first.ok || !first.value.nextCursor) throw new Error('Expected a second query page')

    const second = queryProfileLogicalDocument(document, {
      ...request,
      cursor: first.value.nextCursor,
    })
    expect(second).toEqual({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 7,
        items: [{
          recordId: 'idea-second',
          kind: 'idea',
          ownerId: 'profile-synthetic',
          parentId: 'profile-synthetic',
          ordinal: 1,
          recordVersion: PROFILE_CONTRACT_VERSIONS.record,
          payload: { name: '第二のアイデア' },
        }],
        truncated: false,
      },
    })

    const changedDocument = {
      ...document,
      head: { ...document.head, revision: document.head.revision + 1 },
    } satisfies ProfileLogicalDocument
    expect(queryProfileLogicalDocument(changedDocument, {
      ...request,
      cursor: first.value.nextCursor,
    })).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: 8,
    })

    expect(queryProfileLogicalDocument(document, {
      recordKinds: ['card'],
      recordIds: ['card-note'],
      ownerIds: ['board:idea-main'],
      parentIds: ['board:idea-main'],
      projection: ['kind'],
    })).toMatchObject({
      ok: true,
      value: {
        items: [{
          recordId: 'card-note',
          kind: 'card',
          ownerId: 'board:idea-main',
          parentId: 'board:idea-main',
          payload: { kind: 'note' },
        }],
      },
    })
  })

  it('filters Cards by durable creator with adopted Agent work retained and legacy work treated as user-created', () => {
    const fixture = createCompleteProfileFixture()
    const board = fixture.snapshot.boards['idea-main']!
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const user = { kind: 'user', client: 'eido-desktop', sessionId: 'user-session' } as const
    const agentCard = board.cards[0]!
    const adoptedAgentCard = board.cards[1]!
    const explicitUserCard = board.cards[2]!
    agentCard.createdBy = agent
    agentCard.lastModifiedBy = agent
    adoptedAgentCard.createdBy = agent
    adoptedAgentCard.lastModifiedBy = user
    explicitUserCard.createdBy = user
    explicitUserCard.lastModifiedBy = user
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    const agentResult = queryProfileLogicalDocument(document, {
      creator: 'agent',
      projection: ['createdBy', 'lastModifiedBy'],
      limit: 1,
    })
    expect(agentResult).toMatchObject({
      ok: true,
      value: {
        items: [{ recordId: agentCard.id, kind: 'card' }],
        truncated: true,
      },
    })
    if (!agentResult.ok || !agentResult.value.nextCursor) {
      throw new Error('Expected a second Agent-created page')
    }
    expect(queryProfileLogicalDocument(document, {
      creator: 'agent',
      projection: ['createdBy', 'lastModifiedBy'],
      limit: 1,
      cursor: agentResult.value.nextCursor,
    })).toMatchObject({
      ok: true,
      value: {
        items: [{
          recordId: adoptedAgentCard.id,
          payload: { createdBy: agent, lastModifiedBy: user },
        }],
        truncated: false,
      },
    })

    const legacyCard = board.cards.find(card => card.createdBy === undefined)!
    const expectedUserCardIds = Object.values(fixture.snapshot.boards).flatMap(candidateBoard => (
      candidateBoard.cards
        .filter(card => card.createdBy?.kind !== 'agent')
        .map(card => card.id)
    ))
    const userResult = queryProfileLogicalDocument(document, {
      recordKinds: ['card'],
      creator: 'user',
      projection: ['createdBy'],
    })
    expect(userResult.ok && userResult.value.items.map(item => item.recordId))
      .toEqual(expectedUserCardIds)
    expect(userResult.ok && userResult.value.items.some(item => item.recordId === explicitUserCard.id))
      .toBe(true)
    expect(userResult.ok && userResult.value.items.some(item => item.recordId === legacyCard.id))
      .toBe(true)

    expect(queryProfileLogicalDocument(document, {
      creator: 'user',
      limit: 1,
      cursor: agentResult.value.nextCursor,
    })).toMatchObject({ ok: false, code: 'invalid' })
  })
})
