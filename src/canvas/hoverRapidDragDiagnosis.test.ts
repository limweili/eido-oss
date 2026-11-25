// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCardActivationOwnership } from './cardInteraction'

const emptyIds = new Set<string>()

function ownershipProps() {
  return {
    enabled: true,
    focusedCardId: null,
    selectedCardIds: emptyIds,
    editingCardIds: emptyIds,
    scrollingCardId: null,
    gestureParticipantIds: emptyIds,
    activeMediaCardIds: emptyIds,
  }
}

describe('hover / rapid drag diagnosis', () => {
  it('keeps ordinary hover geometry-only instead of acquiring a Live owner', () => {
    const { result } = renderHook(() => useCardActivationOwnership(ownershipProps()))

    act(() => {
      result.current.setHoveredCardId('ordinary')
    })

    expect(result.current.hoveredCardId).toBe('ordinary')
    expect(result.current.liveOwnerIds.has('ordinary')).toBe(false)
    expect(result.current.ownerSnapshot('ordinary').ownerTokens).not.toContain('hovered')
  })

  it('keeps a rapid ordinary hover sequence out of Live ownership', () => {
    const { result } = renderHook(() => useCardActivationOwnership(ownershipProps()))

    act(() => {
      for (let index = 0; index < 30; index += 1) {
        result.current.setHoveredCardId(`ordinary-${index}`)
      }
    })

    expect(result.current.hoveredCardId).toBe('ordinary-29')
    expect(result.current.liveOwnerIds).toHaveLength(0)
  })
})
