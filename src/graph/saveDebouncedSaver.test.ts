import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDebouncedSaver } from './save'
import type { SavedBoard } from './types'

const board = (text: string): SavedBoard => ({
  version: 1,
  cards: [
    {
      id: 'note-1',
      kind: 'note',
      blocks: [{ id: 'block-1', text }],
      position: { x: 0, y: 0 },
    },
  ],
  connections: [],
  outputs: [],
  runs: [],
  updatedAt: '2026-08-22T00:00:00.000Z',
})

describe('makeDebouncedSaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('captures a lazy source only once when the quiet period expires', async () => {
    const captureFirst = vi.fn(() => board('first'))
    const captureLatest = vi.fn(() => board('latest'))
    const save = vi.fn(async (_next: SavedBoard) => {})
    const states: string[] = []
    const saver = makeDebouncedSaver(3_000, (state) => states.push(state), save)

    saver(captureFirst)
    saver(captureLatest)

    expect(captureFirst).not.toHaveBeenCalled()
    expect(captureLatest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_999)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(captureFirst).not.toHaveBeenCalled()
    expect(captureLatest).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(board('latest'))
    expect(states).toEqual(['saving', 'saved'])
  })

  it('flushes immediately and does not repeat after its cancelled timer', async () => {
    const capture = vi.fn(() => board('explicit'))
    const save = vi.fn(async (_next: SavedBoard) => {})
    const saver = makeDebouncedSaver(3_000, () => {}, save)

    saver(capture)
    await saver.flush()
    await vi.advanceTimersByTimeAsync(3_000)

    expect(capture).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('serializes a save already in flight, then persists the latest source', async () => {
    let releaseFirst!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const saveOrder: string[] = []
    const save = vi.fn(async (next: SavedBoard) => {
      saveOrder.push(next.cards[0]?.blocks[0]?.text ?? '')
      if (saveOrder.length === 1) await firstWrite
    })
    const saver = makeDebouncedSaver(3_000, () => {}, save)

    saver(() => board('first'))
    const firstFlush = saver.flush()
    await Promise.resolve()
    expect(saveOrder).toEqual(['first'])

    saver(() => board('latest'))
    const latestFlush = saver.flush()
    await Promise.resolve()
    expect(saveOrder).toEqual(['first'])

    releaseFirst()
    await firstFlush
    await latestFlush

    expect(saveOrder).toEqual(['first', 'latest'])
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('does not consume a newer source before its own quiet period', async () => {
    let releaseFirst!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const saveOrder: string[] = []
    const states: string[] = []
    const save = vi.fn(async (next: SavedBoard) => {
      saveOrder.push(next.cards[0]?.blocks[0]?.text ?? '')
      if (saveOrder.length === 1) await firstWrite
    })
    const saver = makeDebouncedSaver(3_000, (state) => states.push(state), save)

    saver(() => board('first'))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(saveOrder).toEqual(['first'])

    saver(() => board('latest'))
    await vi.advanceTimersByTimeAsync(2_999)
    releaseFirst()
    await Promise.resolve()
    await Promise.resolve()

    // The first write has completed, but the newer source is still inside
    // its own three-second quiet period. It must not be pulled into the old
    // drain, and the old write must not report a false "saved" state.
    expect(saveOrder).toEqual(['first'])
    expect(states).toEqual(['saving'])

    await vi.advanceTimersByTimeAsync(1)
    expect(saveOrder).toEqual(['first', 'latest'])
    expect(states).toEqual(['saving', 'saving', 'saved'])
  })

  it('preserves a lazy compound payload and its Idea identity through the queue', async () => {
    type SaveRequest = { ideaId: string; board: SavedBoard }
    const request: SaveRequest = { ideaId: 'idea-a', board: board('latest') }
    const capture = vi.fn(() => request)
    const save = vi.fn(async (_next: SaveRequest) => {})
    const saver = makeDebouncedSaver<SaveRequest>(3_000, () => {}, save)

    saver(capture)
    expect(capture).not.toHaveBeenCalled()

    await saver.flush()

    expect(capture).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).toBe(request)
    expect(save.mock.calls[0]?.[0]?.ideaId).toBe('idea-a')
  })

  it('keeps an explicit flush open for sources scheduled during its write', async () => {
    let releaseFirst!: () => void
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    type SaveRequest = { ideaId: string; board: SavedBoard }
    const saveOrder: string[] = []
    const save = vi.fn(async (next: SaveRequest) => {
      saveOrder.push(`${next.ideaId}:${next.board.cards[0]?.blocks[0]?.text ?? ''}`)
      if (saveOrder.length === 1) await firstWrite
    })
    const saver = makeDebouncedSaver<SaveRequest>(3_000, () => {}, save)

    saver(() => ({ ideaId: 'idea-a', board: board('first') }))
    const flush = saver.flush()
    await Promise.resolve()
    expect(saveOrder).toEqual(['idea-a:first'])

    // This source arrives after the flush has started. It must not wait for a
    // three-second timer, and flush must not resolve after only the older
    // write.
    saver(() => ({ ideaId: 'idea-a', board: board('latest') }))
    releaseFirst()
    await flush

    expect(saveOrder).toEqual(['idea-a:first', 'idea-a:latest'])
  })

  it('rejects an explicit durability flush while its exact source still cannot be saved', async () => {
    const failure = new Error('disk unavailable')
    const save = vi.fn(async (_next: SavedBoard) => {
      throw failure
    })
    const states: string[] = []
    const saver = makeDebouncedSaver(3_000, (state) => states.push(state), save)

    saver(() => board('must-survive'))

    await expect(saver.flush()).rejects.toBe(failure)
    expect(save).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['saving', 'failed'])

    await expect(saver.flush()).rejects.toBe(failure)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('clears an earlier timer failure only after a newer exact source saves successfully', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('first write failed'))
      .mockResolvedValue(undefined)
    const states: string[] = []
    const saver = makeDebouncedSaver(3_000, (state) => states.push(state), save)

    saver(() => board('failed'))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(states).toEqual(['saving', 'failed'])

    saver(() => board('newest'))
    await expect(saver.flush()).resolves.toBeUndefined()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toEqual(board('newest'))
    expect(states).toEqual(['saving', 'failed', 'saving', 'saved'])
  })
})
