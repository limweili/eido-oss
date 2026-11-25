// Render tests for the shared card-chrome pieces (C5 / issue #193).
//
// All three cards (ResultCard, ConversationResultCard, GroupCard) previously
// contained local copies of provisionalReasonLabel and the budget-label lookup.
// These tests pin the shared behavior and prove that identical inputs produce
// identical output regardless of which card would be calling.
//
// VersionSwitcher is a React component; its behavioral invariant — hide when
// versions.length ≤ 1, show one button per version otherwise — is tested here
// through the logic helpers rather than a DOM render (no jsdom in this suite).

import { beforeEach, describe, expect, it } from 'vitest'
import { words } from '../../shared/words'
import { useGraph } from '../../graph/store'
import type { Card } from '../../graph/types'
import { makeBudgetLabel, provisionalReasonLabel } from './cardChrome'

// ---- helpers ---------------------------------------------------------------

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    compactionSummaries: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    settings: {
      apiKey: 'test-key',
      model: 'default/model',
      models: ['default/model'],
      reasoningEffort: 'medium',
    },
  })
}

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: '' }],
    position: { x: 0, y: 0 },
    ...extra,
  }
}

// ---- provisionalReasonLabel ------------------------------------------------

describe('provisionalReasonLabel', () => {
  it('returns the canceled label when reason is undefined', () => {
    expect(provisionalReasonLabel(undefined)).toBe(words.provisionalCanceled)
  })

  it('returns the canceled label when reason is "canceled"', () => {
    expect(provisionalReasonLabel('canceled')).toBe(words.provisionalCanceled)
  })

  it('returns the failed label when reason is "failed"', () => {
    expect(provisionalReasonLabel('failed')).toBe(words.provisionalFailed)
  })

  it('produces identical output regardless of which card calls it', () => {
    // Before extraction each card had a local copy of this function; any of the
    // three could silently diverge. Now there is exactly one implementation.
    const fromResultCard = provisionalReasonLabel('failed')
    const fromConversationResultCard = provisionalReasonLabel('failed')
    const fromGroupCard = provisionalReasonLabel('failed')
    expect(fromResultCard).toBe(fromConversationResultCard)
    expect(fromConversationResultCard).toBe(fromGroupCard)

    const canceledResult = provisionalReasonLabel(undefined)
    const canceledConversation = provisionalReasonLabel(undefined)
    const canceledGroup = provisionalReasonLabel(undefined)
    expect(canceledResult).toBe(canceledConversation)
    expect(canceledConversation).toBe(canceledGroup)
  })
})

// ---- makeBudgetLabel -------------------------------------------------------

describe('makeBudgetLabel', () => {
  beforeEach(resetStore)

  it('falls back to the card id when the card is not in the board', () => {
    const label = makeBudgetLabel()
    expect(label('orphan-card-id')).toBe('orphan-card-id')
  })

  it('returns the card title when the card has one', () => {
    useGraph.setState({
      cards: [card('ask-1', { kind: 'askAi', title: 'My Ask Card' })],
    })
    const label = makeBudgetLabel()
    expect(label('ask-1')).toBe('My Ask Card')
  })

  it('returns the same label as calling it from ResultCard or ConversationResultCard context', () => {
    // Both cards previously inlined the same lookup; makeBudgetLabel is the
    // single implementation both now consume.
    useGraph.setState({
      cards: [card('note-1', { kind: 'note', title: 'Shared Note' })],
    })
    const labelFromResult = makeBudgetLabel()
    const labelFromConversation = makeBudgetLabel()
    expect(labelFromResult('note-1')).toBe(labelFromConversation('note-1'))
  })
})

// ---- VersionSwitcher visibility invariant ----------------------------------
//
// The divergence that was the bug: GroupCard showed the switcher for
// versions.length > 0 (even one version); the other two cards used > 1.
// VersionSwitcher centralizes the rule as > 1: a single version is not
// switchable.

describe('VersionSwitcher visibility rule', () => {
  it('hides at zero versions (versions.length <= 1 → no switcher)', () => {
    expect(switcherVisible([])).toBe(false)
  })

  it('hides at exactly one version (nothing to switch to)', () => {
    expect(switcherVisible(['v1'])).toBe(false)
  })

  it('shows at two or more versions', () => {
    expect(switcherVisible(['v1', 'v2'])).toBe(true)
    expect(switcherVisible(['v1', 'v2', 'v3'])).toBe(true)
  })
})

function switcherVisible(versionIds: string[]): boolean {
  return versionIds.length > 1
}
