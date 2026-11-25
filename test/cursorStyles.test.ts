import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readStylesheetCascade } from '../src/styles/readStylesheetCascade.test-helper'

const styles = readStylesheetCascade()
const board = readFileSync(new URL('../src/canvas/Board.tsx', import.meta.url), 'utf8')
const cardInteraction = readFileSync(new URL('../src/canvas/cardInteraction.ts', import.meta.url), 'utf8')
const askAiCard = readFileSync(new URL('../src/canvas/cards/AskAiCard.tsx', import.meta.url), 'utf8')
const conversationCard = readFileSync(new URL('../src/canvas/cards/ConversationCard.tsx', import.meta.url), 'utf8')
const conversationResultCard = readFileSync(
  new URL('../src/canvas/cards/ConversationResultCard.tsx', import.meta.url),
  'utf8',
)
const noteCard = readFileSync(new URL('../src/canvas/cards/NoteCard.tsx', import.meta.url), 'utf8')
const cardShell = readFileSync(new URL('../src/canvas/cards/CardShell.tsx', import.meta.url), 'utf8')
const resultCard = readFileSync(new URL('../src/canvas/cards/ResultCard.tsx', import.meta.url), 'utf8')
const titleCard = readFileSync(new URL('../src/canvas/cards/TitleCard.tsx', import.meta.url), 'utf8')

const selectedWheelCaptureCardSources = [
  askAiCard,
  cardShell,
  conversationCard,
  conversationResultCard,
  noteCard,
  resultCard,
  titleCard,
]

function declarationForSelector(selector: string, property: string): string | null {
  const rulePattern = /([^{}]+)\{([^{}]+)\}/g
  let match: RegExpExecArray | null
  let value: string | null = null

  while ((match = rulePattern.exec(styles))) {
    const selectors = match[1].split(',').map((part) => part.trim())
    if (!selectors.includes(selector)) continue

    const declaration = match[2]
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${property}:`))
    if (declaration) value = declaration.replace(new RegExp(`^${property}:\\s*`), '').trim()
  }

  return value
}

function cursorForSelector(selector: string): string | null {
  return declarationForSelector(selector, 'cursor')
}

describe('canvas cursor modes', () => {
  it('keeps the Select tool as an arrow over canvas, cards, editors, and hitboxes', () => {
    expect(cursorForSelector('.board-flow.tool-select .react-flow__pane.selection')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .react-flow__node')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .react-flow__node *')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .react-flow__edge.selectable')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .react-flow__edge *')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .react-flow__handle')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .react-flow__resize-control')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .card')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .card-title-display')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .note-render')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .card textarea')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .card-title-input')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .model-pick .e-picker')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-select .card-resize-handle.top.left')).toBe(
      'nwse-resize',
    )
    expect(cursorForSelector('.board-flow.tool-select .card-resize-handle.bottom.right')).toBe(
      'nwse-resize',
    )
    expect(cursorForSelector('.board-flow.tool-select .card-resize-handle.top.right')).toBe(
      'nesw-resize',
    )
    expect(cursorForSelector('.board-flow.tool-select .card-resize-handle.bottom.left')).toBe(
      'nesw-resize',
    )
    expect(cursorForSelector('.board-flow.tool-select .react-flow__node-note .note-body.editing')).toBe('text')
    expect(cursorForSelector('.board-flow.tool-select .card textarea.editing')).toBe('text')
    expect(cursorForSelector('.board-flow.tool-select .card textarea:focus')).toBe('text')
    expect(cursorForSelector('.board-flow.tool-select .card-title-input:focus')).toBe('text')
  })

  it('keeps Pan mode as grab over card children without rematching rich descendants while held', () => {
    expect(cursorForSelector('.board-flow.tool-pan .react-flow__pane')).toBe('grab')
    expect(cursorForSelector('.board-flow.tool-pan .react-flow__node')).toBe('grab')
    expect(cursorForSelector('.board-flow.tool-pan .react-flow__node *')).toBe('grab')
    expect(cursorForSelector('.board-flow.tool-pan .react-flow__handle')).toBe('grab')
    expect(cursorForSelector('.board-flow.tool-pan .react-flow__resize-control')).toBe('grab')
    expect(cursorForSelector('.board-flow.tool-pan:active .react-flow__node')).toBe('grabbing')
    expect(cursorForSelector('.board-flow.tool-pan:active .react-flow__node *')).toBeNull()
  })

  it('keeps Highlight mode pen-on-text-only on readable text surfaces', () => {
    expect(cursorForSelector('.board-flow.tool-highlight .react-flow__node')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-highlight .react-flow__node *')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-highlight .react-flow__handle')).toBe('default')
    expect(cursorForSelector('.board-flow.tool-highlight .react-flow__resize-control')).toBe('default')
    // Text surfaces get the highlighter-pen cursor, falling back to the text caret.
    for (const selector of [
      '.board-flow.tool-highlight .note-render',
      '.board-flow.tool-highlight .note-render *',
      '.board-flow.tool-highlight .result-text',
      '.board-flow.tool-highlight .result-text *',
      '.board-flow.tool-highlight .transcript',
      '.board-flow.tool-highlight .transcript *',
    ]) {
      const cursor = cursorForSelector(selector)
      expect(cursor, selector).toContain('url("data:image/svg+xml')
      expect(cursor, selector).toMatch(/, text$/)
    }
    expect(cursorForSelector('.board-flow.tool-highlight .highlight-erase')).toBe('pointer')
  })

  it('keeps fixed-height note read views inside the card hitbox', () => {
    expect(declarationForSelector('.card.note.fixed-h .note-body .note-render', 'min-height')).toBe('0')
  })

  it('wheel-gates the scrollable note body while the card is selected', () => {
    expect(noteCard).toContain('card-body note-body note-font-${fontStep}')
    // A Note body scrolls on selection, not only while editing, so a link
    // preview taller than the card can be scrolled without entering the editor.
    expect(noteCard).toContain('useWheelGate(!!selected, bodyRef)')
    expect(noteCard).toContain("editing ? 'editing' : ''")
  })

  it('keeps selected card chrome available for canvas pan gestures', () => {
    expect(cardShell).toContain("effectiveSelected ? 'selected' : ''")
    expect(cardShell).toMatch(/\{effectiveSelected\s*&&[\s\S]{0,100}<CardResizeHandles\b/)
    expect(cardShell).not.toContain('wheelCaptureClass(true)')
  })

  it('keeps the selected React Flow node wrapper available for canvas pan gestures', () => {
    expect(board).toContain('liveCardNodeClassName(selectedNodeIds.has(c.id), highlightedCardId === c.id)')
    expect(cardInteraction).toContain("highlighted ? 'card-link-target' : ''")
    // The wheel gate keeps an in-flight gesture inside the card through its edge.
    expect(cardInteraction).toContain('const continuesCapturedGesture =')
    expect(cardInteraction).toContain("el.classList.toggle('nowheel', capture)")
  })

  it('derives note editability from the delayed semantic selection snapshot', () => {
    expect(board).toContain('liveCardNodeData(interactionSelectedNodeIds)')
    expect(noteCard).toContain('canEditSelectedCard({ activeTool, data, selected: !!selected })')
    expect(cardInteraction).toContain('selectedCardCountFromNodeData(data) === 1')
    expect(noteCard).not.toContain('selectedCardIds.length')
  })

  it('keeps canvas scroll panning available while a live card is selected', () => {
    expect(board).toContain('const panOnScroll = shouldPanOnScroll({')
    expect(cardInteraction).toContain("return readOnly || activeTool === 'select' || activeTool === 'pan'")
    expect(board).toContain('panOnScroll={panOnScroll}')
    expect(board).toContain('zoomOnScroll={false}')
  })

  it('routes selected-card wheel capture through the card interaction policy', () => {
    for (const source of selectedWheelCaptureCardSources) {
      expect(source).not.toContain("selected ? 'nowheel' : ''")
      expect(source).not.toContain("selected || editing ? 'nowheel' : ''")
    }

    expect(askAiCard).toContain('useWheelGate(editing, bodyRef)')
    expect(conversationCard).toContain('useWheelGate(editing, bodyRef)')
    expect(conversationResultCard).toContain('useWheelGate(!!selected, scrollRef)')
    expect(resultCard).toContain('useWheelGate(!!selected, bodyScrollRef)')
    expect(noteCard).toContain('useWheelGate(!!selected, bodyRef)')
    expect(noteCard).not.toContain('textareaRef')
    // A title is a single line: no scrollable content, so it never claims the wheel.
    expect(titleCard).not.toContain('WheelGate')
    expect(titleCard).not.toContain('nowheel')
  })
})
