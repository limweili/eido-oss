import {
  CARD_IDENTITY_PRESETS,
  cardIdentityPresetSolid,
  type CardIdentityPresetId,
} from '../graph/cardIdentityPresets'
import { MOD_PART_BOUNDS } from './growth'
import { listModPartIdentities } from './identity'
import {
  MOD_KIND_ORDER,
  type CountMode,
  type FilterMode,
  type Mod,
  type ModKind,
  type ModPartIdFactory,
  type ModStateByKind,
} from './model'
import { isValidMod } from './normalizer'
import { normalizeTreatmentOverride, readModContext } from './prompt'
import { cloneDetached } from './snapshot'

type UnknownRecord = Record<string, unknown>

const COUNT_MODES: readonly CountMode[] = ['number', 'percent', 'ratio']
const FILTER_MODES: readonly FilterMode[] = ['no-more-than', 'at-least', 'between']
const MIXER_TOTAL_EPSILON = 1e-9

export const ERGONOMIC_MOD_SPEC_VERSION = 1 as const

/** A stable validation failure for JSON-domain callers. `path` uses JSONPath-ish
 * notation so a CLI adapter can report the exact rejected field without
 * exposing persistence details. */
export class ErgonomicModSpecError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`Invalid Mod spec at ${path}: ${message}`)
    this.name = 'ErgonomicModSpecError'
    this.path = path
  }
}

function fail(path: string, message: string): never {
  throw new ErgonomicModSpecError(path, message)
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object')
  }
  return value as UnknownRecord
}

function exactKeys(
  value: UnknownRecord,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const supported = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!supported.has(key)) fail(`${path}.${key}`, 'is not supported')
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${path}.${key}`, 'is required')
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be a string')
  return value
}

function nonBlankString(value: unknown, path: string): string {
  const candidate = string(value, path)
  if (!candidate.trim()) fail(path, 'must be non-blank')
  return candidate
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number')
  return value
}

function integer(value: unknown, path: string, min: number, max: number): number {
  const candidate = number(value, path)
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    fail(path, `must be an integer from ${min} to ${max}`)
  }
  return candidate
}

function percent(value: unknown, path: string): number {
  const candidate = number(value, path)
  if (candidate < 0 || candidate > 100) fail(path, 'must be from 0 to 100')
  return candidate
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean')
  return value
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array')
  return value
}

function boundedArray(value: unknown, path: string, kind: ModKind): unknown[] {
  const entries = array(value, path)
  const { min, max } = MOD_PART_BOUNDS[kind]
  if (entries.length < min || entries.length > max) {
    fail(path, `must contain from ${min} to ${max} entries`)
  }
  return entries
}

function enumValue<Value extends string>(
  value: unknown,
  path: string,
  choices: readonly Value[],
): Value {
  if (typeof value !== 'string' || !choices.includes(value as Value)) {
    fail(path, `must be one of ${choices.join(', ')}`)
  }
  return value as Value
}

function steps(value: unknown, path: string, max = 10, allowOff = true): number {
  const candidate = number(value, path)
  const valid = Number.isInteger(candidate)
    && ((allowOff && candidate === 0) || (candidate >= 2 && candidate <= max))
  if (!valid) {
    fail(path, allowOff
      ? `must be 0 or an integer from 2 to ${max}`
      : `must be an integer from 2 to ${max}`)
  }
  return candidate
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((entry, index) => string(entry, `${path}[${index}]`))
}

function stopNames(value: unknown, path: string, stepCount: number): string[] {
  const names = stringArray(value, path)
  const expected = stepCount === 0 ? 0 : stepCount + 1
  if (names.length !== expected) {
    fail(path, `must contain exactly ${expected} names for ${stepCount} steps`)
  }
  return names
}

function valueItem(
  value: unknown,
  path: string,
  allowPartIds: boolean,
): Omit<Mod<'slider'>['state']['items'][number], 'id'> {
  const item = record(value, path)
  exactKeys(item, path, ['label', 'v', 'frame'], allowPartIds ? ['id'] : [])
  return {
    label: nonBlankString(item.label, `${path}.label`),
    v: percent(item.v, `${path}.v`),
    frame: string(item.frame, `${path}.frame`),
  }
}

function valueItems(
  value: unknown,
  path: string,
  kind: 'slider' | 'dial',
  allowPartIds: boolean,
): Mod<'slider'>['state']['items'] {
  return boundedArray(value, path, kind).map((entry, index) => ({
    id: '',
    ...valueItem(entry, `${path}[${index}]`, allowPartIds),
  }))
}

function parseState<K extends ModKind>(
  kind: K,
  value: unknown,
  allowPartIds: boolean,
): ModStateByKind[K] {
  const state = record(value, '$.state')
  switch (kind) {
    case 'slider':
    case 'dial': {
      exactKeys(state, '$.state', ['steps', 'stops', 'items'])
      const stepCount = steps(state.steps, '$.state.steps')
      return {
        steps: stepCount,
        stops: stopNames(state.stops, '$.state.stops', stepCount),
        items: valueItems(state.items, '$.state.items', kind, allowPartIds),
      } as ModStateByKind[K]
    }
    case 'count': {
      exactKeys(state, '$.state', ['mode', 'steps', 'items'])
      const mode = enumValue(state.mode, '$.state.mode', COUNT_MODES)
      const stepCount = steps(state.steps, '$.state.steps', 10, false)
      const cap = mode === 'number' ? 10 : stepCount
      const items = boundedArray(state.items, '$.state.items', kind).map((entry, index) => {
        const path = `$.state.items[${index}]`
        const item = record(entry, path)
        exactKeys(item, path, ['label', 'n', 'frame'], allowPartIds ? ['id'] : [])
        return {
          id: '',
          label: nonBlankString(item.label, `${path}.label`),
          n: integer(item.n, `${path}.n`, 0, cap),
          frame: string(item.frame, `${path}.frame`),
        }
      })
      return { mode, steps: stepCount, items } as ModStateByKind[K]
    }
    case 'switch': {
      exactKeys(state, '$.state', ['items'])
      const items = boundedArray(state.items, '$.state.items', kind).map((entry, index) => {
        const path = `$.state.items[${index}]`
        const item = record(entry, path)
        exactKeys(item, path, ['label', 'on', 'frame'], allowPartIds ? ['id'] : [])
        return {
          id: '',
          label: nonBlankString(item.label, `${path}.label`),
          on: boolean(item.on, `${path}.on`),
          frame: string(item.frame, `${path}.frame`),
        }
      })
      return { items } as ModStateByKind[K]
    }
    case 'pad': {
      exactKeys(state, '$.state', ['steps', 'axes', 'v'])
      const stepCount = steps(state.steps, '$.state.steps')
      const axesValue = record(state.axes, '$.state.axes')
      exactKeys(axesValue, '$.state.axes', ['x', 'y'])
      const parseAxis = (axisName: 'x' | 'y') => {
        const path = `$.state.axes.${axisName}`
        const axis = record(axesValue[axisName], path)
        exactKeys(axis, path, ['label', 'lo', 'hi', 'frame'], allowPartIds ? ['id'] : [])
        return {
          id: '',
          label: nonBlankString(axis.label, `${path}.label`),
          lo: string(axis.lo, `${path}.lo`),
          hi: string(axis.hi, `${path}.hi`),
          steps: stepCount,
          frame: string(axis.frame, `${path}.frame`),
        }
      }
      const point = record(state.v, '$.state.v')
      exactKeys(point, '$.state.v', ['x', 'y'])
      return {
        axes: { x: parseAxis('x'), y: parseAxis('y') },
        v: {
          x: percent(point.x, '$.state.v.x'),
          y: percent(point.y, '$.state.v.y'),
        },
      } as ModStateByKind[K]
    }
    case 'select': {
      exactKeys(state, '$.state', ['picked', 'options'])
      const rawOptions = boundedArray(state.options, '$.state.options', kind)
      const options = rawOptions.map((entry, index) => {
        const path = `$.state.options[${index}]`
        const option = record(entry, path)
        exactKeys(option, path, ['label', 'frame'], allowPartIds ? ['id'] : [])
        return {
          id: '',
          label: nonBlankString(option.label, `${path}.label`),
          frame: string(option.frame, `${path}.frame`),
        }
      })
      return {
        picked: integer(state.picked, '$.state.picked', 0, options.length - 1),
        options,
      } as ModStateByKind[K]
    }
    case 'order': {
      exactKeys(state, '$.state', ['items', 'perm', 'frame'])
      const items = boundedArray(state.items, '$.state.items', kind).map((entry, index) => {
        const path = `$.state.items[${index}]`
        const item = record(entry, path)
        exactKeys(item, path, ['label', 'frame'], allowPartIds ? ['id'] : [])
        return {
          id: '',
          label: nonBlankString(item.label, `${path}.label`),
          frame: string(item.frame, `${path}.frame`),
        }
      })
      const rawPerm = array(state.perm, '$.state.perm')
      if (rawPerm.length !== items.length) {
        fail('$.state.perm', `must contain exactly ${items.length} indexes`)
      }
      const seen = new Set<number>()
      const perm = rawPerm.map((entry, index) => {
        const path = `$.state.perm[${index}]`
        const itemIndex = integer(entry, path, 0, items.length - 1)
        if (seen.has(itemIndex)) fail(path, 'must not repeat an index')
        seen.add(itemIndex)
        return itemIndex
      })
      return {
        items,
        perm,
        frame: string(state.frame, '$.state.frame'),
      } as ModStateByKind[K]
    }
    case 'filter': {
      exactKeys(state, '$.state', ['steps', 'stops', 'lanes'])
      const stepCount = steps(state.steps, '$.state.steps')
      const lanes = boundedArray(state.lanes, '$.state.lanes', kind).map((entry, index) => {
        const path = `$.state.lanes[${index}]`
        const lane = record(entry, path)
        exactKeys(lane, path, ['label', 'mode', 'lo', 'hi', 'frame'], allowPartIds ? ['id'] : [])
        const mode = enumValue(lane.mode, `${path}.mode`, FILTER_MODES)
        const lo = percent(lane.lo, `${path}.lo`)
        const hi = percent(lane.hi, `${path}.hi`)
        if (lo > hi) fail(path, 'lo must be less than or equal to hi')
        if (mode === 'no-more-than' && lo !== 0) fail(`${path}.lo`, 'must be 0 in no-more-than mode')
        if (mode === 'at-least' && hi !== 100) fail(`${path}.hi`, 'must be 100 in at-least mode')
        return {
          id: '',
          label: nonBlankString(lane.label, `${path}.label`),
          mode,
          lo,
          hi,
          frame: string(lane.frame, `${path}.frame`),
        }
      })
      return {
        steps: stepCount,
        stops: stopNames(state.stops, '$.state.stops', stepCount),
        lanes,
      } as ModStateByKind[K]
    }
    case 'mixer': {
      exactKeys(state, '$.state', ['frame', 'items'])
      const items = boundedArray(state.items, '$.state.items', kind).map((entry, index) => ({
        id: '',
        ...valueItem(entry, `$.state.items[${index}]`, allowPartIds),
      }))
      const total = items.reduce((sum, item) => sum + item.v, 0)
      if (Math.abs(total - 100) > MIXER_TOTAL_EPSILON) {
        fail('$.state.items', 'shares must sum to exactly 100')
      }
      return {
        frame: string(state.frame, '$.state.frame'),
        items,
      } as ModStateByKind[K]
    }
    case 'radar': {
      exactKeys(state, '$.state', ['steps', 'axes'])
      const axes = boundedArray(state.axes, '$.state.axes', kind).map((entry, index) => {
        const path = `$.state.axes[${index}]`
        const axis = record(entry, path)
        exactKeys(axis, path, ['label', 'v', 'frame'], allowPartIds ? ['id'] : [])
        if (axis.frame !== null && typeof axis.frame !== 'string') {
          fail(`${path}.frame`, 'must be a string or null')
        }
        return {
          id: '',
          label: nonBlankString(axis.label, `${path}.label`),
          v: percent(axis.v, `${path}.v`),
          ...(typeof axis.frame === 'string' ? { frame: axis.frame } : {}),
        }
      })
      return {
        steps: steps(state.steps, '$.state.steps'),
        axes,
      } as ModStateByKind[K]
    }
    case 'matrix': {
      exactKeys(state, '$.state', ['steps', 'stepNames', 'rows', 'cols', 'cells'])
      const stepCount = steps(state.steps, '$.state.steps', 5, false)
      const stepNames = stringArray(state.stepNames, '$.state.stepNames')
      if (stepNames.length !== stepCount) {
        fail('$.state.stepNames', `must contain exactly ${stepCount} names`)
      }
      const labels = (raw: unknown, path: string) => (
        boundedArray(raw, path, kind).map((entry, index) => {
          const entryPath = `${path}[${index}]`
          const label = record(entry, entryPath)
          exactKeys(label, entryPath, ['label'], allowPartIds ? ['id'] : [])
          return { id: '', label: nonBlankString(label.label, `${entryPath}.label`) }
        })
      )
      const rows = labels(state.rows, '$.state.rows')
      const cols = labels(state.cols, '$.state.cols')
      const rawCells = array(state.cells, '$.state.cells')
      if (rawCells.length !== rows.length) {
        fail('$.state.cells', `must contain exactly ${rows.length} rows`)
      }
      const cells = rawCells.map((rawRow, rowIndex) => {
        const path = `$.state.cells[${rowIndex}]`
        const row = array(rawRow, path)
        if (row.length !== cols.length) fail(path, `must contain exactly ${cols.length} cells`)
        return row.map((cell, columnIndex) => (
          integer(cell, `${path}[${columnIndex}]`, 0, stepCount - 1)
        ))
      })
      return { steps: stepCount, stepNames, rows, cols, cells } as ModStateByKind[K]
    }
  }
}

function modKind(value: unknown, path: string): ModKind {
  if (typeof value !== 'string' || !MOD_KIND_ORDER.includes(value as ModKind)) {
    fail(path, `must be one of ${MOD_KIND_ORDER.join(', ')}`)
  }
  return value as ModKind
}

function assignPath(root: object, path: readonly (string | number)[], value: string): void {
  let target: unknown = root
  for (const key of path.slice(0, -1)) {
    target = (target as Record<string | number, unknown>)[key]
  }
  const finalKey = path[path.length - 1]
  ;(target as Record<string | number, unknown>)[finalKey] = value
}

function allocateCreatePartIds(mod: Mod, createId: ModPartIdFactory): void {
  const used = new Set<string>()
  for (const identity of listModPartIdentities(mod)) {
    const id = createId(identity.role, identity.ordinal)
    if (typeof id !== 'string' || !id.trim()) {
      fail(identityPath(identity.path), 'the nested-ID factory returned a blank id')
    }
    if (used.has(id)) {
      fail(identityPath(identity.path), 'the nested-ID factory returned a duplicate id')
    }
    used.add(id)
    assignPath(mod, identity.path, id)
  }
}

function identityPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((result, segment) => (
    typeof segment === 'number' ? `${result}[${segment}]` : `${result}.${segment}`
  ), '$')
}

function treatmentOverride(value: unknown, mod: Mod): string | null {
  if (value === null) return null
  if (typeof value !== 'string') fail('$.treatment', 'must be a string or null')
  return normalizeTreatmentOverride(mod, value)
}

function parseSpec(input: unknown, allowPartIds: boolean): { mod: Mod; spec: UnknownRecord } {
  const spec = record(input, '$')
  exactKeys(spec, '$', ['version', 'kind', 'title', 'identity', 'treatment', 'state'])
  if (spec.version !== ERGONOMIC_MOD_SPEC_VERSION) fail('$.version', 'must be 1')
  const kind = modKind(spec.kind, '$.kind')
  const identity = string(spec.identity, '$.identity')
  const accent = cardIdentityPresetSolid(identity)
  if (!accent) fail('$.identity', 'must be an approved identity preset')
  const mod = {
    kind,
    title: nonBlankString(spec.title, '$.title'),
    accent,
    state: parseState(kind, spec.state, allowPartIds),
    treatOverride: null,
  } as Mod
  mod.treatOverride = treatmentOverride(spec.treatment, mod)
  return { mod, spec }
}

/** Validate an exact-key v1 creation spec and construct a canonical persisted
 * Mod. Nested identities are never accepted from the caller; allocation happens
 * only after the complete semantic document has validated. */
export function createModFromErgonomicSpec(
  input: unknown,
  createId: ModPartIdFactory,
): Mod {
  const { mod } = parseSpec(input, false)
  allocateCreatePartIds(mod, createId)
  const parsedKind = mod.kind
  if (!isValidMod(mod)) throw new Error(`Internal error: ergonomic ${parsedKind} Mod is not canonical`)
  return mod
}

function rawPartRecords(kind: ModKind, rawState: unknown): UnknownRecord[] {
  const state = record(rawState, '$.state')
  const records = (value: unknown, path: string) => array(value, path).map((entry, index) => (
    record(entry, `${path}[${index}]`)
  ))
  switch (kind) {
    case 'slider':
    case 'dial':
    case 'count':
    case 'switch':
    case 'order':
    case 'mixer':
      return records(state.items, '$.state.items')
    case 'select':
      return records(state.options, '$.state.options')
    case 'filter':
      return records(state.lanes, '$.state.lanes')
    case 'radar':
      return records(state.axes, '$.state.axes')
    case 'pad': {
      const axes = record(state.axes, '$.state.axes')
      return [record(axes.x, '$.state.axes.x'), record(axes.y, '$.state.axes.y')]
    }
    case 'matrix':
      return [
        ...records(state.rows, '$.state.rows'),
        ...records(state.cols, '$.state.cols'),
      ]
  }
}

function configurePartIds(
  existing: Mod,
  next: Mod,
  rawState: unknown,
  createId: ModPartIdFactory,
): void {
  const previousIdentities = listModPartIdentities(existing)
  const nextIdentities = listModPartIdentities(next)
  const rawParts = rawPartRecords(next.kind, rawState)
  if (rawParts.length !== nextIdentities.length) {
    throw new Error('Internal error: ergonomic Mod identity paths are out of sync')
  }

  const previousByRole = new Map<string, Set<string>>()
  for (const identity of previousIdentities) {
    const ids = previousByRole.get(identity.role) ?? new Set<string>()
    ids.add(identity.sourceId)
    previousByRole.set(identity.role, ids)
  }
  const allPreviousIds = new Set(previousIdentities.map(({ sourceId }) => sourceId))
  const used = new Set<string>()
  const allocate: typeof nextIdentities = []

  nextIdentities.forEach((identity, index) => {
    const raw = rawParts[index]
    const path = identityPath(identity.path)
    if (Object.prototype.hasOwnProperty.call(raw, 'id')) {
      const id = nonBlankString(raw.id, path)
      if (used.has(id)) fail(path, 'must not duplicate another part id')
      if (next.kind === 'pad' && id !== previousIdentities[index]?.sourceId) {
        fail(path, 'is foreign to this fixed Pad axis')
      }
      if (!previousByRole.get(identity.role)?.has(id)) {
        fail(path, 'is foreign to this Mod part role')
      }
      used.add(id)
      assignPath(next, identity.path, id)
      return
    }

    // Pad axes are fixed semantic members, not a growable list. Omitting their
    // opaque ids means "keep this axis", never "replace it".
    if (next.kind === 'pad') {
      const id = previousIdentities[index]?.sourceId
      if (!id) throw new Error('Internal error: a canonical Pad must have two axis ids')
      if (used.has(id)) fail(path, 'must not duplicate another part id')
      used.add(id)
      assignPath(next, identity.path, id)
      return
    }

    allocate.push(identity)
  })

  for (const identity of allocate) {
    const path = identityPath(identity.path)
    const id = createId(identity.role, identity.ordinal)
    if (typeof id !== 'string' || !id.trim()) {
      fail(path, 'the nested-ID factory returned a blank id')
    }
    if (allPreviousIds.has(id) || used.has(id)) {
      fail(path, 'the nested-ID factory returned an id that is not fresh')
    }
    used.add(id)
    assignPath(next, identity.path, id)
  }
}

/** Replace one Mod's ergonomic configuration. Only opaque ids currently owned
 * by the same part role may be returned; omitted list-member ids denote new
 * members. The existing Mod remains untouched. */
export function configureModFromErgonomicSpec<K extends ModKind>(
  existing: Mod<K>,
  input: unknown,
  createId: ModPartIdFactory,
): Mod<K> {
  if (!isValidMod(existing)) fail('$mod', 'must be a canonical Mod')
  const { mod, spec } = parseSpec(input, true)
  if (mod.kind !== existing.kind) {
    fail('$.kind', `must remain ${existing.kind}`)
  }
  configurePartIds(existing, mod, spec.state, createId)
  const parsedKind = mod.kind
  if (!isValidMod(mod)) throw new Error(`Internal error: ergonomic ${parsedKind} Mod is not canonical`)
  return mod as Mod<K>
}

export type ErgonomicModInspection = Readonly<{
  version: 1
  kind: Mod['kind']
  title: string
  identity: CardIdentityPresetId | null
  treatment: string | null
  state: unknown
  context: Readonly<{
    treatment: string
    valueSentences: readonly string[]
  }>
}>

function inspectionState(mod: Mod): unknown {
  if (mod.kind === 'pad') {
    const axis = (value: Mod<'pad'>['state']['axes']['x']) => ({
      id: value.id,
      label: value.label,
      lo: value.lo,
      hi: value.hi,
      frame: value.frame,
    })
    return {
      steps: mod.state.axes.x.steps,
      axes: { x: axis(mod.state.axes.x), y: axis(mod.state.axes.y) },
      v: cloneDetached(mod.state.v),
    }
  }
  if (mod.kind === 'radar') {
    return {
      steps: mod.state.steps,
      axes: mod.state.axes.map((axis) => ({
        id: axis.id,
        label: axis.label,
        v: axis.v,
        frame: axis.frame ?? null,
      })),
    }
  }
  return cloneDetached(mod.state)
}

/** Project a canonical Mod without its raw accent or prompt HTML. Historical
 * custom accents remain inspectable as `identity: null`, but cannot be authored
 * through the ergonomic creation contract. */
export function inspectErgonomicMod(mod: Mod): ErgonomicModInspection {
  if (!isValidMod(mod)) fail('$mod', 'must be a canonical Mod')
  const context = readModContext(mod)
  const identity = CARD_IDENTITY_PRESETS.find((preset) => (
    preset.solid.toLowerCase() === mod.accent.toLowerCase()
  ))?.id ?? null
  return {
    version: ERGONOMIC_MOD_SPEC_VERSION,
    kind: mod.kind,
    title: mod.title,
    identity,
    treatment: mod.treatOverride,
    state: inspectionState(mod),
    context: {
      treatment: context.treatment,
      valueSentences: context.sentences.map(({ text }) => text),
    },
  }
}
