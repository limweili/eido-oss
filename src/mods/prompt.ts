import type { FilterLane, FilterModState, Mod } from './model'

export type ModSentence = {
  text: string
  html: string
  mute?: true
}

export type ModContext = {
  title: string
  treatment: string
  sentences: ModSentence[]
}

const clamp = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
)

const lower = (value: unknown): string => String(value).toLowerCase()

const capitalize = (value: unknown): string => {
  const lowered = lower(value)
  return lowered.charAt(0).toUpperCase() + lowered.slice(1)
}

export const escapeModHtml = (value: unknown): string => String(value).replace(
  /[&<>]/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!,
)

export function snap(value: number, steps: number): number {
  return steps >= 2
    ? clamp(Math.round(value / (100 / steps)) * (100 / steps), 0, 100)
    : clamp(value, 0, 100)
}

export function spoken(value: number, steps: number, stops?: readonly string[] | null): string {
  if (steps >= 2 && stops && stops.length === steps + 1) {
    const index = Math.round(value / (100 / steps))
    if (stops[index]) return lower(stops[index])
  }
  return `${Math.round(value)}%`
}

export function say(frame: string, label: string, value: string): ModSentence {
  const resolvedFrame = frame.trim() || `${capitalize(label)}: {value}.`
  const hasSlot = resolvedFrame.includes('{value}')
  const text = hasSlot
    ? resolvedFrame.split('{value}').join(value)
    : `${resolvedFrame} ${value}`
  const escapedFrame = escapeModHtml(resolvedFrame)
  const emphasizedValue = `<b>${escapeModHtml(value)}</b>`
  const html = hasSlot
    ? escapedFrame.split('{value}').join(emphasizedValue)
    : `${escapedFrame} ${emphasizedValue}`
  return { text, html }
}

function plainSentence(text: string, mute?: true): ModSentence {
  return { text, html: escapeModHtml(text), ...(mute ? { mute } : {}) }
}

function countCap(mod: Mod<'count'>): number {
  return mod.state.mode === 'number' ? 10 : mod.state.steps
}

function countWord(mod: Mod<'count'>, value: number): string {
  if (mod.state.mode === 'percent') return `${Math.round(value / mod.state.steps * 100)}%`
  if (mod.state.mode === 'ratio') return `${value} of ${mod.state.steps}`
  return String(value)
}

function filterPhrase(lane: FilterLane, state: FilterModState): string {
  const name = (value: number) => spoken(value, state.steps, state.stops)
  if (lane.mode === 'no-more-than') return `no more than ${name(lane.hi)}`
  if (lane.mode === 'at-least') return `at least ${name(lane.lo)}`
  return `between ${name(lane.lo)} and ${name(lane.hi)}`
}

function matrixWord(mod: Mod<'matrix'>, value: number): string {
  const named = mod.state.stepNames[value]
  if (named) return lower(named)
  if (value < 1) return 'none'
  return `${Math.round(value / (mod.state.steps - 1) * 100)}%`
}

function sentencesFor(mod: Mod): ModSentence[] {
  switch (mod.kind) {
    case 'slider':
    case 'dial':
      return mod.state.items.map((item) => (
        say(item.frame, item.label, spoken(item.v, mod.state.steps, mod.state.stops))
      ))
    case 'count':
      return mod.state.items.map((item) => say(item.frame, item.label, countWord(mod, item.n)))
    case 'switch':
      return mod.state.items.map((item) => item.on
        ? plainSentence(item.frame.trim() || `${capitalize(lower(item.label))}.`)
        : plainSentence(`${lower(item.label)} is off, says nothing.`, true))
    case 'pad':
      return (['x', 'y'] as const).map((axisName) => {
        const axis = mod.state.axes[axisName]
        const percent = Math.round(mod.state.v[axisName])
        const value = axis.lo && axis.hi
          ? `${percent}% of the way from ${lower(axis.lo)} to ${lower(axis.hi)}`
          : `${percent}%`
        return say(axis.frame, axis.label, value)
      })
    case 'select': {
      const option = mod.state.options[mod.state.picked]
      if (!option) return []
      if (option.frame.trim()) return [plainSentence(option.frame)]
      return [plainSentence(`picks ${option.label}, no prompt written for it.`, true)]
    }
    case 'order': {
      const sequence = mod.state.perm.map((index) => {
        const item = mod.state.items[index]
        return item.frame.trim() || lower(item.label)
      }).join(', then ')
      return [say(mod.state.frame || 'Priorities: {value}.', 'Priorities', sequence)]
    }
    case 'filter':
      return mod.state.lanes.map((lane) => (
        say(lane.frame, lane.label, filterPhrase(lane, mod.state))
      ))
    case 'mixer': {
      const parts = mod.state.items.slice().sort((left, right) => right.v - left.v).map((item) => {
        const percent = `${Math.round(item.v)}%`
        return item.frame.trim()
          ? item.frame.trim().split('{value}').join(percent)
          : `${percent} ${lower(item.label)}`
      })
      const mix = parts.length > 1
        ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
        : parts[0]
      return [say(mod.state.frame, 'Blend', mix)]
    }
    case 'radar': {
      const sequence = mod.state.axes.map((axis) => {
        const value = spoken(axis.v, mod.state.steps, null)
        return axis.frame?.trim()
          ? axis.frame.trim().split('{value}').join(value)
          : `${lower(axis.label)} ${value}`
      }).join(', ')
      return [say('', mod.title, sequence)]
    }
    case 'matrix': {
      const sentences: ModSentence[] = []
      mod.state.rows.forEach((row, rowIndex) => {
        const parts: string[] = []
        mod.state.cols.forEach((column, columnIndex) => {
          const value = mod.state.cells[rowIndex][columnIndex]
          if (value >= 1) parts.push(`${lower(column.label)} ${matrixWord(mod, value)}`)
        })
        if (parts.length) sentences.push(say('', row.label, parts.join(', ')))
      })
      if (!sentences.length) {
        sentences.push(plainSentence('every cell is empty, says nothing.', true))
      }
      return sentences
    }
  }
}

export function defaultTreatment(mod: Mod): string {
  switch (mod.kind) {
    case 'slider':
    case 'dial':
      return 'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.'
    case 'count':
      if (mod.state.mode === 'percent') {
        return 'Each value is a percentage. 0% means none, 100% means as many as fits.'
      }
      if (mod.state.mode === 'ratio') {
        return `Each value is a proportion out of ${mod.state.steps}. Read it as a share, not an exact count.`
      }
      return 'Each count is an exact number. Include exactly that many.'
    case 'switch':
      return 'Only statements switched on apply. Off means left out on purpose, do not infer it.'
    case 'pad':
      return 'One position on two axes. Each axis runs 0 to 100 between its two named ends — read both axes together.'
    case 'select':
      return 'One option is picked at a time. Follow its prompt and ignore the rest.'
    case 'order':
      return 'The list is a ranking. Earlier entries outweigh later ones when they conflict.'
    case 'filter':
      return 'Each limit is a hard boundary, not a target. Stay inside it.'
    case 'mixer':
      return 'The channels are one mix. Shares sum to 100% and set proportion, not order.'
    case 'radar':
      return 'Each axis is a value out of 100, from 0 (not at all) to 100 (as strong as it goes). Read the axes together as one profile.'
    case 'matrix':
      return 'Each value applies only where it is named. Anything unmentioned is left out on purpose — do not fill it in.'
  }
}

export function normalizeTreatmentOverride(mod: Mod, candidate: string): string | null {
  const trimmed = candidate.trim()
  return trimmed && trimmed !== defaultTreatment(mod) ? candidate : null
}

export function treatment(mod: Mod): string {
  return mod.treatOverride?.trim() || defaultTreatment(mod)
}

export function readModContext(mod: Mod): ModContext {
  return {
    title: mod.title,
    treatment: treatment(mod),
    sentences: sentencesFor(mod),
  }
}

export const countModCap = countCap
