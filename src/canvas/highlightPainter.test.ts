// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { readStylesheetCascade } from '../styles/readStylesheetCascade.test-helper'
import { selectionWithin } from './highlightPainter'

// Two side-by-side "cards" the way the canvas lays them out: the selection can
// physically start in one and end in the other.
let cardA: HTMLElement
let cardB: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  cardA = document.createElement('div')
  cardA.innerHTML = '<p>alpha bravo charlie</p>'
  cardB = document.createElement('div')
  cardB.innerHTML = '<p>delta echo foxtrot</p>'
  document.body.append(cardA, cardB)
})

function selectRange(setup: (range: Range) => void) {
  const range = document.createRange()
  setup(range)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function textNode(card: HTMLElement): Text {
  return card.querySelector('p')!.firstChild as Text
}

describe('selectionWithin', () => {
  it('reads a selection fully inside the root', () => {
    selectRange((range) => {
      range.setStart(textNode(cardA), 6) // "bravo charlie"
      range.setEnd(textNode(cardA), 19)
    })
    expect(selectionWithin(cardA)).toEqual({ text: 'bravo charlie', occurrence: 0 })
  })

  it('clamps a selection that overshoots past the end of the root', () => {
    selectRange((range) => {
      range.setStart(textNode(cardA), 6) // "bravo charlie" then into card B
      range.setEnd(textNode(cardB), 5)
    })
    expect(selectionWithin(cardA)).toEqual({ text: 'bravo charlie', occurrence: 0 })
  })

  it('clamps a backward overshoot that starts before the root', () => {
    selectRange((range) => {
      range.setStart(textNode(cardA), 12) // "charlie" then into card B
      range.setEnd(textNode(cardB), 10)
    })
    expect(selectionWithin(cardB)).toEqual({ text: 'delta echo', occurrence: 0 })
  })

  it('returns null when the selection never touches the root', () => {
    selectRange((range) => {
      range.setStart(textNode(cardB), 0)
      range.setEnd(textNode(cardB), 5)
    })
    expect(selectionWithin(cardA)).toBeNull()
  })

  it('pins the clamped text to the right occurrence of a repeated phrase', () => {
    cardA.innerHTML = '<p>echo alpha echo</p>'
    selectRange((range) => {
      range.setStart(textNode(cardA), 11) // second "echo" then into card B
      range.setEnd(textNode(cardB), 10)
    })
    expect(selectionWithin(cardA)).toEqual({ text: 'echo', occurrence: 1 })
  })
})

describe('painted highlight prose cascade', () => {
  it('keeps live highlighted text on semantic ink inside links and blockquotes', () => {
    const style = document.createElement('style')
    style.textContent = readStylesheetCascade()
    const card = document.createElement('article')
    card.className = 'card fill-full'
    card.innerHTML = `
      <div class="card-body">
        <div class="note-render markdown">
          <blockquote><a href="#source"><mark class="painted-highlight">Marked thought</mark></a></blockquote>
        </div>
      </div>
    `
    document.head.append(style)
    document.body.append(card)

    expect(getComputedStyle(card.querySelector('mark')!).color).toBe('var(--e-ink)')

    card.remove()
    style.remove()
  })
})
