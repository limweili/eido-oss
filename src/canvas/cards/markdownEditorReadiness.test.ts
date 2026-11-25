// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  createBoundedEditorReadinessCoordinator,
  focusEditorForFirstIntent,
  isCollapsedEditorSelection,
  isExactEditorInteractionReady,
  requestExactEditorReadinessFrame,
} from './markdownEditorReadiness'

function connectedEditor(text = 'Editor text') {
  const editor = document.createElement('div')
  editor.setAttribute('contenteditable', 'true')
  editor.tabIndex = 0
  editor.textContent = text
  document.body.append(editor)
  return editor
}

function selectTextNode(element: HTMLElement, offset: number) {
  const text = element.firstChild
  if (!text) throw new Error('Missing editor text node')
  const range = document.createRange()
  range.setStart(text, offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
  Reflect.deleteProperty(document, 'caretPositionFromPoint')
  Reflect.deleteProperty(document, 'caretRangeFromPoint')
})

describe('Markdown editor interaction readiness', () => {
  it.each([
    { tag: 'code', attribute: 'true', allowed: true },
    { tag: 'code', attribute: 'plaintext-only', allowed: true },
    { tag: 'code', attribute: 'true', outside: true, allowed: false },
    { tag: 'button', attribute: 'true', allowed: false },
    { tag: 'a', attribute: 'true', allowed: false },
    { tag: 'input', attribute: 'true', allowed: false },
    { tag: 'div', attribute: 'true', role: 'button', allowed: false },
    { tag: 'div', attribute: null, allowed: false },
  ])('recognizes only an explicit nested native editable focus owner: %j', (owner) => {
    const editor = connectedEditor()
    const nested = document.createElement(owner.tag)
    nested.tabIndex = 0
    if (owner.attribute !== null) nested.setAttribute('contenteditable', owner.attribute)
    if (owner.role) nested.setAttribute('role', owner.role)
    if (owner.tag === 'a') nested.setAttribute('href', 'https://example.com')
    // jsdom does not expose the browser's inherited editing-state property.
    Object.defineProperty(nested, 'isContentEditable', { value: true })
    ;(owner.outside ? document.body : editor).append(nested)
    nested.focus()
    selectTextNode(editor, 3)

    expect(isExactEditorInteractionReady(editor, editor)).toBe(owner.allowed)
  })

  it('accepts only the same connected focused editor with both selection endpoints contained', () => {
    const editor = connectedEditor()
    editor.focus()
    selectTextNode(editor, 3)

    expect(isExactEditorInteractionReady(editor, editor)).toBe(true)

    const outside = document.createElement('div')
    outside.textContent = 'Outside'
    document.body.append(outside)
    selectTextNode(outside, 2)
    expect(isExactEditorInteractionReady(editor, editor)).toBe(false)
  })

  it('rejects a non-collapsed selection and a simulated multi-range selection', () => {
    const editor = connectedEditor()
    editor.focus()
    const text = editor.firstChild!
    const range = document.createRange()
    range.setStart(text, 1)
    range.setEnd(text, 5)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    expect(isExactEditorInteractionReady(editor, editor)).toBe(false)
    expect(isCollapsedEditorSelection(editor, {
      rangeCount: 2,
      isCollapsed: true,
      anchorNode: text,
      anchorOffset: 3,
      focusNode: text,
      focusOffset: 3,
    })).toBe(false)
  })

  it('rejects a stale editor when the live contenteditable is replaced before the confirmation frame', () => {
    const original = connectedEditor('Original')
    original.focus()
    selectTextNode(original, 4)

    let frame: FrameRequestCallback | null = null
    let ready = false
    requestExactEditorReadinessFrame({
      expectedEditor: original,
      currentEditor: () => document.querySelector<HTMLElement>('[contenteditable="true"]'),
      requestFrame: (callback) => {
        frame = callback
        return 1
      },
      onReady: () => {
        ready = true
      },
      onNotReady: () => undefined,
    })

    const replacement = document.createElement('div')
    replacement.setAttribute('contenteditable', 'true')
    replacement.tabIndex = 0
    replacement.textContent = 'Replacement'
    original.replaceWith(replacement)
    replacement.focus()
    selectTextNode(replacement, 5)
    if (!frame) throw new Error('Readiness confirmation frame was not requested')
    ;(frame as FrameRequestCallback)(16)

    expect(ready).toBe(false)
  })

  it('falls back to the live editor root end when the point-derived caret is outside it', () => {
    const editor = connectedEditor('Live editor')
    const passive = document.createElement('div')
    passive.textContent = 'Passive placeholder'
    document.body.append(passive)
    const outsideText = passive.firstChild
    if (!outsideText) throw new Error('Missing passive text node')
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: outsideText, offset: 3 }),
    })

    expect(focusEditorForFirstIntent(editor, { x: 20, y: 30 })).toBe('rootEnd')
    expect(document.activeElement).toBe(editor)
    expect(isExactEditorInteractionReady(editor, editor)).toBe(true)
    expect(window.getSelection()?.anchorNode === editor || editor.contains(window.getSelection()?.anchorNode ?? null))
      .toBe(true)
  })

  it('reports failed rather than rootEnd when Selection is unavailable or addRange fails', () => {
    const editor = connectedEditor()
    const originalGetSelection = window.getSelection
    try {
      Object.defineProperty(window, 'getSelection', { configurable: true, value: () => null })
      expect(focusEditorForFirstIntent(editor, null)).toBe('failed')

      Object.defineProperty(window, 'getSelection', {
        configurable: true,
        value: () => ({
          rangeCount: 0,
          isCollapsed: true,
          anchorNode: null,
          anchorOffset: 0,
          focusNode: null,
          focusOffset: 0,
          removeAllRanges: () => undefined,
          addRange: () => { throw new Error('synthetic addRange failure') },
        }),
      })
      expect(focusEditorForFirstIntent(editor, null)).toBe('failed')
    } finally {
      Object.defineProperty(window, 'getSelection', { configurable: true, value: originalGetSelection })
    }
  })

  it('bounds missing-editor retries and leaves no scheduled frame after timeout', () => {
    let now = 0
    let nextId = 0
    const pending = new Map<number, FrameRequestCallback>()
    const failures: string[] = []
    const coordinator = createBoundedEditorReadinessCoordinator({
      currentEditor: () => null,
      prepareEditor: () => true,
      requestFrame: (callback) => {
        const id = ++nextId
        pending.set(id, callback)
        return id
      },
      cancelFrame: (id) => pending.delete(id),
      now: () => now,
      maxFrames: 3,
      maxDurationMs: 50,
      onReady: () => { throw new Error('must not become ready') },
      onFailure: (reason) => failures.push(reason),
    })

    coordinator.start()
    while (pending.size) {
      const [id, callback] = pending.entries().next().value!
      pending.delete(id)
      now += 10
      callback(now)
    }

    expect(failures).toEqual(['timeout'])
    expect(nextId).toBe(3)
    expect(pending.size).toBe(0)
  })

  it.each([true, false])('bounds the final preparation after a delayed native paint, ready=%s', (becomesReady) => {
    const editor = connectedEditor()
    let now = 0
    let nextId = 0
    let preparations = 0
    let ready = false
    const pending = new Map<number, FrameRequestCallback>()
    const failures: string[] = []
    const coordinator = createBoundedEditorReadinessCoordinator({
      currentEditor: () => editor,
      prepareEditor: () => {
        preparations += 1
        if (becomesReady) {
          editor.focus()
          selectTextNode(editor, 4)
        }
        return true
      },
      requestFrame: (callback) => {
        const id = ++nextId
        pending.set(id, callback)
        return id
      },
      cancelFrame: (id) => pending.delete(id),
      now: () => now,
      maxDurationMs: 50,
      onReady: () => { ready = true },
      onFailure: (reason) => failures.push(reason),
    })

    coordinator.start()
    now = 100
    const first = pending.get(1)!
    pending.delete(1)
    first(now)
    expect(preparations).toBe(1)
    expect(ready).toBe(false)
    expect(pending.size).toBe(1)

    now += 16
    const verification = pending.get(2)!
    pending.delete(2)
    verification(now)
    expect(ready).toBe(becomesReady)
    expect(preparations).toBe(1)
    expect(failures).toEqual(becomesReady ? [] : ['timeout'])
    expect(pending.size).toBe(0)
  })

  it('stops without readiness when editor preparation fails', () => {
    const editor = connectedEditor()
    const pending = new Map<number, FrameRequestCallback>()
    const failures: string[] = []
    let ready = false
    const coordinator = createBoundedEditorReadinessCoordinator({
      currentEditor: () => editor,
      prepareEditor: () => false,
      requestFrame: (callback) => {
        pending.set(1, callback)
        return 1
      },
      cancelFrame: (id) => pending.delete(id),
      now: () => 0,
      onReady: () => { ready = true },
      onFailure: (reason) => failures.push(reason),
    })

    coordinator.start()
    const callback = pending.get(1)
    if (!callback) throw new Error('Missing readiness frame')
    pending.delete(1)
    callback(0)

    expect(ready).toBe(false)
    expect(failures).toEqual(['prepare-failed'])
    expect(pending.size).toBe(0)
  })

  it('cancels its sole pending frame on unmount without invoking readiness callbacks', () => {
    const pending = new Map<number, FrameRequestCallback>()
    let nextId = 0
    let callbackCount = 0
    const coordinator = createBoundedEditorReadinessCoordinator({
      currentEditor: () => connectedEditor(),
      prepareEditor: () => true,
      requestFrame: (callback) => {
        const id = ++nextId
        pending.set(id, callback)
        return id
      },
      cancelFrame: (id) => pending.delete(id),
      now: () => 0,
      onReady: () => { callbackCount += 1 },
      onFailure: () => { callbackCount += 1 },
    })

    coordinator.start()
    expect(pending.size).toBe(1)
    coordinator.cancel()
    expect(pending.size).toBe(0)
    expect(callbackCount).toBe(0)
  })
})
