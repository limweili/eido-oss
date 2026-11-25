// @vitest-environment jsdom

import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../../graph/store'
import type { Card } from '../../graph/types'
import { OverlayProvider } from '../../ui/overlays'
import { NoteCard } from './NoteCard'
// The card reaches its rich editor through a lazy import that also pulls in
// syntax highlighting. Import the editor eagerly and stub the highlighter so
// the test measures the handoff rather than a module load.
import './RichMarkdownEditor'

vi.mock('prismjs', () => ({ default: {} }))

// Prose a writer can reasonably paste. Every line here reads as text in the
// passive render, so the editor has to agree: an angle bracket that MDX would
// try to read as a tag, an unclosed tag name, and an angle inside code.
const PASTED_PROSE = [
  'Latency table',
  '',
  '"fast"\tSub-second, no LLM.\t<1s',
  '',
  'Use the <div> element, and keep `a <1s` intact.',
].join('\n')

const noteCard: Card = {
  id: 'pasted-note',
  kind: 'note',
  blocks: [{ id: 'pasted-note-block', text: PASTED_PROSE }],
  position: { x: 120, y: 80 },
  // The founder's card carried an explicit size. Keep it so the regression
  // covers the geometry the symptom was first seen through.
  size: { width: 406, height: 338 },
}

function noteTree(selected = true, selectedCardCount = 1) {
  const props = {
    id: noteCard.id,
    selected,
    data: { selectedCardCount },
  } as unknown as NodeProps
  return (
    <OverlayProvider>
      <ReactFlowProvider>
        <NoteCard {...props} />
      </ReactFlowProvider>
    </OverlayProvider>
  )
}

function renderNote() {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  return render(noteTree(), { container: appRoot })
}

async function openEditor(container: HTMLElement) {
  const passiveBody = container.querySelector<HTMLElement>('.note-render.markdown')
  fireEvent.pointerDown(passiveBody!, { pointerId: 1, button: 0, clientX: 24, clientY: 24 })
  fireEvent.pointerUp(window, { pointerId: 1, button: 0, clientX: 24, clientY: 24 })
  fireEvent.click(passiveBody!, { clientX: 24, clientY: 24 })
  let editor: HTMLElement | null = null
  for (let attempt = 0; attempt < 30 && !editor?.textContent; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    editor = container.querySelector<HTMLElement>('.markdown-card-editor-content')
  }
  return editor
}

describe('note card editing', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [structuredClone(noteCard)],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      lastBoardChange: null,
      boardChangeSeq: 0,
      selection: { kind: 'card', id: noteCard.id },
      selectedCardIds: [noteCard.id],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      currentIdeaId: null,
      activeTool: 'select',
    })
  })

  afterEach(() => {
    cleanup()
    document.body.replaceChildren()
  })

  it('opens the editor holding the body a reader saw, angle brackets included', async () => {
    const { container } = renderNote()
    expect(container.querySelector('.markdown-card-editor-content')).toBeNull()
    const editor = await openEditor(container)

    expect(editor).not.toBeNull()
    expect(editor!.textContent).toContain('<1s')
    expect(editor!.textContent).toContain('<div>')
    expect(editor!.textContent).toContain('Latency table')
  })

  it('keeps one editor across selection loss, then closes on real blur', async () => {
    const rendered = renderNote()
    const editor = await openEditor(rendered.container)
    expect(editor).not.toBeNull()
    rendered.rerender(noteTree(false, 0))
    expect(rendered.container.querySelector('.markdown-card-editor-content')).toBe(editor)
    expect(editor!.textContent).toContain('Latency table')
    fireEvent.blur(editor!)
    expect(rendered.container.querySelector('.markdown-card-editor-content')).toBeNull()
  })

  it('closes the editor when the active tool leaves select', async () => {
    const rendered = renderNote()
    expect(await openEditor(rendered.container)).not.toBeNull()
    act(() => useGraph.setState({ activeTool: 'pan' }))
    expect(rendered.container.querySelector('.markdown-card-editor-content')).toBeNull()
  })

  it('retires press-local focus intent when a passive-body press becomes a drag', () => {
    const { container } = renderNote()
    const passiveBody = container.querySelector<HTMLElement>('.note-render.markdown')!

    fireEvent.pointerDown(passiveBody, {
      pointerId: 9,
      pointerType: 'mouse',
      button: 0,
      clientX: 24,
      clientY: 24,
    })
    fireEvent.pointerMove(window, {
      pointerId: 9,
      pointerType: 'mouse',
      clientX: 48,
      clientY: 24,
    })
    fireEvent.focus(passiveBody)

    expect(container.querySelector('.markdown-card-editor-content')).not.toBeNull()
  })
})
