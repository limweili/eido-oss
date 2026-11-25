import { describe, expect, it } from 'vitest'
import type { RendererProfileProjection } from '../../electron/profileBridgeContract'
import {
  GUI_PROFILE_PROJECTION_VERSION,
  type GuiUserModTemplate,
} from '../persistence/profileGuiProjection'
import { createSeedMod } from '../mods'
import type { IntentLogEvent, SavedBoard, IdeaSummary } from './types'
import { mergeLiveProfileAuthority } from './profileLiveAuthorityMerge'

const board: SavedBoard = {
  version: 1,
  cards: [],
  connections: [],
  outputs: [],
  runs: [],
  updatedAt: '2026-07-22T00:00:00.000Z',
}

describe('live Profile authority merge', () => {
  it('keeps a semantic renderer reorder while appending an Agent-only identity', () => {
    const a = idea('a')
    const b = idea('b')
    const c = idea('c')
    const state = (ideas: readonly IdeaSummary[]) => ({
      projection: projection(ideas),
      boards: Object.fromEntries(ideas.map((candidate) => [candidate.id, board])),
    })

    const merged = mergeLiveProfileAuthority(
      state([a, b]),
      state([b, a]),
      state([a, b, c]),
    )

    expect(merged.projection.ideas.map((candidate) => candidate.id)).toEqual(['b', 'a', 'c'])
  })

  it('keeps the authoritative Intent prefix ahead of held GUI events', () => {
    const onlyIdea = idea('a')
    const guiEvent = intentEvent('gui-event', 'user', '2026-07-22T00:00:01.000Z', 1)
    const agentEvent = intentEvent('agent-event', 'agent', '2026-07-22T00:00:02.000Z', 1)
    const state = (intentLog: readonly IntentLogEvent[]) => ({
      projection: projection([onlyIdea]),
      boards: {
        a: { ...board, intentLog: [...intentLog] },
      },
    })

    const merged = mergeLiveProfileAuthority(
      state([]),
      state([guiEvent]),
      state([agentEvent]),
    )

    expect(merged.boards.a?.intentLog).toEqual([
      agentEvent,
      {
        ...guiEvent,
        at: agentEvent.at,
        seq: 2,
      },
    ])
  })

  it('keeps held Idea and Board content without rewinding authoritative timestamps', () => {
    const baseIdea = idea('a')
    const heldIdea = {
      ...baseIdea,
      name: 'Held rename',
      createdAt: '2026-07-21T23:59:00.000Z',
      updatedAt: '2026-07-22T00:00:01.000Z',
      lastOpenedAt: '2026-07-22T00:00:01.000Z',
    }
    const authoritativeIdea = {
      ...baseIdea,
      updatedAt: '2026-07-22T00:00:02.000Z',
      lastOpenedAt: '2026-07-22T00:00:03.000Z',
    }
    const heldBoard = {
      ...board,
      cards: [{
        id: 'card-held',
        kind: 'note' as const,
        position: { x: 0, y: 0 },
        blocks: [{ id: 'block-held', kind: 'line' as const, text: 'Held content' }],
      }],
      updatedAt: '2026-07-22T00:00:01.000Z',
    }
    const authoritativeBoard = {
      ...board,
      cards: [{
        id: 'card-agent',
        kind: 'note' as const,
        position: { x: 100, y: 0 },
        blocks: [{ id: 'block-agent', kind: 'line' as const, text: 'Agent content' }],
      }],
      updatedAt: '2026-07-22T00:00:02.000Z',
    }
    const state = (candidateIdea: IdeaSummary, candidateBoard: SavedBoard) => ({
      projection: projection([candidateIdea]),
      boards: { a: candidateBoard },
    })

    const merged = mergeLiveProfileAuthority(
      state(baseIdea, board),
      state(heldIdea, heldBoard),
      state(authoritativeIdea, authoritativeBoard),
    )

    expect(merged.projection.ideas[0]).toEqual({
      ...heldIdea,
      createdAt: baseIdea.createdAt,
      updatedAt: authoritativeIdea.updatedAt,
      lastOpenedAt: authoritativeIdea.lastOpenedAt,
    })
    expect(merged.boards.a?.cards.map((card) => card.id)).toEqual(['card-held', 'card-agent'])
    expect(merged.boards.a?.updatedAt).toBe(authoritativeBoard.updatedAt)
  })

  it('keeps an acknowledged native Mod template and a non-conflicting held GUI edit', () => {
    const baseTemplate = userModTemplate('mod-user-held', 'Base title')
    const heldTemplate = userModTemplate('mod-user-held', 'Held GUI title')
    const nativeTemplate = userModTemplate('mod-agent-native', 'Agent title')

    const merged = mergeLiveProfileAuthority(
      stateWithTemplates([baseTemplate]),
      stateWithTemplates([heldTemplate]),
      stateWithTemplates([baseTemplate, nativeTemplate]),
    )

    expect(merged.projection.userModTemplates).toEqual([
      heldTemplate,
      nativeTemplate,
    ])
  })

  it.each([
    {
      name: 'held deletion',
      base: [true, true],
      held: [true, false],
      authoritative: [true, true],
    },
    {
      name: 'authoritative deletion',
      base: [true, true],
      held: [true, true],
      authoritative: [true, false],
    },
    {
      name: 'matching deletion',
      base: [true, true],
      held: [true, false],
      authoritative: [true, false],
    },
  ])('preserves $name by template identity', ({ base, held, authoritative }) => {
    const templates = {
      a: userModTemplate('mod-a', 'A'),
      b: userModTemplate('mod-b', 'B'),
    }
    const select = (presence: readonly boolean[]) => (
      [templates.a, templates.b].filter((_template, index) => presence[index])
    )

    const merged = mergeLiveProfileAuthority(
      stateWithTemplates(select(base)),
      stateWithTemplates(select(held)),
      stateWithTemplates(select(authoritative)),
    )

    expect(merged.projection.userModTemplates).toEqual([templates.a])
  })

  it('fails closed when held and authoritative writers diverge on one template', () => {
    const baseTemplate = userModTemplate('mod-shared', 'Base title')

    expect(() => mergeLiveProfileAuthority(
      stateWithTemplates([baseTemplate]),
      stateWithTemplates([userModTemplate('mod-shared', 'Held title')]),
      stateWithTemplates([userModTemplate('mod-shared', 'Authoritative title')]),
    )).toThrow('Live Profile Mod template mod-shared changed concurrently')
  })

  it('validates duplicate template IDs before catalog equality shortcuts', () => {
    const duplicate = userModTemplate('mod-duplicate', 'Duplicate')
    const ambiguousCatalog = [duplicate, duplicate]

    expect(() => mergeLiveProfileAuthority(
      stateWithTemplates(ambiguousCatalog),
      stateWithTemplates(ambiguousCatalog),
      stateWithTemplates(ambiguousCatalog),
    )).toThrow('Live Profile Mod template catalog is ambiguous')
  })

  it('drops a base-only template and orders authoritative additions before held additions', () => {
    const removed = userModTemplate('mod-removed', 'Removed')
    const held = userModTemplate('mod-held', 'Held')
    const authoritative = userModTemplate('mod-authoritative', 'Authoritative')

    const merged = mergeLiveProfileAuthority(
      stateWithTemplates([removed]),
      stateWithTemplates([held]),
      stateWithTemplates([authoritative]),
    )

    expect(merged.projection.userModTemplates).toEqual([authoritative, held])
  })
})

function idea(id: string): IdeaSummary {
  return {
    id,
    name: id,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    lastOpenedAt: '2026-07-22T00:00:00.000Z',
  }
}

function projection(
  ideas: readonly IdeaSummary[],
  userModTemplates: readonly GuiUserModTemplate[] = [],
): RendererProfileProjection {
  return {
    projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
    activeIdeaId: 'a',
    ideas,
    boardReplacements: {},
    userModTemplates,
    newModOrigins: {},
  }
}

function userModTemplate(templateId: string, title: string): GuiUserModTemplate {
  return {
    templateId,
    mod: createSeedMod('slider', {
      title,
      createId: (role, ordinal) => `${templateId}-${role}-${ordinal}`,
    }),
  }
}

function stateWithTemplates(userModTemplates: readonly GuiUserModTemplate[]) {
  return {
    projection: projection([idea('a')], userModTemplates),
    boards: { a: board },
  }
}

function intentEvent(id: string, actorId: string, at: string, seq: number): IntentLogEvent {
  return {
    id,
    at,
    actorId,
    seq,
    type: 'card.moved',
    cardId: 'card-a',
    data: {
      moves: [{
        cardId: 'card-a',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
      }],
    },
  }
}
