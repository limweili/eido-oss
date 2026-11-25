import { describe, expect, it, vi } from 'vitest'
import { CARD_IDENTITY_PRESETS, cardIdentityPresetSolid } from '../graph/cardIdentityPresets'
import {
  configureModFromErgonomicSpec,
  createModFromErgonomicSpec,
  inspectErgonomicMod,
} from './ergonomic'
import { isValidMod } from './normalizer'
import { MOD_KIND_ORDER } from './model'
import { createSeedMod } from './seeds'

describe('the strict ergonomic Mod adapter', () => {
  it('creates and inspects a slider without exposing caller-controlled part ids', () => {
    const createId = vi.fn((role: string, ordinal: number) => `${role}-${ordinal}`)

    const mod = createModFromErgonomicSpec({
      version: 1,
      kind: 'slider',
      title: 'RESEARCH DEPTH',
      identity: 'coral',
      treatment: null,
      state: {
        steps: 2,
        stops: ['light', 'balanced', 'deep'],
        items: [
          { label: 'DETAIL', v: 50, frame: 'Use {value} detail.' },
        ],
      },
    }, createId)

    expect(mod).toEqual({
      kind: 'slider',
      title: 'RESEARCH DEPTH',
      accent: cardIdentityPresetSolid('coral'),
      treatOverride: null,
      state: {
        steps: 2,
        stops: ['light', 'balanced', 'deep'],
        items: [
          { id: 'item-0', label: 'DETAIL', v: 50, frame: 'Use {value} detail.' },
        ],
      },
    })
    expect(createId).toHaveBeenCalledOnce()
    expect(inspectErgonomicMod(mod)).toEqual({
      version: 1,
      kind: 'slider',
      title: 'RESEARCH DEPTH',
      identity: 'coral',
      treatment: null,
      state: {
        steps: 2,
        stops: ['light', 'balanced', 'deep'],
        items: [
          { id: 'item-0', label: 'DETAIL', v: 50, frame: 'Use {value} detail.' },
        ],
      },
      context: {
        treatment: 'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
        valueSentences: ['Use balanced detail.'],
      },
    })
  })

  it.each([
    {
      kind: 'dial',
      identity: 'red',
      state: {
        steps: 0,
        stops: [],
        items: [{ label: 'DETAIL', v: 25, frame: '' }],
      },
      expectedState: {
        steps: 0,
        stops: [],
        items: [{ id: 'item-0', label: 'DETAIL', v: 25, frame: '' }],
      },
      valueSentences: ['Detail: 25%.'],
    },
    {
      kind: 'count',
      identity: 'amber',
      state: {
        mode: 'ratio',
        steps: 4,
        items: [{ label: 'EXAMPLES', n: 3, frame: 'Give {value} examples.' }],
      },
      expectedState: {
        mode: 'ratio',
        steps: 4,
        items: [{ id: 'item-0', label: 'EXAMPLES', n: 3, frame: 'Give {value} examples.' }],
      },
      valueSentences: ['Give 3 of 4 examples.'],
    },
    {
      kind: 'switch',
      identity: 'orange',
      state: {
        items: [{ label: 'CITATIONS', on: false, frame: 'Cite every claim.' }],
      },
      expectedState: {
        items: [{ id: 'item-0', label: 'CITATIONS', on: false, frame: 'Cite every claim.' }],
      },
      valueSentences: ['citations is off, says nothing.'],
    },
    {
      kind: 'pad',
      identity: 'mint',
      state: {
        steps: 0,
        axes: {
          x: { label: 'NOVELTY', lo: 'FAMILIAR', hi: 'SURPRISING', frame: '' },
          y: { label: 'RIGOR', lo: 'LOOSE', hi: 'STRICT', frame: 'Keep rigor {value}.' },
        },
        v: { x: 25, y: 75 },
      },
      expectedState: {
        axes: {
          x: { id: 'axis-0', label: 'NOVELTY', lo: 'FAMILIAR', hi: 'SURPRISING', steps: 0, frame: '' },
          y: { id: 'axis-1', label: 'RIGOR', lo: 'LOOSE', hi: 'STRICT', steps: 0, frame: 'Keep rigor {value}.' },
        },
        v: { x: 25, y: 75 },
      },
      expectedInspectionState: {
        steps: 0,
        axes: {
          x: { id: 'axis-0', label: 'NOVELTY', lo: 'FAMILIAR', hi: 'SURPRISING', frame: '' },
          y: { id: 'axis-1', label: 'RIGOR', lo: 'LOOSE', hi: 'STRICT', frame: 'Keep rigor {value}.' },
        },
        v: { x: 25, y: 75 },
      },
      valueSentences: [
        'Novelty: 25% of the way from familiar to surprising.',
        'Keep rigor 75% of the way from loose to strict.',
      ],
    },
    {
      kind: 'select',
      identity: 'green',
      state: {
        picked: 1,
        options: [
          { label: 'NOVICE', frame: 'Explain every term.' },
          { label: 'EXPERT', frame: '' },
        ],
      },
      expectedState: {
        picked: 1,
        options: [
          { id: 'option-0', label: 'NOVICE', frame: 'Explain every term.' },
          { id: 'option-1', label: 'EXPERT', frame: '' },
        ],
      },
      valueSentences: ['picks EXPERT, no prompt written for it.'],
    },
    {
      kind: 'order',
      identity: 'sky',
      state: {
        items: [
          { label: 'EVIDENCE', frame: 'source quality' },
          { label: 'SPEED', frame: '' },
        ],
        perm: [1, 0],
        frame: 'Rank {value}.',
      },
      expectedState: {
        items: [
          { id: 'item-0', label: 'EVIDENCE', frame: 'source quality' },
          { id: 'item-1', label: 'SPEED', frame: '' },
        ],
        perm: [1, 0],
        frame: 'Rank {value}.',
      },
      valueSentences: ['Rank speed, then source quality.'],
    },
    {
      kind: 'filter',
      identity: 'blue',
      state: {
        steps: 2,
        stops: ['low', 'medium', 'high'],
        lanes: [
          { label: 'LENGTH', mode: 'between', lo: 0, hi: 50, frame: 'Stay {value}.' },
        ],
      },
      expectedState: {
        steps: 2,
        stops: ['low', 'medium', 'high'],
        lanes: [
          { id: 'lane-0', label: 'LENGTH', mode: 'between', lo: 0, hi: 50, frame: 'Stay {value}.' },
        ],
      },
      valueSentences: ['Stay between low and medium.'],
    },
    {
      kind: 'mixer',
      identity: 'orchid',
      state: {
        frame: 'Mix {value}.',
        items: [
          { label: 'EVIDENCE', v: 60, frame: '' },
          { label: 'INTUITION', v: 40, frame: '' },
        ],
      },
      expectedState: {
        frame: 'Mix {value}.',
        items: [
          { id: 'item-0', label: 'EVIDENCE', v: 60, frame: '' },
          { id: 'item-1', label: 'INTUITION', v: 40, frame: '' },
        ],
      },
      valueSentences: ['Mix 60% evidence and 40% intuition.'],
    },
    {
      kind: 'radar',
      identity: 'purple',
      state: {
        steps: 0,
        axes: [
          { label: 'CLARITY', v: 70, frame: null },
          { label: 'RIGOR', v: 50, frame: null },
          { label: 'SPEED', v: 20, frame: null },
        ],
      },
      expectedState: {
        steps: 0,
        axes: [
          { id: 'axis-0', label: 'CLARITY', v: 70 },
          { id: 'axis-1', label: 'RIGOR', v: 50 },
          { id: 'axis-2', label: 'SPEED', v: 20 },
        ],
      },
      expectedInspectionState: {
        steps: 0,
        axes: [
          { id: 'axis-0', label: 'CLARITY', v: 70, frame: null },
          { id: 'axis-1', label: 'RIGOR', v: 50, frame: null },
          { id: 'axis-2', label: 'SPEED', v: 20, frame: null },
        ],
      },
      valueSentences: ['Kinds: clarity 70%, rigor 50%, speed 20%.'],
    },
    {
      kind: 'matrix',
      identity: 'charcoal',
      state: {
        steps: 2,
        stepNames: ['none', 'high'],
        rows: [{ label: 'WARMTH' }],
        cols: [{ label: 'INTRO' }, { label: 'BODY' }],
        cells: [[1, 0]],
      },
      expectedState: {
        steps: 2,
        stepNames: ['none', 'high'],
        rows: [{ id: 'row-0', label: 'WARMTH' }],
        cols: [
          { id: 'column-1', label: 'INTRO' },
          { id: 'column-2', label: 'BODY' },
        ],
        cells: [[1, 0]],
      },
      valueSentences: ['Warmth: intro high.'],
    },
  ] as const)(
    'creates, validates, and projects a $kind Mod',
    ({ kind, identity, state, expectedState, valueSentences, ...expectations }) => {
      const mod = createModFromErgonomicSpec({
        version: 1,
        kind,
        title: 'KINDS',
        identity,
        treatment: null,
        state,
      }, (role, ordinal) => `${role}-${ordinal}`)

      expect(isValidMod(mod)).toBe(true)
      expect(mod).toMatchObject({
        kind,
        title: 'KINDS',
        accent: cardIdentityPresetSolid(identity),
        treatOverride: null,
        state: expectedState,
      })
      const inspected = inspectErgonomicMod(mod)
      expect(inspected).toMatchObject({
        version: 1,
        kind,
        title: 'KINDS',
        identity,
        treatment: null,
        state: 'expectedInspectionState' in expectations
          ? expectations.expectedInspectionState
          : expectedState,
        context: { valueSentences },
      })
    },
  )

  it('configures a same-kind Mod by preserving returned ids and minting only new members', () => {
    const existing = createModFromErgonomicSpec({
      version: 1,
      kind: 'order',
      title: 'OLD ORDER',
      identity: 'coral',
      treatment: null,
      state: {
        items: [
          { label: 'FIRST', frame: '' },
          { label: 'SECOND', frame: '' },
          { label: 'THIRD', frame: '' },
        ],
        perm: [0, 1, 2],
        frame: '',
      },
    }, (_, ordinal) => `existing-${ordinal}`)
    const before = structuredClone(existing)
    const createId = vi.fn((role: string, ordinal: number) => `new-${role}-${ordinal}`)

    const configured = configureModFromErgonomicSpec(existing, {
      version: 1,
      kind: 'order',
      title: 'RESEARCH ORDER',
      identity: 'slate',
      treatment: 'Prefer earlier entries decisively.',
      state: {
        items: [
          { id: 'existing-2', label: 'THIRD EDITED', frame: 'third source' },
          { label: 'NEW', frame: 'new source' },
          { id: 'existing-0', label: 'FIRST', frame: '' },
        ],
        perm: [0, 2, 1],
        frame: 'Use {value}.',
      },
    }, createId)

    expect(existing).toEqual(before)
    expect(configured).toEqual({
      kind: 'order',
      title: 'RESEARCH ORDER',
      accent: cardIdentityPresetSolid('slate'),
      treatOverride: 'Prefer earlier entries decisively.',
      state: {
        items: [
          { id: 'existing-2', label: 'THIRD EDITED', frame: 'third source' },
          { id: 'new-item-1', label: 'NEW', frame: 'new source' },
          { id: 'existing-0', label: 'FIRST', frame: '' },
        ],
        perm: [0, 2, 1],
        frame: 'Use {value}.',
      },
    })
    expect(createId).toHaveBeenCalledOnce()
    expect(createId).toHaveBeenCalledWith('item', 1)
  })

  it('round-trips the inspected configuration of all eleven kinds without minting ids', () => {
    for (const kind of MOD_KIND_ORDER) {
      const existing = createSeedMod(kind, {
        createId: (role, ordinal) => `${kind}-${role}-${ordinal}`,
      })
      const inspected = inspectErgonomicMod(existing)
      const createId = vi.fn(() => 'must-not-be-called')
      const configured = configureModFromErgonomicSpec(existing, {
        version: inspected.version,
        kind: inspected.kind,
        title: inspected.title,
        identity: inspected.identity,
        treatment: inspected.treatment,
        state: inspected.state,
      }, createId)

      expect(configured).toEqual(existing)
      expect(createId).not.toHaveBeenCalled()
    }
  })

  it('accepts exactly the shared twelve identity names and no presentation values', () => {
    const spec = (identity: unknown) => ({
      version: 1,
      kind: 'switch',
      title: 'IDENTITY',
      identity,
      treatment: null,
      state: { items: [{ label: 'ON', on: true, frame: 'Use it.' }] },
    })

    for (const preset of CARD_IDENTITY_PRESETS) {
      expect(createModFromErgonomicSpec(spec(preset.id), () => `part-${preset.id}`).accent)
        .toBe(preset.solid)
    }
    expect(() => createModFromErgonomicSpec(spec('Coral'), () => 'unused'))
      .toThrow(/approved identity preset/i)
    expect(() => createModFromErgonomicSpec(spec(cardIdentityPresetSolid('coral')), () => 'unused'))
      .toThrow(/approved identity preset/i)
  })

  it('rejects unknown future fields and malformed semantics before allocating ids', () => {
    const createId = vi.fn(() => 'must-not-be-called')
    const valid = {
      version: 1,
      kind: 'mixer',
      title: 'STRICT',
      identity: 'coral',
      treatment: null,
      state: {
        frame: '',
        items: [
          { label: 'A', v: 60, frame: '' },
          { label: 'B', v: 40, frame: '' },
        ],
      },
    } as const

    expect(() => createModFromErgonomicSpec({ ...valid, future: true }, createId))
      .toThrow(/\$\.future.*not supported/i)
    expect(() => createModFromErgonomicSpec({ ...valid, version: 2 }, createId))
      .toThrow(/\$\.version.*must be 1/i)
    expect(() => createModFromErgonomicSpec({
      ...valid,
      state: {
        ...valid.state,
        items: [
          { ...valid.state.items[0], id: 'caller-id' },
          valid.state.items[1],
        ],
      },
    }, createId)).toThrow(/\.id.*not supported/i)
    expect(() => createModFromErgonomicSpec({
      ...valid,
      state: {
        ...valid.state,
        items: [
          { ...valid.state.items[0], futurePrompt: true },
          valid.state.items[1],
        ],
      },
    }, createId)).toThrow(/futurePrompt.*not supported/i)
    expect(() => createModFromErgonomicSpec({
      ...valid,
      state: {
        ...valid.state,
        items: [
          { ...valid.state.items[0], v: 59 },
          valid.state.items[1],
        ],
      },
    }, createId)).toThrow(/sum to exactly 100/i)
    expect(createId).not.toHaveBeenCalled()
  })

  it('rejects foreign, duplicate, recycled, and fixed-axis-swapped ids', () => {
    const existingOrder = createModFromErgonomicSpec({
      version: 1,
      kind: 'order',
      title: 'ORDER',
      identity: 'coral',
      treatment: null,
      state: {
        items: [
          { label: 'A', frame: '' },
          { label: 'B', frame: '' },
          { label: 'C', frame: '' },
        ],
        perm: [0, 1, 2],
        frame: '',
      },
    }, (_, ordinal) => `order-${ordinal}`)
    const orderSpec = (items: readonly Record<string, unknown>[]) => ({
      version: 1,
      kind: 'order',
      title: 'ORDER',
      identity: 'coral',
      treatment: null,
      state: { items, perm: [0, 1], frame: '' },
    })

    expect(() => configureModFromErgonomicSpec(existingOrder, orderSpec([
      { id: 'foreign', label: 'A', frame: '' },
      { id: 'order-1', label: 'B', frame: '' },
    ]), () => 'unused')).toThrow(/foreign/i)
    expect(() => configureModFromErgonomicSpec(existingOrder, orderSpec([
      { id: 'order-0', label: 'A', frame: '' },
      { id: 'order-0', label: 'B', frame: '' },
    ]), () => 'unused')).toThrow(/duplicate/i)
    expect(() => configureModFromErgonomicSpec(existingOrder, orderSpec([
      { id: 'order-0', label: 'A', frame: '' },
      { label: 'NEW', frame: '' },
    ]), () => 'order-2')).toThrow(/not fresh/i)

    const existingPad = createModFromErgonomicSpec({
      version: 1,
      kind: 'pad',
      title: 'PAD',
      identity: 'blue',
      treatment: null,
      state: {
        steps: 0,
        axes: {
          x: { label: 'X', lo: 'LOW', hi: 'HIGH', frame: '' },
          y: { label: 'Y', lo: 'LOW', hi: 'HIGH', frame: '' },
        },
        v: { x: 20, y: 80 },
      },
    }, (_, ordinal) => `pad-${ordinal}`)
    const padSpec = (ids?: { x: string; y: string }) => ({
      version: 1,
      kind: 'pad',
      title: 'PAD EDITED',
      identity: 'blue',
      treatment: null,
      state: {
        steps: 2,
        axes: {
          x: { ...(ids ? { id: ids.x } : {}), label: 'X2', lo: 'LOW', hi: 'HIGH', frame: '' },
          y: { ...(ids ? { id: ids.y } : {}), label: 'Y2', lo: 'LOW', hi: 'HIGH', frame: '' },
        },
        v: { x: 25, y: 75 },
      },
    })
    const padCreateId = vi.fn(() => 'unused')
    const configuredPad = configureModFromErgonomicSpec(existingPad, padSpec(), padCreateId)
    if (configuredPad.kind !== 'pad') throw new Error('expected pad')
    expect(configuredPad.state.axes.x.id).toBe('pad-0')
    expect(configuredPad.state.axes.y.id).toBe('pad-1')
    expect(padCreateId).not.toHaveBeenCalled()
    expect(() => configureModFromErgonomicSpec(
      existingPad,
      padSpec({ x: 'pad-1', y: 'pad-0' }),
      padCreateId,
    )).toThrow(/foreign/i)
  })
})
