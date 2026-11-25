import { describe, expect, it } from 'vitest'
import { boardKeyboardIntent, type BoardKeyboardInput } from './keyboard'

function intent(overrides: Partial<BoardKeyboardInput>) {
  return boardKeyboardIntent({
    readOnly: false,
    key: '',
    targetIsEditable: false,
    selectedNodeIds: new Set(),
    selectedConnectionIds: new Set(),
    ...overrides,
  })
}

describe('board keyboard shortcuts', () => {
  it('selects the complete Board with the platform select-all shortcut', () => {
    const selection = intent({ key: 'a', metaKey: true })
    expect(selection).toEqual({ type: 'selectAll' })
    // Logical whole-Board selection must never become selected Card ids: those
    // ids are #556 Live owners and would remount every Card.
    expect(selection).not.toHaveProperty('cardIds')
    expect(intent({ key: 'A', ctrlKey: true })).toEqual({ type: 'selectAll' })
  })

  it('routes logical whole-Board copy without manufacturing Live-owner ids', () => {
    expect(intent({ key: 'c', metaKey: true, wholeBoardSelected: true })).toEqual({
      type: 'copyWholeBoard',
    })
  })

  it('copies selected Cards through the Board command seam', () => {
    expect(intent({ key: 'c', metaKey: true, selectedNodeIds: new Set(['visible', 'offscreen']) })).toEqual({
      type: 'copyCards',
      cardIds: ['visible', 'offscreen'],
    })
  })

  it('leaves an exact visible text selection to the native copy path', () => {
    expect(
      intent({
        key: 'c',
        metaKey: true,
        hasTextSelection: true,
        selectedNodeIds: new Set(['visible']),
      }),
    ).toBeNull()
  })

  it('deletes selected cards with Delete', () => {
    expect(intent({ key: 'Delete', selectedNodeIds: new Set(['note-1']) })).toEqual({
      type: 'deleteSelection',
      cardIds: ['note-1'],
      connectionIds: [],
    })
  })

  it('deletes selected cards with Backspace', () => {
    expect(intent({ key: 'Backspace', selectedNodeIds: new Set(['note-1', 'ask-1']) })).toEqual({
      type: 'deleteSelection',
      cardIds: ['note-1', 'ask-1'],
      connectionIds: [],
    })
  })

  it('does not delete while focus is in editable text', () => {
    expect(
      intent({ key: 'Backspace', targetIsEditable: true, selectedNodeIds: new Set(['note-1']) }),
    ).toBeNull()
  })

  it('deletes a selected connection when no card is selected', () => {
    expect(intent({ key: 'Delete', selectedConnectionIds: new Set(['conn-1']) })).toEqual({
      type: 'deleteSelection',
      cardIds: [],
      connectionIds: ['conn-1'],
    })
  })

  it('deletes every selected connection at once', () => {
    expect(intent({ key: 'Delete', selectedConnectionIds: new Set(['conn-1', 'conn-2']) })).toEqual({
      type: 'deleteSelection',
      cardIds: [],
      connectionIds: ['conn-1', 'conn-2'],
    })
  })

  it('deletes selected cards and connections together', () => {
    expect(
      intent({
        key: 'Delete',
        selectedNodeIds: new Set(['note-1']),
        selectedConnectionIds: new Set(['conn-1']),
      }),
    ).toEqual({
      type: 'deleteSelection',
      cardIds: ['note-1'],
      connectionIds: ['conn-1'],
    })
  })

  it('does nothing on Delete with an empty selection', () => {
    expect(intent({ key: 'Delete' })).toBeNull()
  })
})
