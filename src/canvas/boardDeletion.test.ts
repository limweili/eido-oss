import { describe, expect, it, vi } from 'vitest'
import { executeBoardDeletion } from './boardDeletion'

describe('executeBoardDeletion', () => {
  it('captures the selected cards and connections before awaiting group confirmation', async () => {
    const cardIds = ['group-a']
    const connectionIds = ['wire-a']
    let settleConfirmation: ((confirmed: boolean) => void) | undefined
    const confirmGroupDelete = vi.fn(
      () => new Promise<boolean>((resolve) => { settleConfirmation = resolve }),
    )
    const deleteCard = vi.fn()
    const deleteConnections = vi.fn()

    const deletion = executeBoardDeletion({
      cardIds,
      connectionIds,
      includesGroup: true,
      confirmGroupDelete,
      deleteCard,
      deleteConnections,
    })
    cardIds.splice(0, 1, 'note-selected-later')
    connectionIds.splice(0, 1, 'wire-selected-later')
    settleConfirmation?.(true)

    await expect(deletion).resolves.toBe(true)
    expect(deleteCard).toHaveBeenCalledTimes(1)
    expect(deleteCard).toHaveBeenCalledWith('group-a')
    expect(deleteConnections).toHaveBeenCalledWith(['wire-a'])
  })

  it('leaves the captured target intact when confirmation is cancelled', async () => {
    const deleteCard = vi.fn()
    const deleteConnections = vi.fn()

    await expect(
      executeBoardDeletion({
        cardIds: ['group-a'],
        connectionIds: ['wire-a'],
        includesGroup: true,
        confirmGroupDelete: async () => false,
        deleteCard,
        deleteConnections,
      }),
    ).resolves.toBe(false)
    expect(deleteCard).not.toHaveBeenCalled()
    expect(deleteConnections).not.toHaveBeenCalled()
  })
})
