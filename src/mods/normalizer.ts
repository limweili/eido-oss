import { newId } from '../shared/ids'
import { MOD_PART_BOUNDS } from './growth'
import { listModPartIdentities, type ModPartIdentity } from './identity'
import {
  MOD_KIND_ORDER,
  type CountMode,
  type FilterMode,
  type Mod,
  type ModKind,
  type ModStateByKind,
} from './model'
import { normalizeTreatmentOverride } from './prompt'
import { createSeedMod } from './seeds'
import { cloneDetached } from './snapshot'

type UnknownRecord = Record<string, unknown>

export type NormalizeModOptions = {
  allocatePartId?: (identity: ModPartIdentity, attempt: number) => string
}

const COUNT_MODES: readonly CountMode[] = ['number', 'percent', 'ratio']
const FILTER_MODES: readonly FilterMode[] = ['no-more-than', 'at-least', 'between']
const MIXER_TOTAL_EPSILON = 1e-9
const MAX_ID_ALLOCATION_ATTEMPTS = 64

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isKind(value: unknown): value is ModKind {
  return typeof value === 'string' && MOD_KIND_ORDER.includes(value as ModKind)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max
}

function isPercent(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function validSteps(value: unknown, allowOff: boolean, max = 10): value is number {
  return isFiniteNumber(value)
    && Number.isInteger(value)
    && ((allowOff && value === 0) || (value >= 2 && value <= max))
}

function repairedSteps(value: unknown, fallback: number, allowOff: boolean, max = 10): number {
  return validSteps(value, allowOff, max) ? value : fallback
}

function validStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function validPartBase(value: unknown): value is UnknownRecord & { id: string; label: string } {
  return isRecord(value)
    && typeof value.id === 'string'
    && Boolean(value.id.trim())
    && typeof value.label === 'string'
}

function validValueItem(value: unknown): boolean {
  return validPartBase(value)
    && isPercent(value.v)
    && typeof value.frame === 'string'
}

function validCommon(value: UnknownRecord): boolean {
  return typeof value.title === 'string'
    && typeof value.accent === 'string'
    && Boolean(value.accent.trim())
    && (value.treatOverride === null || typeof value.treatOverride === 'string')
    && !('id' in value)
}

function validLength(value: unknown, kind: ModKind): value is unknown[] {
  const bounds = MOD_PART_BOUNDS[kind]
  return Array.isArray(value) && value.length >= bounds.min && value.length <= bounds.max
}

function validState(mod: Mod): boolean {
  switch (mod.kind) {
    case 'slider':
    case 'dial':
      return validSteps(mod.state.steps, true)
        && validStrings(mod.state.stops)
        && validLength(mod.state.items, mod.kind)
        && mod.state.items.every(validValueItem)
    case 'count': {
      if (!COUNT_MODES.includes(mod.state.mode)
        || !validSteps(mod.state.steps, false)
        || !validLength(mod.state.items, 'count')) return false
      const cap = mod.state.mode === 'number' ? 10 : mod.state.steps
      return mod.state.items.every((item) => (
        validPartBase(item)
        && typeof item.frame === 'string'
        && isIntegerBetween(item.n, 0, cap)
      ))
    }
    case 'switch':
      return validLength(mod.state.items, 'switch')
        && mod.state.items.every((item) => (
          validPartBase(item)
          && typeof item.on === 'boolean'
          && typeof item.frame === 'string'
        ))
    case 'pad':
      return (['x', 'y'] as const).every((axisName) => {
        const axis = mod.state.axes?.[axisName]
        return validPartBase(axis)
          && typeof axis.lo === 'string'
          && typeof axis.hi === 'string'
          && validSteps(axis.steps, true)
          && typeof axis.frame === 'string'
      }) && isPercent(mod.state.v?.x) && isPercent(mod.state.v?.y)
    case 'select':
      return validLength(mod.state.options, 'select')
        && mod.state.options.every((option) => validPartBase(option) && typeof option.frame === 'string')
        && isIntegerBetween(mod.state.picked, 0, mod.state.options.length - 1)
    case 'order': {
      if (!validLength(mod.state.items, 'order')
        || !mod.state.items.every((item) => validPartBase(item) && typeof item.frame === 'string')
        || typeof mod.state.frame !== 'string'
        || !Array.isArray(mod.state.perm)
        || mod.state.perm.length !== mod.state.items.length) return false
      const seen = new Set<number>()
      return mod.state.perm.every((index) => {
        if (!isIntegerBetween(index, 0, mod.state.items.length - 1) || seen.has(index)) return false
        seen.add(index)
        return true
      })
    }
    case 'filter':
      return validSteps(mod.state.steps, true)
        && validStrings(mod.state.stops)
        && validLength(mod.state.lanes, 'filter')
        && mod.state.lanes.every((lane) => (
          validPartBase(lane)
          && FILTER_MODES.includes(lane.mode)
          && isPercent(lane.lo)
          && isPercent(lane.hi)
          && lane.lo <= lane.hi
          && (lane.mode !== 'no-more-than' || lane.lo === 0)
          && (lane.mode !== 'at-least' || lane.hi === 100)
          && typeof lane.frame === 'string'
        ))
    case 'mixer': {
      if (!validLength(mod.state.items, 'mixer')
        || !mod.state.items.every((item) => (
          validPartBase(item)
          && isFiniteNumber(item.v)
          && item.v >= 0
          && typeof item.frame === 'string'
        ))
        || typeof mod.state.frame !== 'string') return false
      const total = mod.state.items.reduce((sum, item) => sum + item.v, 0)
      return Math.abs(total - 100) <= MIXER_TOTAL_EPSILON
    }
    case 'radar':
      return validSteps(mod.state.steps, true)
        && validLength(mod.state.axes, 'radar')
        && mod.state.axes.every((axis) => (
          validPartBase(axis)
          && isPercent(axis.v)
          && (axis.frame === undefined || typeof axis.frame === 'string')
        ))
    case 'matrix': {
      if (!validSteps(mod.state.steps, false, 5)
        || !validStrings(mod.state.stepNames)
        || mod.state.stepNames.length !== mod.state.steps
        || !validLength(mod.state.rows, 'matrix')
        || !validLength(mod.state.cols, 'matrix')
        || !mod.state.rows.every(validPartBase)
        || !mod.state.cols.every(validPartBase)
        || !Array.isArray(mod.state.cells)
        || mod.state.cells.length !== mod.state.rows.length) return false
      return mod.state.cells.every((row) => (
        Array.isArray(row)
        && row.length === mod.state.cols.length
        && row.every((value) => isIntegerBetween(value, 0, mod.state.steps - 1))
      ))
    }
  }
}

function uniquePartIds(mod: Mod): boolean {
  const identities = listModPartIdentities(mod)
  const ids = new Set<string>()
  return identities.every(({ sourceId }) => {
    if (!sourceId.trim() || ids.has(sourceId)) return false
    ids.add(sourceId)
    return true
  })
}

export function isValidMod(value: unknown): value is Mod {
  if (!isRecord(value) || !isKind(value.kind) || !validCommon(value) || !isRecord(value.state)) {
    return false
  }
  const mod = value as Mod
  if (!validState(mod) || !uniquePartIds(mod)) return false
  return mod.treatOverride === null
    || normalizeTreatmentOverride(mod, mod.treatOverride) === mod.treatOverride
}

function desiredArray(
  value: unknown,
  fallbackLength: number,
  min: number,
  max: number,
): { source: unknown[]; length: number } {
  if (!Array.isArray(value)) {
    return { source: [], length: clamp(fallbackLength, min, max) }
  }
  return { source: value, length: clamp(value.length, min, max) }
}

function sourceRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {}
}

function repairValueItems(
  value: unknown,
  fallback: Mod<'slider'>['state']['items'],
  min: number,
  max: number,
  labelPrefix: string,
): Mod<'slider'>['state']['items'] {
  const desired = desiredArray(value, fallback.length, min, max)
  return Array.from({ length: desired.length }, (_, index) => {
    const source = sourceRecord(desired.source[index])
    const fallbackItem = fallback[index]
    return {
      ...source,
      id: stringOr(source.id, ''),
      label: stringOr(source.label, fallbackItem?.label ?? `${labelPrefix} ${index + 1}`),
      v: clamp(finiteOr(source.v, fallbackItem?.v ?? 50), 0, 100),
      frame: stringOr(source.frame, fallbackItem?.frame ?? ''),
    }
  })
}

function repairState<K extends ModKind>(
  kind: K,
  rawState: unknown,
  fallback: Mod<K>,
): ModStateByKind[K] {
  const source = sourceRecord(rawState)
  switch (kind) {
    case 'slider':
    case 'dial': {
      const fallbackState = fallback.state as Mod<'slider'>['state']
      return {
        ...source,
        steps: repairedSteps(source.steps, fallbackState.steps, true),
        stops: validStrings(source.stops) ? source.stops : fallbackState.stops.slice(),
        items: repairValueItems(
          source.items,
          fallbackState.items,
          MOD_PART_BOUNDS[kind].min,
          MOD_PART_BOUNDS[kind].max,
          kind === 'slider' ? 'SLIDER' : 'DIAL',
        ),
      } as ModStateByKind[K]
    }
    case 'count': {
      const fallbackState = fallback.state as Mod<'count'>['state']
      const mode = COUNT_MODES.includes(source.mode as CountMode)
        ? source.mode as CountMode
        : fallbackState.mode
      const steps = repairedSteps(source.steps, fallbackState.steps, false)
      const desired = desiredArray(
        source.items,
        fallbackState.items.length,
        MOD_PART_BOUNDS.count.min,
        MOD_PART_BOUNDS.count.max,
      )
      const cap = mode === 'number' ? 10 : steps
      const items = Array.from({ length: desired.length }, (_, index) => {
        const item = sourceRecord(desired.source[index])
        const fallbackItem = fallbackState.items[index]
        return {
          ...item,
          id: stringOr(item.id, ''),
          label: stringOr(item.label, fallbackItem?.label ?? `COUNT ${index + 1}`),
          n: clamp(Math.round(finiteOr(item.n, fallbackItem?.n ?? Math.min(3, cap))), 0, cap),
          frame: stringOr(item.frame, fallbackItem?.frame ?? ''),
        }
      })
      return { ...source, mode, steps, items } as ModStateByKind[K]
    }
    case 'switch': {
      const fallbackState = fallback.state as Mod<'switch'>['state']
      const desired = desiredArray(
        source.items,
        fallbackState.items.length,
        MOD_PART_BOUNDS.switch.min,
        MOD_PART_BOUNDS.switch.max,
      )
      const items = Array.from({ length: desired.length }, (_, index) => {
        const item = sourceRecord(desired.source[index])
        const fallbackItem = fallbackState.items[index]
        return {
          ...item,
          id: stringOr(item.id, ''),
          label: stringOr(item.label, fallbackItem?.label ?? `SWITCH ${index + 1}`),
          on: typeof item.on === 'boolean' ? item.on : Boolean(item.on),
          frame: stringOr(item.frame, fallbackItem?.frame ?? ''),
        }
      })
      return { ...source, items } as ModStateByKind[K]
    }
    case 'pad': {
      const fallbackState = fallback.state as Mod<'pad'>['state']
      const axesSource = sourceRecord(source.axes)
      const axes = Object.fromEntries((['x', 'y'] as const).map((axisName) => {
        const axis = sourceRecord(axesSource[axisName])
        const fallbackAxis = fallbackState.axes[axisName]
        return [axisName, {
          ...axis,
          id: stringOr(axis.id, ''),
          label: stringOr(axis.label, fallbackAxis.label),
          lo: stringOr(axis.lo, fallbackAxis.lo),
          hi: stringOr(axis.hi, fallbackAxis.hi),
          steps: repairedSteps(axis.steps, fallbackAxis.steps, true),
          frame: stringOr(axis.frame, fallbackAxis.frame),
        }]
      })) as Mod<'pad'>['state']['axes']
      const point = sourceRecord(source.v)
      return {
        ...source,
        axes,
        v: {
          ...point,
          x: clamp(finiteOr(point.x, fallbackState.v.x), 0, 100),
          y: clamp(finiteOr(point.y, fallbackState.v.y), 0, 100),
        },
      } as ModStateByKind[K]
    }
    case 'select': {
      const fallbackState = fallback.state as Mod<'select'>['state']
      const desired = desiredArray(
        source.options,
        fallbackState.options.length,
        MOD_PART_BOUNDS.select.min,
        MOD_PART_BOUNDS.select.max,
      )
      const options = Array.from({ length: desired.length }, (_, index) => {
        const option = sourceRecord(desired.source[index])
        const fallbackOption = fallbackState.options[index]
        return {
          ...option,
          id: stringOr(option.id, ''),
          label: stringOr(option.label, fallbackOption?.label ?? `OPTION ${index + 1}`),
          frame: stringOr(option.frame, fallbackOption?.frame ?? ''),
        }
      })
      return {
        ...source,
        picked: clamp(Math.round(finiteOr(source.picked, fallbackState.picked)), 0, options.length - 1),
        options,
      } as ModStateByKind[K]
    }
    case 'order': {
      const fallbackState = fallback.state as Mod<'order'>['state']
      const desired = desiredArray(
        source.items,
        fallbackState.items.length,
        MOD_PART_BOUNDS.order.min,
        MOD_PART_BOUNDS.order.max,
      )
      const items = Array.from({ length: desired.length }, (_, index) => {
        const item = sourceRecord(desired.source[index])
        const fallbackItem = fallbackState.items[index]
        return {
          ...item,
          id: stringOr(item.id, ''),
          label: stringOr(item.label, fallbackItem?.label ?? `ITEM ${index + 1}`),
          frame: stringOr(item.frame, fallbackItem?.frame ?? ''),
        }
      })
      const seen = new Set<number>()
      const perm = (Array.isArray(source.perm) ? source.perm : []).filter((index): index is number => {
        if (!isIntegerBetween(index, 0, items.length - 1) || seen.has(index)) return false
        seen.add(index)
        return true
      })
      for (let index = 0; index < items.length; index += 1) {
        if (!seen.has(index)) perm.push(index)
      }
      return { ...source, items, perm, frame: stringOr(source.frame, fallbackState.frame) } as ModStateByKind[K]
    }
    case 'filter': {
      const fallbackState = fallback.state as Mod<'filter'>['state']
      const steps = repairedSteps(source.steps, fallbackState.steps, true)
      const desired = desiredArray(
        source.lanes,
        fallbackState.lanes.length,
        MOD_PART_BOUNDS.filter.min,
        MOD_PART_BOUNDS.filter.max,
      )
      const lanes = Array.from({ length: desired.length }, (_, index) => {
        const lane = sourceRecord(desired.source[index])
        const fallbackLane = fallbackState.lanes[index]
        const mode = FILTER_MODES.includes(lane.mode as FilterMode)
          ? lane.mode as FilterMode
          : fallbackLane?.mode ?? 'no-more-than'
        let lo = clamp(finiteOr(lane.lo, fallbackLane?.lo ?? 0), 0, 100)
        let hi = clamp(finiteOr(lane.hi, fallbackLane?.hi ?? 60), 0, 100)
        if (lo > hi) [lo, hi] = [hi, lo]
        if (mode === 'no-more-than') lo = 0
        if (mode === 'at-least') hi = 100
        return {
          ...lane,
          id: stringOr(lane.id, ''),
          label: stringOr(lane.label, fallbackLane?.label ?? `LIMIT ${index + 1}`),
          mode,
          lo,
          hi,
          frame: stringOr(lane.frame, fallbackLane?.frame ?? ''),
        }
      })
      return {
        ...source,
        steps,
        stops: validStrings(source.stops) ? source.stops : fallbackState.stops.slice(),
        lanes,
      } as ModStateByKind[K]
    }
    case 'mixer': {
      const fallbackState = fallback.state as Mod<'mixer'>['state']
      const desired = desiredArray(
        source.items,
        fallbackState.items.length,
        MOD_PART_BOUNDS.mixer.min,
        MOD_PART_BOUNDS.mixer.max,
      )
      const items = Array.from({ length: desired.length }, (_, index) => {
        const item = sourceRecord(desired.source[index])
        const fallbackItem = fallbackState.items[index]
        return {
          ...item,
          id: stringOr(item.id, ''),
          label: stringOr(item.label, fallbackItem?.label ?? `CHANNEL ${index + 1}`),
          v: Math.max(0, finiteOr(
            'v' in item ? item.v : fallbackItem?.v,
            0,
          )),
          frame: stringOr(item.frame, fallbackItem?.frame ?? ''),
        }
      })
      const total = items.reduce((sum, item) => sum + item.v, 0)
      if (!Number.isFinite(total) || total <= 0) {
        const share = 100 / items.length
        items.forEach((item) => { item.v = share })
      } else if (Math.abs(total - 100) > MIXER_TOTAL_EPSILON) {
        items.forEach((item) => { item.v = item.v / total * 100 })
      }
      return { ...source, frame: stringOr(source.frame, fallbackState.frame), items } as ModStateByKind[K]
    }
    case 'radar': {
      const fallbackState = fallback.state as Mod<'radar'>['state']
      const desired = desiredArray(
        source.axes,
        fallbackState.axes.length,
        MOD_PART_BOUNDS.radar.min,
        MOD_PART_BOUNDS.radar.max,
      )
      const axes = Array.from({ length: desired.length }, (_, index) => {
        const axis = sourceRecord(desired.source[index])
        const fallbackAxis = fallbackState.axes[index]
        const repaired: UnknownRecord = {
          ...axis,
          id: stringOr(axis.id, ''),
          label: stringOr(axis.label, fallbackAxis?.label ?? `AXIS ${index + 1}`),
          v: clamp(finiteOr(axis.v, fallbackAxis?.v ?? 50), 0, 100),
        }
        if (typeof axis.frame === 'string') repaired.frame = axis.frame
        else if (fallbackAxis?.frame !== undefined) repaired.frame = fallbackAxis.frame
        else delete repaired.frame
        return repaired
      })
      return {
        ...source,
        steps: repairedSteps(source.steps, fallbackState.steps, true),
        axes,
      } as ModStateByKind[K]
    }
    case 'matrix': {
      const fallbackState = fallback.state as Mod<'matrix'>['state']
      const steps = repairedSteps(source.steps, fallbackState.steps, false, 5)
      const repairLabels = (
        value: unknown,
        fallbackLabels: Mod<'matrix'>['state']['rows'],
        prefix: string,
      ) => {
        const desired = desiredArray(
          value,
          fallbackLabels.length,
          MOD_PART_BOUNDS.matrix.min,
          MOD_PART_BOUNDS.matrix.max,
        )
        return Array.from({ length: desired.length }, (_, index) => {
          const label = sourceRecord(desired.source[index])
          return {
            ...label,
            id: stringOr(label.id, ''),
            label: stringOr(label.label, fallbackLabels[index]?.label ?? `${prefix} ${index + 1}`),
          }
        })
      }
      const rows = repairLabels(source.rows, fallbackState.rows, 'ROW')
      const cols = repairLabels(source.cols, fallbackState.cols, 'COL')
      const rawNames = Array.isArray(source.stepNames) ? source.stepNames : []
      const stepNames = Array.from({ length: steps }, (_, index) => (
        typeof rawNames[index] === 'string'
          ? rawNames[index]
          : fallbackState.stepNames[index] ?? (index === 0 ? 'none' : '')
      ))
      const rawCells = Array.isArray(source.cells) ? source.cells : fallbackState.cells
      const cells = Array.from({ length: rows.length }, (_, rowIndex) => {
        const rawRow = Array.isArray(rawCells[rowIndex]) ? rawCells[rowIndex] : []
        return Array.from({ length: cols.length }, (_, columnIndex) => (
          clamp(Math.round(finiteOr(rawRow[columnIndex], 0)), 0, steps - 1)
        ))
      })
      return { ...source, steps, stepNames, rows, cols, cells } as ModStateByKind[K]
    }
  }
}

function assignIdentity(root: object, identity: ModPartIdentity, id: string): void {
  let target: unknown = root
  for (const key of identity.path.slice(0, -1)) {
    target = (target as Record<string | number, unknown>)[key]
  }
  const finalKey = identity.path[identity.path.length - 1]
  ;(target as Record<string | number, unknown>)[finalKey] = id
}

function repairPartIds(mod: Mod, options: NormalizeModOptions): void {
  const identities = listModPartIdentities(mod)
  const reserved = new Set<string>()
  const keep = identities.map(({ sourceId }) => {
    if (!sourceId.trim() || reserved.has(sourceId)) return false
    reserved.add(sourceId)
    return true
  })
  const used = new Set(reserved)
  const allocate = options.allocatePartId
    ?? ((identity: ModPartIdentity) => newId(`mod-${identity.role}`))

  identities.forEach((identity, index) => {
    if (keep[index]) return
    for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
      const candidate = allocate(identity, attempt)
      if (candidate.trim() && !used.has(candidate)) {
        used.add(candidate)
        assignIdentity(mod, identity, candidate)
        return
      }
    }
    throw new Error('Unable to allocate a fresh non-blank Mod part id')
  })
}

export function normalizeMod(value: unknown, options: NormalizeModOptions = {}): Mod | undefined {
  if (isValidMod(value)) return value
  if (!isRecord(value) || !isKind(value.kind) || 'id' in value) return undefined

  const kind = value.kind
  const source = cloneDetached(value)
  const fallback = createSeedMod(kind)
  const repaired = {
    ...source,
    kind,
    title: stringOr(source.title, fallback.title),
    accent: typeof source.accent === 'string' && source.accent.trim()
      ? source.accent
      : fallback.accent,
    state: repairState(kind, source.state, fallback),
    treatOverride: null,
  } as Mod
  repaired.treatOverride = normalizeTreatmentOverride(
    repaired,
    typeof source.treatOverride === 'string' ? source.treatOverride : '',
  )
  repairPartIds(repaired, options)

  if (!isValidMod(repaired)) {
    throw new Error(`Internal error: repaired ${kind} Mod is not canonical`)
  }
  return repaired
}
