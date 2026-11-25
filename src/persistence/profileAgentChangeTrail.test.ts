import { describe, expect, it } from 'vitest'
import {
  queryProfileAgentChangeTrail,
  type ProfileAgentChangeTrailRecord,
} from './profileAgentChangeTrail'

const actor = Object.freeze({
  kind: 'agent' as const,
  client: 'codex',
  sessionId: 'session-change-trail',
})

function change(
  revision: number,
  recordId: string,
  overrides: Partial<ProfileAgentChangeTrailRecord> = {},
): ProfileAgentChangeTrailRecord {
  return Object.freeze({
    revision,
    committedAt: `2026-07-22T00:00:0${revision}.000Z`,
    actor,
    command: Object.freeze({ id: `command-${revision}`, name: 'card.create' }),
    ideaId: 'idea-main',
    recordId,
    recordKind: 'card',
    changeKind: 'insert',
    position: Object.freeze({ x: revision * 10, y: revision * 20 }),
    ...overrides,
  })
}

describe('Profile Agent change-trail projection (#718)', () => {
  it('lists only Agent records after the requested revision, newest first, with Card Deep Links', () => {
    const result = queryProfileAgentChangeTrail({
      profileId: 'profile-synthetic',
      revision: 9,
      records: [
        change(7, 'card-old'),
        change(9, 'card-new'),
        change(8, 'connection-middle', {
          command: { id: 'command-8', name: 'connection.create' },
          recordKind: 'connection',
          position: undefined,
        }),
        change(8, 'run-agent', {
          command: { id: 'run-agent', name: 'run.submit' },
          recordKind: 'run',
          position: undefined,
        }),
      ],
    }, { since: 7 })

    expect(result).toEqual({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 9,
        since: 7,
        items: [
          expect.objectContaining({
            revision: 9,
            recordId: 'card-new',
            deepLink: 'eido://app/?idea=idea-main&card=card-new',
          }),
          expect.objectContaining({
            revision: 8,
            recordId: 'connection-middle',
          }),
          expect.objectContaining({
            revision: 8,
            recordId: 'run-agent',
            command: { id: 'run-agent', name: 'run.submit' },
          }),
        ],
        truncated: false,
      },
    })
    if (!result.ok) throw new Error('Expected change trail')
    expect(result.value.items[1]).not.toHaveProperty('deepLink')
    expect(result.value.items[1]).not.toHaveProperty('position')
  })

  it('paginates by item and byte bounds without flooding output', () => {
    const source = {
      profileId: 'profile-synthetic',
      revision: 12,
      records: [change(12, 'card-c'), change(11, 'card-b'), change(10, 'card-a')],
    }
    const first = queryProfileAgentChangeTrail(source, { limit: 1 })
    expect(first).toMatchObject({
      ok: true,
      value: {
        items: [{ recordId: 'card-c' }],
        truncated: true,
      },
    })
    if (!first.ok || !first.value.nextCursor) throw new Error('Expected cursor')

    const second = queryProfileAgentChangeTrail(source, {
      limit: 1,
      cursor: first.value.nextCursor,
    })
    expect(second).toMatchObject({
      ok: true,
      value: {
        items: [{ recordId: 'card-b' }],
        truncated: true,
      },
    })

    const oneItemBytes = new TextEncoder().encode(JSON.stringify([
      first.value.items[0],
    ])).byteLength
    expect(queryProfileAgentChangeTrail(source, { byteLimit: oneItemBytes - 1 }))
      .toMatchObject({ ok: false, code: 'invalid' })
  })

  it('binds cursors to the Profile head and original since boundary', () => {
    const source = {
      profileId: 'profile-synthetic',
      revision: 12,
      records: [change(12, 'card-c'), change(11, 'card-b')],
    }
    const first = queryProfileAgentChangeTrail(source, { since: 4, limit: 1 })
    if (!first.ok || !first.value.nextCursor) throw new Error('Expected cursor')

    expect(queryProfileAgentChangeTrail(
      { ...source, revision: 13 },
      { since: 4, limit: 1, cursor: first.value.nextCursor },
    )).toMatchObject({ ok: false, code: 'conflict', currentRevision: 13 })
    expect(queryProfileAgentChangeTrail(
      source,
      { since: 5, limit: 1, cursor: first.value.nextCursor },
    )).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('returns an empty page for Profiles with user-only history', () => {
    expect(queryProfileAgentChangeTrail({
      profileId: 'profile-synthetic',
      revision: 5,
      records: [],
    }, {})).toEqual({
      ok: true,
      value: {
        profileId: 'profile-synthetic',
        revision: 5,
        since: 0,
        items: [],
        truncated: false,
      },
    })
  })
})
