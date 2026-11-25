import { describe, expect, it } from 'vitest'
import {
  MOD_KIND_ORDER,
  MOD_PART_BOUNDS,
  createSeedMod,
  growMod,
  stepMatrixCell,
  type Mod,
  type ModKind,
} from './index'

const EXPECTED_MAX: Record<Exclude<ModKind, 'pad'>, number> = {
  slider: 8,
  dial: 12,
  count: 6,
  switch: 8,
  select: 7,
  order: 7,
  filter: 3,
  mixer: 6,
  radar: 8,
  matrix: 6,
}

function partCount(mod: Mod): number {
  switch (mod.kind) {
    case 'slider':
    case 'dial':
    case 'count':
    case 'switch':
    case 'order':
    case 'mixer':
      return mod.state.items.length
    case 'filter': return mod.state.lanes.length
    case 'select': return mod.state.options.length
    case 'radar': return mod.state.axes.length
    case 'matrix': return mod.state.rows.length
    case 'pad': return 2
  }
}

describe('Mod growth and invariant helpers', () => {
  it('publishes the prototype min/max bounds and stops every kind at its cap', () => {
    expect(MOD_PART_BOUNDS).toEqual({
      slider: { min: 1, max: 8 },
      dial: { min: 1, max: 12 },
      count: { min: 1, max: 6 },
      switch: { min: 1, max: 8 },
      pad: { min: 2, max: 2 },
      select: { min: 2, max: 7 },
      order: { min: 2, max: 7 },
      filter: { min: 1, max: 3 },
      mixer: { min: 2, max: 6 },
      radar: { min: 3, max: 8 },
      matrix: { min: 1, max: 6 },
    })

    for (const kind of MOD_KIND_ORDER) {
      const mod = createSeedMod(kind)
      if (mod.kind === 'pad') {
        expect(growMod(mod)).toBe(false)
        continue
      }
      for (let index = 0; index < 20; index += 1) growMod(mod)
      expect(partCount(mod)).toBe(EXPECTED_MAX[mod.kind])
      expect(growMod(mod)).toBe(false)
    }
  })

  it('ports every ordinary new-part default, including intentionally unsnapped filter growth', () => {
    const slider = createSeedMod('slider')
    growMod(slider, { createId: () => 'new-slider' })
    expect(slider.state.items[slider.state.items.length - 1]).toEqual({
      id: 'new-slider', label: 'SLIDER 3', v: 50, frame: '',
    })

    const count = createSeedMod('count')
    count.state.mode = 'ratio'
    count.state.steps = 2
    growMod(count, { createId: () => 'new-count' })
    expect(count.state.items[count.state.items.length - 1]).toEqual({
      id: 'new-count', label: 'COUNT 3', n: 2, frame: '',
    })

    const filter = createSeedMod('filter')
    growMod(filter, { createId: () => 'new-filter' })
    expect(filter.state.lanes[filter.state.lanes.length - 1]).toEqual({
      id: 'new-filter',
      label: 'LIMIT 2',
      mode: 'no-more-than',
      lo: 0,
      hi: 60,
      frame: '',
    })

    const order = createSeedMod('order')
    growMod(order, { createId: () => 'new-order' })
    expect(order.state.items[order.state.items.length - 1]).toEqual({
      id: 'new-order', label: 'ITEM 4', frame: '',
    })
    expect(order.state.perm).toEqual([0, 1, 2, 3])
  })

  it('adds mixer channels proportionally while keeping one 100% whole', () => {
    const mixer = createSeedMod('mixer')
    expect(growMod(mixer, { createId: () => 'new-channel' })).toBe(true)
    expect(mixer.state.items.map(({ label, v }) => ({ label, v }))).toEqual([
      { label: 'CLARITY', v: 37.5 },
      { label: 'DEPTH', v: 24 },
      { label: 'BREVITY', v: 13.5 },
      { label: 'CHANNEL 4', v: 25 },
    ])
    expect(mixer.state.items.reduce((sum, item) => sum + item.v, 0)).toBe(100)
  })

  it('leaves mixer state untouched when growth identity allocation fails', () => {
    const mixer = createSeedMod('mixer')
    const before = structuredClone(mixer.state)
    expect(() => growMod(mixer, { createId: () => mixer.state.items[0].id })).toThrow(/unique/i)
    expect(mixer.state).toEqual(before)
  })

  it('grows both matrix dimensions and cycles cells modulo the configured steps', () => {
    const matrix = createSeedMod('matrix')
    expect(growMod(matrix, { matrixAxis: 'row', createId: () => 'row-3' })).toBe(true)
    expect(matrix.state.rows[matrix.state.rows.length - 1]).toEqual({ id: 'row-3', label: 'ROW 3' })
    expect(matrix.state.cells[matrix.state.cells.length - 1]).toEqual([0, 0, 0])

    expect(growMod(matrix, { matrixAxis: 'column', createId: () => 'col-4' })).toBe(true)
    expect(matrix.state.cols[matrix.state.cols.length - 1]).toEqual({ id: 'col-4', label: 'COL 4' })
    expect(matrix.state.cells.every((row) => row.length === 4 && row[row.length - 1] === 0)).toBe(true)

    expect(stepMatrixCell(matrix, 0, 0)).toBe(0)
    expect(matrix.state.cells[0][0]).toBe(0)
    expect(stepMatrixCell(matrix, 0, 0)).toBe(1)
  })
})
