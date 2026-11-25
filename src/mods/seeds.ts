import { newId } from '../shared/ids'
import { CARD_IDENTITIES } from '../ui/cardIdentity'
import {
  type Mod,
  type ModKind,
  type ModPartIdFactory,
  type ModPartRole,
  type ModStateByKind,
} from './model'

export const MOD_SEED_TITLES: Record<ModKind, string> = {
  mixer: 'MIXER',
  filter: 'LIMITS',
  slider: 'SLIDER',
  dial: 'DIALS',
  count: 'COUNT',
  switch: 'SWITCHES',
  pad: 'TONE PAD',
  select: 'AUDIENCE',
  order: 'PRIORITIES',
  radar: 'TONE OF VOICE',
  matrix: 'EMPHASIS',
}

export const MOD_SEED_ACCENTS: Record<ModKind, string> = {
  // CARD_IDENTITIES is the design system's fixed semantic palette order.
  mixer: CARD_IDENTITIES[9].solid,
  filter: CARD_IDENTITIES[3].solid,
  slider: CARD_IDENTITIES[7].solid,
  dial: CARD_IDENTITIES[2].solid,
  count: CARD_IDENTITIES[6].solid,
  switch: CARD_IDENTITIES[5].solid,
  pad: CARD_IDENTITIES[8].solid,
  select: CARD_IDENTITIES[0].solid,
  order: CARD_IDENTITIES[4].solid,
  radar: CARD_IDENTITIES[1].solid,
  matrix: CARD_IDENTITIES[11].solid,
}

export type CreateSeedModOptions = {
  title?: string
  accent?: string
  createId?: ModPartIdFactory
}

type NextPartId = (role: ModPartRole) => string

const createDefaultPartId: ModPartIdFactory = (role) => newId(`mod-${role}`)

function nextPartId(factory: ModPartIdFactory): NextPartId {
  let ordinal = 0
  const allocated = new Set<string>()
  return (role) => {
    const id = factory(role, ordinal++)
    if (!id.trim()) throw new Error('A Mod part id must be non-blank')
    if (allocated.has(id)) throw new Error('Mod part ids must be globally unique')
    allocated.add(id)
    return id
  }
}

const SEED_STATES: { [K in ModKind]: (id: NextPartId) => ModStateByKind[K] } = {
  mixer: (id) => ({
    frame: 'Blend {value}.',
    items: [
      { id: id('item'), label: 'CLARITY', v: 50, frame: '' },
      { id: id('item'), label: 'DEPTH', v: 32, frame: '' },
      { id: id('item'), label: 'BREVITY', v: 18, frame: '' },
    ],
  }),
  filter: (id) => ({
    steps: 4,
    stops: ['a sentence', 'a paragraph', 'a section', 'a page', 'an essay'],
    lanes: [
      {
        id: id('lane'),
        label: 'LENGTH',
        mode: 'no-more-than',
        lo: 0,
        hi: 50,
        frame: 'Keep the whole answer to {value}.',
      },
    ],
  }),
  slider: (id) => ({
    steps: 0,
    stops: [],
    items: [
      { id: id('item'), label: 'WARMTH', v: 62, frame: '' },
      { id: id('item'), label: 'FORMALITY', v: 35, frame: '' },
    ],
  }),
  dial: (id) => ({
    steps: 0,
    stops: [],
    items: [
      { id: id('item'), label: 'DETAIL', v: 40, frame: '' },
      { id: id('item'), label: 'HUMOR', v: 20, frame: '' },
      { id: id('item'), label: 'PACE', v: 70, frame: '' },
    ],
  }),
  count: (id) => ({
    mode: 'number',
    steps: 4,
    items: [
      { id: id('item'), label: 'WORKED EXAMPLES', n: 2, frame: 'Include {value} worked examples.' },
      { id: id('item'), label: 'COUNTERPOINTS', n: 1, frame: 'Raise {value} counterpoint(s).' },
    ],
  }),
  switch: (id) => ({
    items: [
      { id: id('item'), label: 'CITE SOURCES', on: true, frame: 'Cite sources for every claim.' },
      { id: id('item'), label: 'SUMMARY AT THE END', on: true, frame: 'End with a three-line summary.' },
      { id: id('item'), label: 'JARGON', on: false, frame: 'Technical jargon is fine, the reader is an expert.' },
    ],
  }),
  pad: (id) => ({
    axes: {
      x: { id: id('axis'), label: 'WARMTH', lo: 'COOL', hi: 'WARM', steps: 0, frame: '' },
      y: { id: id('axis'), label: 'DEPTH', lo: 'BRIEF', hi: 'THOROUGH', steps: 0, frame: '' },
    },
    v: { x: 62, y: 38 },
  }),
  select: (id) => ({
    picked: 0,
    options: [
      { id: id('option'), label: 'FOUNDER', frame: 'Write for a founder: outcomes first, no hand-holding.' },
      { id: id('option'), label: 'TEAMMATE', frame: 'Write for a teammate: shared context, skip the basics.' },
      { id: id('option'), label: 'CLIENT', frame: 'Write for a client: warm, unhurried, build trust.' },
      { id: id('option'), label: 'PUBLIC', frame: '' },
    ],
  }),
  order: (id) => ({
    items: [
      { id: id('item'), label: 'CLARITY', frame: '' },
      { id: id('item'), label: 'DEPTH', frame: '' },
      { id: id('item'), label: 'BREVITY', frame: '' },
    ],
    perm: [0, 1, 2],
    frame: '',
  }),
  radar: (id) => ({
    steps: 0,
    axes: [
      { id: id('axis'), label: 'WARMTH', v: 70 },
      { id: id('axis'), label: 'DETAIL', v: 50 },
      { id: id('axis'), label: 'PACE', v: 40 },
      { id: id('axis'), label: 'FORMALITY', v: 60 },
      { id: id('axis'), label: 'CONFIDENCE', v: 80 },
    ],
  }),
  matrix: (id) => ({
    steps: 3,
    stepNames: ['none', 'lightly', 'strongly'],
    rows: [
      { id: id('row'), label: 'WARMTH' },
      { id: id('row'), label: 'DETAIL' },
    ],
    cols: [
      { id: id('column'), label: 'INTRO' },
      { id: id('column'), label: 'BODY' },
      { id: id('column'), label: 'CLOSE' },
    ],
    cells: [[2, 0, 1], [0, 1, 0]],
  }),
}

export function createSeedMod<K extends ModKind>(
  kind: K,
  options: CreateSeedModOptions = {},
): Mod<K> {
  const id = nextPartId(options.createId ?? createDefaultPartId)
  return {
    kind,
    title: options.title ?? MOD_SEED_TITLES[kind],
    accent: options.accent ?? MOD_SEED_ACCENTS[kind],
    state: SEED_STATES[kind](id),
    treatOverride: null,
  } as Mod<K>
}
