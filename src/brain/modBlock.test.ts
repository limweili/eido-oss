import { describe, expect, it } from 'vitest'
import {
  MOD_KIND_ORDER,
  createSeedMod,
  readModContext,
  type ModKind,
} from '../mods'
import { renderModsBlock } from './modBlock'

const EXPECTED: Record<ModKind, { treatment: string; sentences: string[] }> = {
  mixer: {
    treatment: 'The channels are one mix. Shares sum to 100% and set proportion, not order.',
    sentences: ['Blend 50% clarity, 32% depth and 18% brevity.'],
  },
  filter: {
    treatment: 'Each limit is a hard boundary, not a target. Stay inside it.',
    sentences: ['Keep the whole answer to no more than a section.'],
  },
  slider: {
    treatment: 'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
    sentences: ['Warmth: 62%.', 'Formality: 35%.'],
  },
  dial: {
    treatment: 'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
    sentences: ['Detail: 40%.', 'Humor: 20%.', 'Pace: 70%.'],
  },
  count: {
    treatment: 'Each count is an exact number. Include exactly that many.',
    sentences: ['Include 2 worked examples.', 'Raise 1 counterpoint(s).'],
  },
  switch: {
    treatment: 'Only statements switched on apply. Off means left out on purpose, do not infer it.',
    sentences: [
      'Cite sources for every claim.',
      'End with a three-line summary.',
      'jargon is off, says nothing.',
    ],
  },
  pad: {
    treatment: 'One position on two axes. Each axis runs 0 to 100 between its two named ends — read both axes together.',
    sentences: [
      'Warmth: 62% of the way from cool to warm.',
      'Depth: 38% of the way from brief to thorough.',
    ],
  },
  select: {
    treatment: 'One option is picked at a time. Follow its prompt and ignore the rest.',
    sentences: ['Write for a founder: outcomes first, no hand-holding.'],
  },
  order: {
    treatment: 'The list is a ranking. Earlier entries outweigh later ones when they conflict.',
    sentences: ['Priorities: clarity, then depth, then brevity.'],
  },
  radar: {
    treatment: 'Each axis is a value out of 100, from 0 (not at all) to 100 (as strong as it goes). Read the axes together as one profile.',
    sentences: [
      'Tone of voice: warmth 70%, detail 50%, pace 40%, formality 60%, confidence 80%.',
    ],
  },
  matrix: {
    treatment: 'Each value applies only where it is named. Anything unmentioned is left out on purpose — do not fill it in.',
    sentences: ['Warmth: intro strongly, close lightly.', 'Detail: body lightly.'],
  },
}

const PREAMBLE =
  'Mods are hand-set controls the user tuned for this request. Each one\n' +
  'states how to read its values, then speaks them. Follow them exactly.'

describe('brain MODS block formatter (#764)', () => {
  it('wraps every v37 seed context character-identically without reading Mod state', () => {
    for (const kind of MOD_KIND_ORDER) {
      const mod = createSeedMod(kind)
      const expected = EXPECTED[kind]

      expect(renderModsBlock([readModContext(mod)])).toBe(
        `## MODS\n${PREAMBLE}\n\n` +
        `### ${mod.title}\n` +
        `How to read it: ${expected.treatment}\n` +
        expected.sentences.map((sentence) => `- ${sentence}`).join('\n'),
      )
    }
  })

  it('emits no block for no v2 contexts and one preamble for repeated contexts', () => {
    const context = readModContext(createSeedMod('select'))
    expect(renderModsBlock([])).toBeUndefined()
    expect(renderModsBlock([context, context])?.match(/Mods are hand-set/g)).toHaveLength(1)
    expect(renderModsBlock([context, context])?.match(/### AUDIENCE/g)).toHaveLength(2)
  })
})
