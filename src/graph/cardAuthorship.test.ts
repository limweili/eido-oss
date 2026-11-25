import { describe, expect, it } from 'vitest'
import type { Card } from './types'
import {
  cardMatchesCreatorFilter,
  effectiveCardCreatorKind,
  isAgentUnadoptedCard,
} from './cardAuthorship'

const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
const user = { kind: 'user', client: 'eido-desktop', sessionId: 'user-session' } as const

function provenanceCard(
  id: string,
  authorship: Pick<Card, 'createdBy' | 'lastModifiedBy'>,
): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-body`, text: id }],
    position: { x: 0, y: 0 },
    ...authorship,
  }
}

describe('Card creator semantics', () => {
  it('treats legacy Cards as user-created and keeps adoption separate from creation', () => {
    const legacy = provenanceCard('legacy', {})
    const untouchedAgent = provenanceCard('agent', { createdBy: agent, lastModifiedBy: agent })
    const adoptedAgent = provenanceCard('adopted', { createdBy: agent, lastModifiedBy: user })
    const userCard = provenanceCard('user', { createdBy: user, lastModifiedBy: user })

    expect(effectiveCardCreatorKind(legacy)).toBe('user')
    expect([legacy, userCard].filter(card => cardMatchesCreatorFilter(card, 'user')))
      .toEqual([legacy, userCard])
    expect([untouchedAgent, adoptedAgent].filter(card => cardMatchesCreatorFilter(card, 'agent')))
      .toEqual([untouchedAgent, adoptedAgent])
    expect([legacy, untouchedAgent, adoptedAgent, userCard].filter(card => cardMatchesCreatorFilter(card, 'all')))
      .toHaveLength(4)

    expect(isAgentUnadoptedCard(untouchedAgent)).toBe(true)
    expect(isAgentUnadoptedCard(adoptedAgent)).toBe(false)
    expect(isAgentUnadoptedCard(legacy)).toBe(false)
    expect(isAgentUnadoptedCard(userCard)).toBe(false)
  })
})
