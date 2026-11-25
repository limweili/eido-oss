import { newId } from '../shared/ids'
import { listModPartIdentities } from './identity'
import type { Mod, ModKind, ModPartIdFactory, ModPartRole } from './model'
import { countModCap } from './prompt'

export const MOD_PART_BOUNDS: Record<ModKind, { min: number; max: number }> = {
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
}

/** How many growable parts the Mod holds now, or null when growth never lives
 *  in the head chrome (pad is fixed; matrix grows from its own ghost row/column). */
export function modGrowthCount(mod: Mod): number | null {
  switch (mod.kind) {
    case 'slider':
    case 'dial':
    case 'count':
    case 'switch':
    case 'order':
    case 'mixer':
      return mod.state.items.length
    case 'select':
      return mod.state.options.length
    case 'filter':
      return mod.state.lanes.length
    case 'radar':
      return mod.state.axes.length
    case 'pad':
    case 'matrix':
      return null
  }
}

export function canGrowMod(mod: Mod): boolean {
  const count = modGrowthCount(mod)
  return count !== null && count < MOD_PART_BOUNDS[mod.kind].max
}

export type GrowModOptions = {
  matrixAxis?: 'row' | 'column'
  createId?: ModPartIdFactory
}

const createDefaultId: ModPartIdFactory = (role) => newId(`mod-${role}`)

function growthOrdinal(mod: Mod, role: ModPartRole): number {
  if (mod.kind === 'matrix') {
    return role === 'row' ? mod.state.rows.length : mod.state.rows.length + mod.state.cols.length
  }
  return listModPartIdentities(mod).length
}

function growthId(mod: Mod, role: ModPartRole, createId: ModPartIdFactory): string {
  const id = createId(role, growthOrdinal(mod, role))
  const used = new Set(listModPartIdentities(mod).map(({ sourceId }) => sourceId))
  if (!id.trim()) throw new Error('A grown Mod part id must be non-blank')
  if (used.has(id)) throw new Error('A grown Mod part id must be globally unique')
  return id
}

export function normalizeMixerShares(mod: Mod<'mixer'>): void {
  const total = mod.state.items.reduce((sum, item) => sum + item.v, 0)
  if (total > 0 && Number.isFinite(total)) {
    mod.state.items.forEach((item) => { item.v = item.v / total * 100 })
    return
  }
  const share = 100 / mod.state.items.length
  mod.state.items.forEach((item) => { item.v = share })
}

export function growMod(mod: Mod, options: GrowModOptions = {}): boolean {
  const createId = options.createId ?? createDefaultId
  switch (mod.kind) {
    case 'slider':
      if (mod.state.items.length >= MOD_PART_BOUNDS.slider.max) return false
      mod.state.items.push({
        id: growthId(mod, 'item', createId),
        label: `SLIDER ${mod.state.items.length + 1}`,
        v: 50,
        frame: '',
      })
      return true
    case 'dial':
      if (mod.state.items.length >= MOD_PART_BOUNDS.dial.max) return false
      mod.state.items.push({
        id: growthId(mod, 'item', createId),
        label: `DIAL ${mod.state.items.length + 1}`,
        v: 50,
        frame: '',
      })
      return true
    case 'count':
      if (mod.state.items.length >= MOD_PART_BOUNDS.count.max) return false
      mod.state.items.push({
        id: growthId(mod, 'item', createId),
        label: `COUNT ${mod.state.items.length + 1}`,
        n: Math.min(3, countModCap(mod)),
        frame: '',
      })
      return true
    case 'switch':
      if (mod.state.items.length >= MOD_PART_BOUNDS.switch.max) return false
      mod.state.items.push({
        id: growthId(mod, 'item', createId),
        label: `SWITCH ${mod.state.items.length + 1}`,
        on: false,
        frame: '',
      })
      return true
    case 'pad':
      return false
    case 'select':
      if (mod.state.options.length >= MOD_PART_BOUNDS.select.max) return false
      mod.state.options.push({
        id: growthId(mod, 'option', createId),
        label: `OPTION ${mod.state.options.length + 1}`,
        frame: '',
      })
      return true
    case 'order':
      if (mod.state.items.length >= MOD_PART_BOUNDS.order.max) return false
      mod.state.items.push({
        id: growthId(mod, 'item', createId),
        label: `ITEM ${mod.state.items.length + 1}`,
        frame: '',
      })
      mod.state.perm.push(mod.state.items.length - 1)
      return true
    case 'filter':
      if (mod.state.lanes.length >= MOD_PART_BOUNDS.filter.max) return false
      mod.state.lanes.push({
        id: growthId(mod, 'lane', createId),
        label: `LIMIT ${mod.state.lanes.length + 1}`,
        mode: 'no-more-than',
        lo: 0,
        hi: 60,
        frame: '',
      })
      return true
    case 'mixer': {
      if (mod.state.items.length >= MOD_PART_BOUNDS.mixer.max) return false
      const id = growthId(mod, 'item', createId)
      const share = 100 / (mod.state.items.length + 1)
      mod.state.items.forEach((item) => { item.v *= (100 - share) / 100 })
      mod.state.items.push({
        id,
        label: `CHANNEL ${mod.state.items.length + 1}`,
        v: share,
        frame: '',
      })
      return true
    }
    case 'radar':
      if (mod.state.axes.length >= MOD_PART_BOUNDS.radar.max) return false
      mod.state.axes.push({
        id: growthId(mod, 'axis', createId),
        label: `AXIS ${mod.state.axes.length + 1}`,
        v: 50,
      })
      return true
    case 'matrix': {
      const axis = options.matrixAxis ?? 'row'
      if (axis === 'row') {
        if (mod.state.rows.length >= MOD_PART_BOUNDS.matrix.max) return false
        mod.state.rows.push({
          id: growthId(mod, 'row', createId),
          label: `ROW ${mod.state.rows.length + 1}`,
        })
        mod.state.cells.push(mod.state.cols.map(() => 0))
        return true
      }
      if (mod.state.cols.length >= MOD_PART_BOUNDS.matrix.max) return false
      mod.state.cols.push({
        id: growthId(mod, 'column', createId),
        label: `COL ${mod.state.cols.length + 1}`,
      })
      mod.state.cells.forEach((row) => row.push(0))
      return true
    }
  }
}

export function stepMatrixCell(mod: Mod<'matrix'>, row: number, column: number): number {
  const cells = mod.state.cells[row]
  if (!cells || cells[column] === undefined) throw new RangeError('Matrix cell is outside the Mod')
  cells[column] = (cells[column] + 1) % mod.state.steps
  return cells[column]
}
