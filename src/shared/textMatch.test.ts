import { describe, expect, it } from 'vitest'
import { countMatchesBefore, findNthMatch, normalizeMatchText } from './textMatch'

describe('normalizeMatchText', () => {
  it('collapses whitespace runs and trims', () => {
    expect(normalizeMatchText('  a\n  bright\tnote ')).toBe('a bright note')
  })
})

describe('findNthMatch', () => {
  it('finds the first match at raw indices', () => {
    expect(findNthMatch('A bright note', 'bright', 0)).toEqual({ start: 2, end: 8 })
  })

  it('finds the nth occurrence of a repeated phrase', () => {
    const text = 'echo, then echo, then echo'
    expect(findNthMatch(text, 'echo', 2)).toEqual({ start: 22, end: 26 })
  })

  it('matches across differing whitespace', () => {
    const rendered = 'a bright note' // markdown joined the line break into a space
    expect(findNthMatch(rendered, 'a bright\nnote', 0)).toEqual({ start: 0, end: 13 })

    const raw = 'a bright\nnote'
    expect(findNthMatch(raw, 'a bright note', 0)).toEqual({ start: 0, end: 13 })
  })

  it('returns null when the occurrence does not exist or the needle is blank', () => {
    expect(findNthMatch('one echo', 'echo', 1)).toBeNull()
    expect(findNthMatch('one echo', 'missing', 0)).toBeNull()
    expect(findNthMatch('one echo', '   ', 0)).toBeNull()
  })
})

describe('countMatchesBefore', () => {
  it('counts matches that start before the given raw index', () => {
    const text = 'echo, then echo, then echo'
    expect(countMatchesBefore(text, 'echo', 0)).toBe(0)
    expect(countMatchesBefore(text, 'echo', 11)).toBe(1)
    expect(countMatchesBefore(text, 'echo', 22)).toBe(2)
  })

  it('round-trips with findNthMatch on repeated text', () => {
    const text = 'the plan, the plan, the plan'
    const second = findNthMatch(text, 'the plan', 1)!
    expect(countMatchesBefore(text, 'the plan', second.start)).toBe(1)
  })
})
