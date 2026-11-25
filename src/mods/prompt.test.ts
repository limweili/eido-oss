import { describe, expect, it } from 'vitest'
import {
  MOD_KIND_ORDER,
  createSeedMod,
  defaultTreatment,
  normalizeTreatmentOverride,
  readModContext,
  say,
  snap,
  spoken,
  treatment,
  type ModKind,
  type ModSentence,
} from './index'

const TREATMENTS: Record<ModKind, string> = {
  slider: 'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
  dial: 'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
  count: 'Each count is an exact number. Include exactly that many.',
  switch: 'Only statements switched on apply. Off means left out on purpose, do not infer it.',
  pad: 'One position on two axes. Each axis runs 0 to 100 between its two named ends — read both axes together.',
  select: 'One option is picked at a time. Follow its prompt and ignore the rest.',
  order: 'The list is a ranking. Earlier entries outweigh later ones when they conflict.',
  filter: 'Each limit is a hard boundary, not a target. Stay inside it.',
  mixer: 'The channels are one mix. Shares sum to 100% and set proportion, not order.',
  radar: 'Each axis is a value out of 100, from 0 (not at all) to 100 (as strong as it goes). Read the axes together as one profile.',
  matrix: 'Each value applies only where it is named. Anything unmentioned is left out on purpose — do not fill it in.',
}

const SENTENCES: Record<ModKind, ModSentence[]> = {
  mixer: [{
    text: 'Blend 50% clarity, 32% depth and 18% brevity.',
    html: 'Blend <b>50% clarity, 32% depth and 18% brevity</b>.',
  }],
  filter: [{
    text: 'Keep the whole answer to no more than a section.',
    html: 'Keep the whole answer to <b>no more than a section</b>.',
  }],
  slider: [
    { text: 'Warmth: 62%.', html: 'Warmth: <b>62%</b>.' },
    { text: 'Formality: 35%.', html: 'Formality: <b>35%</b>.' },
  ],
  dial: [
    { text: 'Detail: 40%.', html: 'Detail: <b>40%</b>.' },
    { text: 'Humor: 20%.', html: 'Humor: <b>20%</b>.' },
    { text: 'Pace: 70%.', html: 'Pace: <b>70%</b>.' },
  ],
  count: [
    { text: 'Include 2 worked examples.', html: 'Include <b>2</b> worked examples.' },
    { text: 'Raise 1 counterpoint(s).', html: 'Raise <b>1</b> counterpoint(s).' },
  ],
  switch: [
    { text: 'Cite sources for every claim.', html: 'Cite sources for every claim.' },
    { text: 'End with a three-line summary.', html: 'End with a three-line summary.' },
    { text: 'jargon is off, says nothing.', html: 'jargon is off, says nothing.', mute: true },
  ],
  pad: [
    {
      text: 'Warmth: 62% of the way from cool to warm.',
      html: 'Warmth: <b>62% of the way from cool to warm</b>.',
    },
    {
      text: 'Depth: 38% of the way from brief to thorough.',
      html: 'Depth: <b>38% of the way from brief to thorough</b>.',
    },
  ],
  select: [{
    text: 'Write for a founder: outcomes first, no hand-holding.',
    html: 'Write for a founder: outcomes first, no hand-holding.',
  }],
  order: [{
    text: 'Priorities: clarity, then depth, then brevity.',
    html: 'Priorities: <b>clarity, then depth, then brevity</b>.',
  }],
  radar: [{
    text: 'Tone of voice: warmth 70%, detail 50%, pace 40%, formality 60%, confidence 80%.',
    html: 'Tone of voice: <b>warmth 70%, detail 50%, pace 40%, formality 60%, confidence 80%</b>.',
  }],
  matrix: [
    { text: 'Warmth: intro strongly, close lightly.', html: 'Warmth: <b>intro strongly, close lightly</b>.' },
    { text: 'Detail: body lightly.', html: 'Detail: <b>body lightly</b>.' },
  ],
}

function replaceEditableStrings(value: unknown, key = ''): void {
  if (Array.isArray(value)) {
    value.forEach((child) => {
      if ((key === 'stops' || key === 'stepNames') && typeof child === 'string') return
      replaceEditableStrings(child, key)
    })
    if (key === 'stops' || key === 'stepNames') {
      value.forEach((_, index) => { value[index] = `EDITABLE_LEAK_${index}` })
    }
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [childKey, child] of Object.entries(value)) {
    const editable = ['label', 'frame', 'lo', 'hi', 'title'].includes(childKey)
    if (editable && typeof child === 'string') {
      ;(value as Record<string, unknown>)[childKey] = `EDITABLE_LEAK_${childKey}`
    } else {
      replaceEditableStrings(child, childKey)
    }
  }
}

describe('the v37 Mod prompt engine', () => {
  it('emits character-identical seed treatments and sentences for all eleven kinds', () => {
    for (const kind of MOD_KIND_ORDER) {
      const mod = createSeedMod(kind)
      expect(readModContext(mod)).toEqual({
        title: mod.title,
        treatment: TREATMENTS[kind],
        sentences: SENTENCES[kind],
      })
    }
  })

  it('keeps visible silence for off switches, an unprompted selection, and an empty matrix', () => {
    const switches = createSeedMod('switch')
    expect(readModContext(switches).sentences[2]).toEqual({
      text: 'jargon is off, says nothing.',
      html: 'jargon is off, says nothing.',
      mute: true,
    })

    const select = createSeedMod('select')
    select.state.picked = 3
    expect(readModContext(select).sentences).toEqual([{
      text: 'picks PUBLIC, no prompt written for it.',
      html: 'picks PUBLIC, no prompt written for it.',
      mute: true,
    }])

    const matrix = createSeedMod('matrix')
    matrix.state.cells = matrix.state.cells.map((row) => row.map(() => 0))
    expect(readModContext(matrix).sentences).toEqual([{
      text: 'every cell is empty, says nothing.',
      html: 'every cell is empty, says nothing.',
      mute: true,
    }])
  })

  it('never lets an editable word leak into a default treatment', () => {
    for (const kind of MOD_KIND_ORDER) {
      const mod = createSeedMod(kind)
      replaceEditableStrings(mod)
      expect(defaultTreatment(mod).toLowerCase()).not.toContain('editable_leak')
    }
  })

  it('reads renamed labels, stops, pad ends, and silent options on the next call', () => {
    const slider = createSeedMod('slider')
    slider.state.steps = 2
    slider.state.stops = ['COOL', 'MIDDLE', 'HOT']
    slider.state.items[0].label = 'VIBE'
    slider.state.items[0].v = 100
    expect(readModContext(slider).sentences[0].text).toBe('Vibe: hot.')
    expect(defaultTreatment(slider)).toBe(TREATMENTS.slider)

    const pad = createSeedMod('pad')
    pad.state.axes.x.lo = 'STILL'
    pad.state.axes.x.hi = 'ELECTRIC'
    expect(readModContext(pad).sentences[0].text).toBe(
      'Warmth: 62% of the way from still to electric.',
    )

    const select = createSeedMod('select')
    select.state.picked = 3
    select.state.options[3].label = 'EVERYONE'
    expect(readModContext(select).sentences[0].text).toBe(
      'picks EVERYONE, no prompt written for it.',
    )
  })

  it('keeps treatment defaults live and stores only genuine raw overrides', () => {
    const count = createSeedMod('count')
    expect(defaultTreatment(count)).toBe(TREATMENTS.count)
    count.state.mode = 'percent'
    expect(defaultTreatment(count)).toBe(
      'Each value is a percentage. 0% means none, 100% means as many as fits.',
    )
    count.state.mode = 'ratio'
    count.state.steps = 7
    expect(defaultTreatment(count)).toBe(
      'Each value is a proportion out of 7. Read it as a share, not an exact count.',
    )

    expect(normalizeTreatmentOverride(count, '   ')).toBeNull()
    expect(normalizeTreatmentOverride(count, `  ${defaultTreatment(count)}  `)).toBeNull()
    count.treatOverride = normalizeTreatmentOverride(count, '  Read this my way.  ')
    expect(count.treatOverride).toBe('  Read this my way.  ')
    expect(treatment(count)).toBe('Read this my way.')
  })

  it('ports snapping, named stops, frame filling, and escaping exactly', () => {
    expect(snap(61, 4)).toBe(50)
    expect(snap(61, 0)).toBe(61)
    expect(snap(120, 0)).toBe(100)
    expect(spoken(50, 4, ['ZERO', 'LOW', 'MID', 'HIGH', 'MAX'])).toBe('mid')
    expect(spoken(50, 4, ['ZERO', 'MID', 'MAX'])).toBe('50%')
    expect(spoken(25, 4, ['', '', '', '', ''])).toBe('25%')

    expect(say('Use <{value}> & {value}.', 'IGNORED', 'A&B')).toEqual({
      text: 'Use <A&B> & A&B.',
      html: 'Use &lt;<b>A&amp;B</b>&gt; &amp; <b>A&amp;B</b>.',
    })
    expect(say('Keep it', 'IGNORED', '50%')).toEqual({
      text: 'Keep it 50%',
      html: 'Keep it <b>50%</b>',
    })
    expect(say('', 'LOUD & SOFT', '50%')).toEqual({
      text: 'Loud & soft: 50%.',
      html: 'Loud &amp; soft: <b>50%</b>.',
    })
  })

  it('preserves the prototype differences between select, switch, mixer, and order frames', () => {
    const select = createSeedMod('select')
    select.state.options[0].frame = '  raw <prompt>  '
    expect(readModContext(select).sentences[0]).toEqual({
      text: '  raw <prompt>  ',
      html: '  raw &lt;prompt&gt;  ',
    })

    const switches = createSeedMod('switch')
    switches.state.items[0].frame = '  trimmed  '
    expect(readModContext(switches).sentences[0]).toEqual({ text: 'trimmed', html: 'trimmed' })

    const mixer = createSeedMod('mixer')
    mixer.state.items[0].frame = 'only clarity'
    expect(readModContext(mixer).sentences[0].text).toBe(
      'Blend only clarity, 32% depth and 18% brevity.',
    )

    const order = createSeedMod('order')
    order.state.items[0].frame = '{value}'
    expect(readModContext(order).sentences[0]).toEqual({
      text: 'Priorities: {value}, then depth, then brevity.',
      html: 'Priorities: <b>{value}, then depth, then brevity</b>.',
    })
  })
})
