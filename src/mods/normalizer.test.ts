import { describe, expect, it, vi } from 'vitest'
import {
  MOD_KIND_ORDER,
  createSeedMod,
  defaultTreatment,
  growMod,
  normalizeMod,
  remapModPartIdentities,
  snapshotModPromptSource,
} from './index'

describe('the v2-only Mod normalizer', () => {
  it('returns every already-valid v2 seed as the identical object without allocating', () => {
    const allocatePartId = vi.fn(() => 'unused')
    for (const kind of MOD_KIND_ORDER) {
      const mod = createSeedMod(kind)
      expect(normalizeMod(mod, { allocatePartId })).toBe(mod)
    }
    expect(allocatePartId).not.toHaveBeenCalled()
  })

  it('also preserves valid prototype growth that does not land on a detent', () => {
    const filter = createSeedMod('filter')
    growMod(filter, { createId: () => 'grown-lane' })
    expect(filter.state.lanes[1].hi).toBe(60)
    expect(normalizeMod(filter)).toBe(filter)
  })

  it('rejects primitives, arrays, unknown kinds, and legacy Mod documents', () => {
    expect(normalizeMod(null)).toBeUndefined()
    expect(normalizeMod('mod')).toBeUndefined()
    expect(normalizeMod([])).toBeUndefined()
    expect(normalizeMod({ kind: 'future', title: 'Future', state: {} })).toBeUndefined()
    expect(normalizeMod({ id: 'legacy', label: 'Legacy', controls: [] })).toBeUndefined()
    expect(normalizeMod({ ...createSeedMod('slider'), id: 'forbidden-root-id' })).toBeUndefined()
  })

  it('repairs a minimal recognized document for every kind and is stable thereafter', () => {
    for (const kind of MOD_KIND_ORDER) {
      const repaired = normalizeMod({ kind, extension: { kept: kind } })!
      expect(repaired.kind).toBe(kind)
      expect((repaired as typeof repaired & { extension: unknown }).extension).toEqual({ kept: kind })
      expect(normalizeMod(repaired)).toBe(repaired)
    }
  })

  it('repairs malformed known states without mutation and preserves JSON-safe extensions', () => {
    const raw = Object.freeze({
      kind: 'order',
      title: 7,
      accent: null,
      treatOverride: '   ',
      extension: Object.freeze({ top: true }),
      state: Object.freeze({
        extension: Object.freeze({ state: true }),
        items: Object.freeze([
          Object.freeze({ id: 'kept', label: 'FIRST', frame: '', extension: 'first' }),
          Object.freeze({ id: '', label: 9, frame: null, extension: 'second' }),
          Object.freeze({ id: 'kept', label: 'THIRD', frame: '', extension: 'third' }),
        ]),
        perm: Object.freeze([2, 2, 99, 0]),
        frame: 42,
      }),
    })
    const allocatePartId = vi.fn((_, attempt: number) => attempt === 0 ? 'kept' : `fresh-${attempt}`)

    const repaired = normalizeMod(raw, { allocatePartId })!

    expect(raw.state.items[1].id).toBe('')
    expect(repaired).not.toBe(raw)
    expect((repaired as typeof repaired & { extension: unknown }).extension).toEqual({ top: true })
    expect((repaired.state as typeof repaired.state & { extension: unknown }).extension).toEqual({ state: true })
    if (repaired.kind !== 'order') throw new Error('expected order')
    expect(repaired.state.items.map(({ id }) => id)).toEqual(['kept', 'fresh-1', 'fresh-2'])
    expect((repaired.state.items[1] as typeof repaired.state.items[1] & { extension: string }).extension).toBe('second')
    expect(repaired.state.perm).toEqual([2, 0, 1])
    expect(repaired.treatOverride).toBeNull()
    expect(normalizeMod(repaired)).toBe(repaired)
  })

  it('repairs invalid mixer shares without imposing the gesture-only three-percent floor', () => {
    const mixer = createSeedMod('mixer')
    mixer.state.items[0].v = -10
    mixer.state.items[1].v = 1
    mixer.state.items[2].v = Number.NaN

    const repaired = normalizeMod(mixer)!
    if (repaired.kind !== 'mixer') throw new Error('expected mixer')
    expect(repaired).not.toBe(mixer)
    expect(repaired.state.items.map(({ v }) => v)).toEqual([0, 100, 0])
    expect(repaired.state.items.some(({ v }) => v < 3)).toBe(true)
    expect(repaired.state.items.reduce((sum, { v }) => sum + v, 0)).toBe(100)
    expect(normalizeMod(repaired)).toBe(repaired)
  })

  it('repairs a jagged matrix into exact dimensions and modulo-safe values', () => {
    const matrix = createSeedMod('matrix')
    const raw = {
      ...matrix,
      state: {
        ...matrix.state,
        steps: 99,
        stepNames: ['zero'],
        rows: [...matrix.state.rows, { id: 'row-extra', label: 7 }],
        cols: matrix.state.cols.slice(0, 2),
        cells: [[9], [-1, 1, 2, 3], 'junk'],
      },
    }

    const repaired = normalizeMod(raw)!
    if (repaired.kind !== 'matrix') throw new Error('expected matrix')
    expect(repaired.state.steps).toBe(3)
    expect(repaired.state.stepNames).toEqual(['zero', 'lightly', 'strongly'])
    expect(repaired.state.rows).toHaveLength(3)
    expect(repaired.state.cols).toHaveLength(2)
    expect(repaired.state.cells).toEqual([[2, 0], [0, 1], [0, 0]])
    expect(normalizeMod(repaired)).toBe(repaired)
  })

  it('repairs duplicate identities across matrix row and column roles in canonical order', () => {
    const matrix = createSeedMod('matrix')
    matrix.state.rows[0].id = 'shared-id'
    matrix.state.cols[0].id = 'shared-id'
    const repaired = normalizeMod(matrix, {
      allocatePartId: ({ role }, attempt) => `${role}-${attempt}`,
    })!
    if (repaired.kind !== 'matrix') throw new Error('expected matrix')
    expect(repaired.state.rows[0].id).toBe('shared-id')
    expect(repaired.state.cols[0].id).toBe('column-0')
    expect(normalizeMod(repaired)).toBe(repaired)
  })

  it('reserves a later valid identity before repairing an earlier blank identity', () => {
    const slider = createSeedMod('slider')
    slider.state.items[0].id = ''
    slider.state.items[1].id = 'later-valid-id'
    const repaired = normalizeMod(slider, {
      allocatePartId: (_, attempt) => attempt === 0 ? 'later-valid-id' : 'fresh-id',
    })!
    if (repaired.kind !== 'slider') throw new Error('expected slider')
    expect(repaired.state.items.map(({ id }) => id)).toEqual(['fresh-id', 'later-valid-id'])
    expect(normalizeMod(repaired)).toBe(repaired)
  })

  it('keeps own __proto__ extensions inert through repair, snapshots, and remapping', () => {
    const raw = createSeedMod('slider') as unknown as Record<string, unknown>
    const state = raw.state as Record<string, unknown>
    const items = state.items as Record<string, unknown>[]
    const defineProtoData = (target: object, marker: string) => {
      Object.defineProperty(target, '__proto__', {
        value: { marker },
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    defineProtoData(raw, 'root')
    defineProtoData(state, 'state')
    defineProtoData(items[0], 'member')
    items[0].id = ''

    const repaired = normalizeMod(raw)!
    if (repaired.kind !== 'slider') throw new Error('expected slider')
    const snapshot = snapshotModPromptSource(repaired)
    const remapped = remapModPartIdentities(repaired, ({ ordinal }) => `remapped-${ordinal}`).value
    const hasOwnProto = (value: object) => Object.prototype.hasOwnProperty.call(value, '__proto__')

    for (const value of [
      repaired,
      repaired.state,
      repaired.state.items[0],
      snapshot.state,
      snapshot.state.items[0],
      remapped,
      remapped.state,
      remapped.state.items[0],
    ]) {
      expect(hasOwnProto(value)).toBe(true)
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    }
    expect(hasOwnProto(snapshot)).toBe(false)
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype)
    expect(JSON.stringify(repaired)).toContain('"__proto__":{"marker":"root"}')
    expect((repaired as unknown as { __proto__: { marker: string } }).__proto__.marker).toBe('root')
    expect((repaired.state as unknown as { __proto__: { marker: string } }).__proto__.marker).toBe('state')
    expect((repaired.state.items[0] as unknown as { __proto__: { marker: string } }).__proto__.marker).toBe('member')
    expect(({} as { marker?: string }).marker).toBeUndefined()
  })

  it('canonicalizes a treatment override against the repaired state', () => {
    const count = createSeedMod('count')
    const raw = {
      ...count,
      state: { ...count.state, mode: 'future-mode' },
      treatOverride: defaultTreatment(count),
    }
    const repaired = normalizeMod(raw)!
    if (repaired.kind !== 'count') throw new Error('expected count')
    expect(repaired.state.mode).toBe('number')
    expect(repaired.treatOverride).toBeNull()
  })
})
