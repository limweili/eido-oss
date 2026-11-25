// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import type { Page } from '@playwright/test'
import {
  activateAndRequireExactReadyMarkdownEditor,
  armFirstEditorLatchInDocument,
  disposeFirstEditorLatchInDocument,
  firstEditorFromLatchInDocument,
  observeExactEditorReadinessInDocument,
  runExactEditorTyping,
} from './richCardEditorReadiness'

function readyEditor() {
  const transition = document.createElement('div')
  transition.className = 'markdown-card-editor-transition'
  transition.dataset.editorReady = 'true'
  const editor = document.createElement('div')
  editor.className = 'markdown-card-editor-content'
  editor.setAttribute('contenteditable', 'true')
  editor.tabIndex = 0
  editor.textContent = 'Synthetic editor'
  transition.append(editor)
  document.body.append(transition)
  editor.focus()
  const range = document.createRange()
  range.setStart(editor.firstChild!, 4)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return { editor, transition }
}

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

describe('provider Markdown editor readiness observation', () => {
  it('accepts a contained native code editor but rejects a contained control taking focus', () => {
    const { editor } = readyEditor()
    const code = document.createElement('code')
    code.setAttribute('contenteditable', 'true')
    Object.defineProperty(code, 'isContentEditable', { value: true })
    code.tabIndex = 0
    editor.append(code)
    code.focus()
    expect(observeExactEditorReadinessInDocument(editor)).toBe(true)

    const button = document.createElement('button')
    button.setAttribute('contenteditable', 'true')
    Object.defineProperty(button, 'isContentEditable', { value: true })
    editor.append(button)
    button.focus()
    expect(observeExactEditorReadinessInDocument(editor)).toBe(false)
  })

  it('retries an awaited false readiness result before accepting the exact editor', async () => {
    const { editor, transition } = readyEditor()
    transition.dataset.editorReady = 'false'
    const readinessResults: unknown[] = []
    const page = {
      evaluate: async <T,>(callback: (arg: T) => unknown, arg: T) => {
        const result = await callback(arg)
        if (arg && typeof arg === 'object' && 'expectedEditor' in arg) {
          readinessResults.push(result)
          // The editor becomes ready between browser observations.
          transition.dataset.editorReady = 'true'
        }
        return result
      },
      waitForFunction: async <T,>(callback: (arg: T) => unknown, arg: T) => {
        const result = callback(arg)
        // A Promise is truthy to waitForFunction's predicate check, even
        // when it later resolves false. The first-editor latch is synchronous.
        return result instanceof Promise ? result : { asElement: () => result }
      },
      locator: () => ({}),
    } as unknown as Page

    await activateAndRequireExactReadyMarkdownEditor(
      page,
      '.markdown-card-editor-transition',
      async () => undefined,
      1_000,
    )

    expect(readinessResults).toEqual([false, true])
    expect(document.activeElement).toBe(editor)
  })

  it('requires data readiness, exact identity, focus, and contained Selection', () => {
    const { editor, transition } = readyEditor()
    expect(observeExactEditorReadinessInDocument(editor)).toBe(true)

    transition.dataset.editorReady = 'false'
    expect(observeExactEditorReadinessInDocument(editor)).toBe(false)
  })

  it('rejects selection outside the editor and a stale replaced identity', () => {
    const { editor } = readyEditor()
    const outside = document.createElement('div')
    outside.textContent = 'Outside'
    document.body.append(outside)
    const range = document.createRange()
    range.setStart(outside.firstChild!, 2)
    range.collapse(true)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    expect(observeExactEditorReadinessInDocument(editor)).toBe(false)

    const replacement = editor.cloneNode(true) as HTMLElement
    editor.replaceWith(replacement)
    replacement.focus()
    const replacementRange = document.createRange()
    replacementRange.selectNodeContents(replacement)
    replacementRange.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(replacementRange)
    expect(observeExactEditorReadinessInDocument(editor)).toBe(false)
  })

  it('rejects non-collapsed and simulated multi-range selections', () => {
    const { editor } = readyEditor()
    const range = document.createRange()
    range.setStart(editor.firstChild!, 1)
    range.setEnd(editor.firstChild!, 5)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    expect(observeExactEditorReadinessInDocument(editor)).toBe(false)

    const originalGetSelection = window.getSelection
    try {
      Object.defineProperty(window, 'getSelection', {
        configurable: true,
        value: () => ({
          rangeCount: 2,
          isCollapsed: true,
          anchorNode: editor.firstChild,
          anchorOffset: 3,
          focusNode: editor.firstChild,
          focusOffset: 3,
        }),
      })
      expect(observeExactEditorReadinessInDocument(editor)).toBe(false)
    } finally {
      Object.defineProperty(window, 'getSelection', { configurable: true, value: originalGetSelection })
    }
  })

  it('latches the first matching editor before post-click resolution and cleans global state', async () => {
    const scope = document.createElement('div')
    scope.id = 'synthetic-scope'
    document.body.append(scope)
    const token = 'synthetic-unique-token'
    armFirstEditorLatchInDocument({
      token,
      rootSelector: '#synthetic-scope',
    })

    const first = document.createElement('div')
    first.className = 'markdown-card-editor-content'
    first.setAttribute('contenteditable', 'true')
    scope.append(first)
    const replacement = first.cloneNode(true) as HTMLElement
    first.replaceWith(replacement)
    await Promise.resolve()

    expect(firstEditorFromLatchInDocument(token)).toBe(first)
    const latchRecord = (window as unknown as {
      __EIDO_FIRST_EDITOR_LATCHES__?: Record<string, object>
    }).__EIDO_FIRST_EDITOR_LATCHES__?.[token]
    expect(Object.keys(latchRecord ?? {}).sort()).toEqual(['first', 'observer'])
    disposeFirstEditorLatchInDocument(token)
    expect(firstEditorFromLatchInDocument(token)).toBe(null)
    expect('__EIDO_FIRST_EDITOR_LATCHES__' in window).toBe(false)
  })

  it('does not type when the atomic pre-delivery readiness decision rejects focus', async () => {
    let typed = false
    let stableChecks = 0
    await expect(runExactEditorTyping({
      expectStable: async () => {
        stableChecks += 1
        throw new Error('synthetic focus loss at atomic delivery boundary')
      },
      type: async () => { typed = true },
    })).rejects.toThrow(/focus loss at atomic delivery boundary/i)
    expect(typed).toBe(false)
    expect(stableChecks).toBe(1)
  })

  it('uses one readiness RPC before delivery instead of the old two-RPC race', async () => {
    const events: string[] = []
    await expect(runExactEditorTyping({
      expectStable: async () => { events.push('stable') },
      type: async () => { events.push('type') },
    })).resolves.toBeUndefined()
    expect(events).toEqual(['stable', 'type', 'stable'])
  })

  it('rejects a replacement observed one frame after keyboard delivery', async () => {
    let stableChecks = 0
    await expect(runExactEditorTyping({
      expectStable: async () => {
        stableChecks += 1
        if (stableChecks === 2) throw new Error('synthetic replacement after typing')
      },
      type: async () => undefined,
    })).rejects.toThrow(/replacement after typing/i)
    expect(stableChecks).toBe(2)
  })
})
