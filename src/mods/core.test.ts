import { describe, expect, it } from 'vitest'
import type { Card } from '../graph/types'
import {
  MOD_KIND_ORDER,
  createSeedMod,
  isV2ModCard,
  listModPartIdentities,
  remapModPartIdentities,
  snapshotModPromptSource,
  snapshotModValues,
  type Mod,
  type ModKind,
  type ModPartRole,
  type V2ModCard,
} from './index'

const EXPECTED_SEEDS: Record<ModKind, { title: string; accent: string }> = {
  mixer: { title: 'MIXER', accent: '#9c3fba' },
  filter: { title: 'LIMITS', accent: '#b5540f' },
  slider: { title: 'SLIDER', accent: '#3568c6' },
  dial: { title: 'DIALS', accent: '#eca23b' },
  count: { title: 'COUNT', accent: '#48a2ef' },
  switch: { title: 'SWITCHES', accent: '#1b7550' },
  pad: { title: 'TONE PAD', accent: '#d66be8' },
  select: { title: 'AUDIENCE', accent: '#f1666d' },
  order: { title: 'PRIORITIES', accent: '#65b563' },
  radar: { title: 'TONE OF VOICE', accent: '#c9282e' },
  matrix: { title: 'EMPHASIS', accent: '#2e2b25' },
}

const EXPECTED_ROLES: ModPartRole[] = [
  'item', 'item', 'item',
  'lane',
  'item', 'item',
  'item', 'item', 'item',
  'item', 'item',
  'item', 'item', 'item',
  'axis', 'axis',
  'option', 'option', 'option', 'option',
  'item', 'item', 'item',
  'axis', 'axis', 'axis', 'axis', 'axis',
  'row', 'row',
  'column', 'column', 'column',
]

function recursivelyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true
  return Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen)
}

describe('the public Mods v2 foundation', () => {
  it('creates all eleven exact v37 seed identities without a root Mod id', () => {
    let nextId = 0
    const mods = MOD_KIND_ORDER.map((kind) =>
      createSeedMod(kind, { createId: () => `seed-part-${nextId++}` }),
    )

    expect(MOD_KIND_ORDER).toEqual([
      'mixer', 'filter', 'slider', 'dial', 'count', 'switch',
      'pad', 'select', 'order', 'radar', 'matrix',
    ])
    expect(mods.map(({ kind, title, accent, treatOverride }) => ({
      kind,
      title,
      accent,
      treatOverride,
    }))).toEqual(MOD_KIND_ORDER.map((kind) => ({ kind, ...EXPECTED_SEEDS[kind], treatOverride: null })))
    expect(mods.every((mod) => !('id' in mod))).toBe(true)

    const identities = mods.flatMap(listModPartIdentities)
    expect(identities).toHaveLength(33)
    expect(identities.map(({ sourceId }) => sourceId)).toEqual(
      Array.from({ length: 33 }, (_, index) => `seed-part-${index}`),
    )
    expect(identities.map(({ role }) => role)).toEqual(EXPECTED_ROLES)
    expect(identities.every(({ path }) => path[0] === 'state' && path[path.length - 1] === 'id')).toBe(true)
    expect(new Set(identities.map(({ sourceId }) => sourceId))).toHaveLength(33)
    for (const mod of mods) {
      expect(listModPartIdentities(mod).map(({ ordinal }) => ordinal)).toEqual(
        listModPartIdentities(mod).map((_, ordinal) => ordinal),
      )
    }
  })

  it('keeps the deliberate v2 adaptations exact in pad, radar, matrix, and order', () => {
    const pad = createSeedMod('pad', { createId: (_, ordinal) => `pad-${ordinal}` })
    expect(pad.state.axes).toEqual({
      x: { id: 'pad-0', label: 'WARMTH', lo: 'COOL', hi: 'WARM', steps: 0, frame: '' },
      y: { id: 'pad-1', label: 'DEPTH', lo: 'BRIEF', hi: 'THOROUGH', steps: 0, frame: '' },
    })

    const radar = createSeedMod('radar', { createId: (_, ordinal) => `radar-${ordinal}` })
    expect(radar.state.axes[0]).toEqual({ id: 'radar-0', label: 'WARMTH', v: 70 })
    expect('frame' in radar.state.axes[0]).toBe(false)

    const matrix = createSeedMod('matrix', { createId: (_, ordinal) => `matrix-${ordinal}` })
    expect(matrix.state.rows).toEqual([
      { id: 'matrix-0', label: 'WARMTH' },
      { id: 'matrix-1', label: 'DETAIL' },
    ])
    expect(matrix.state.cols).toEqual([
      { id: 'matrix-2', label: 'INTRO' },
      { id: 'matrix-3', label: 'BODY' },
      { id: 'matrix-4', label: 'CLOSE' },
    ])

    const order = createSeedMod('order', { createId: (_, ordinal) => `order-${ordinal}` })
    order.state.perm = [2, 0, 1]
    expect(listModPartIdentities(order).map(({ sourceId }) => sourceId)).toEqual([
      'order-0', 'order-1', 'order-2',
    ])
  })

  it('refuses a seed allocator that returns duplicate identities', () => {
    expect(() => createSeedMod('slider', { createId: () => 'same-id' })).toThrow(/unique/i)
  })

  it('remaps every nested identity immutably in canonical order', () => {
    const source = createSeedMod('matrix', { createId: (_, ordinal) => `source-${ordinal}` })
    const extended = source as Mod<'matrix'> & {
      extension: { source: string }
      state: Mod<'matrix'>['state'] & { extension: { state: string } }
    }
    extended.extension = { source: 'kept' }
    extended.state.extension = { state: 'kept' }
    ;(extended.state.rows[0] as typeof extended.state.rows[0] & { extension: string }).extension = 'kept'
    const before = structuredClone(extended)

    const result = remapModPartIdentities(extended, ({ ordinal }) => `instance-${ordinal}`)

    expect(extended).toEqual(before)
    expect(result.value).not.toBe(extended)
    expect(result.value.state).not.toBe(extended.state)
    expect(result.mappings).toEqual([
      { role: 'row', path: ['state', 'rows', 0, 'id'], sourceId: 'source-0', ordinal: 0, instanceId: 'instance-0' },
      { role: 'row', path: ['state', 'rows', 1, 'id'], sourceId: 'source-1', ordinal: 1, instanceId: 'instance-1' },
      { role: 'column', path: ['state', 'cols', 0, 'id'], sourceId: 'source-2', ordinal: 2, instanceId: 'instance-2' },
      { role: 'column', path: ['state', 'cols', 1, 'id'], sourceId: 'source-3', ordinal: 3, instanceId: 'instance-3' },
      { role: 'column', path: ['state', 'cols', 2, 'id'], sourceId: 'source-4', ordinal: 4, instanceId: 'instance-4' },
    ])
    expect(result.value.extension).toEqual({ source: 'kept' })
    expect(result.value.state.extension).toEqual({ state: 'kept' })
    expect((result.value.state.rows[0] as { extension?: string }).extension).toBe('kept')

    const snapshot = snapshotModValues(source)
    const remappedSnapshot = remapModPartIdentities(snapshot, ({ ordinal }) => `snapshot-${ordinal}`)
    expect(remappedSnapshot.value.schema).toBe('mod-v2')
    expect(remappedSnapshot.value.state.rows[0].id).toBe('snapshot-0')
    expect(snapshot.state.rows[0].id).toBe('source-0')
  })

  it('rejects an invalid or source-colliding remap before exposing a partial result', () => {
    const source = createSeedMod('slider', { createId: (_, ordinal) => `source-${ordinal}` })
    expect(() => remapModPartIdentities(source, () => 'source-1')).toThrow(/fresh/i)
    expect(() => remapModPartIdentities(source, () => ' ')).toThrow(/non-blank/i)
    expect(source.state.items.map(({ id }) => id)).toEqual(['source-0', 'source-1'])
  })

  it('takes detached, deeply frozen value and prompt-source snapshots', () => {
    const mod = createSeedMod('slider', { createId: (_, ordinal) => `slider-${ordinal}` })
    const values = snapshotModValues(mod)
    const promptSource = snapshotModPromptSource(mod)

    expect(values).toEqual({ schema: 'mod-v2', kind: 'slider', state: mod.state })
    expect(values).not.toBe(mod)
    expect(values.state).not.toBe(mod.state)
    expect(recursivelyFrozen(values)).toBe(true)
    expect(promptSource).toEqual({
      kind: 'slider',
      title: 'SLIDER',
      state: mod.state,
      treatOverride: null,
    })
    expect('accent' in promptSource).toBe(false)
    expect(recursivelyFrozen(promptSource)).toBe(true)

    mod.title = 'CHANGED'
    mod.accent = '#ffffff'
    mod.state.items[0].label = 'CHANGED'
    mod.state.items[0].id = 'changed-id'
    expect(values.state.items[0]).toMatchObject({ id: 'slider-0', label: 'WARMTH' })
    expect(promptSource.title).toBe('SLIDER')
    expect(promptSource.state.items[0]).toMatchObject({ id: 'slider-0', label: 'WARMTH' })

    const presentationOnly = snapshotModPromptSource({ ...mod, accent: '#000000' })
    expect(presentationOnly).toEqual(snapshotModPromptSource(mod))
  })

  it('narrows a current Mod card to its v2 payload', () => {
    const modV2 = createSeedMod('switch')
    const card: Card = {
      id: 'card-1',
      kind: 'mod',
      blocks: [],
      position: { x: 0, y: 0 },
      modV2,
    }

    expect(isV2ModCard(card)).toBe(true)
    if (!isV2ModCard(card)) throw new Error('expected v2 Mod card')
    const narrowed: V2ModCard = card
    expect(narrowed.modV2).toBe(modV2)
    expect(isV2ModCard({ ...card, kind: 'note' })).toBe(false)
    expect(isV2ModCard({ ...card, modV2: undefined })).toBe(false)
  })
})
