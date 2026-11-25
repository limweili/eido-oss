export const MARKDOWN_EDITOR_SELECTOR = '.markdown-card-editor-content[contenteditable="true"]'

export type EditorCaretPlacement = 'point' | 'rootEnd' | 'failed'

export type EditorSelectionSnapshot = Pick<
  Selection,
  'rangeCount' | 'isCollapsed' | 'anchorNode' | 'anchorOffset' | 'focusNode' | 'focusOffset'
>

export type EditorReadinessFailure = 'timeout' | 'prepare-failed' | 'exception'

type EditorReadinessCoordinatorOptions = {
  currentEditor: () => HTMLElement | null
  prepareEditor: (editor: HTMLElement) => boolean
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (frame: number) => void
  now: () => number
  maxFrames?: number
  maxDurationMs?: number
  onReady: (editor: HTMLElement) => void
  onFailure: (reason: EditorReadinessFailure) => void
}

export type EditorReadinessCoordinator = {
  start: (expectedEditor?: HTMLElement | null) => void
  cancel: () => void
}

type ReadinessFrameOptions = {
  expectedEditor: HTMLElement
  currentEditor: () => HTMLElement | null
  requestFrame: (callback: FrameRequestCallback) => number
  onReady: (editor: HTMLElement) => void
  onNotReady: (currentEditor: HTMLElement | null) => void
}

function containsNode(editor: HTMLElement, node: Node | null): boolean {
  return node !== null && (node === editor || editor.contains(node))
}

export function isCollapsedEditorSelection(
  editor: HTMLElement,
  selection: EditorSelectionSnapshot | null,
): boolean {
  return Boolean(
    selection &&
      selection.rangeCount === 1 &&
      selection.isCollapsed &&
      containsNode(editor, selection.anchorNode) &&
      containsNode(editor, selection.focusNode) &&
      selection.anchorNode === selection.focusNode &&
      selection.anchorOffset === selection.focusOffset,
  )
}

function rangeIsContained(editor: HTMLElement, range: Range): boolean {
  return containsNode(editor, range.startContainer) && containsNode(editor, range.endContainer)
}

function installSelection(editor: HTMLElement, range: Range): boolean {
  const selection = editor.ownerDocument.defaultView?.getSelection() ?? null
  if (!selection) return false
  try {
    selection.removeAllRanges()
    selection.addRange(range)
  } catch {
    return false
  }
  return isCollapsedEditorSelection(editor, selection)
}

function placeCaretAtRootEnd(editor: HTMLElement): boolean {
  const range = editor.ownerDocument.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  return installSelection(editor, range)
}

function pointRange(editor: HTMLElement, point: { x: number; y: number }): Range | null {
  const documentAtPoint = editor.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const boundaryStyle = editor.closest<HTMLElement>('.markdown-card-editor-boundary')?.style
  const previousPointerEvents = boundaryStyle?.pointerEvents
  // The editor is deliberately non-interactive beneath the passive placeholder
  // during handoff. Admit it only for this hit-test so the recorded first click
  // resolves inside the editor instead of falling back to its root end.
  if (boundaryStyle) boundaryStyle.pointerEvents = 'auto'
  try {
    const position = documentAtPoint.caretPositionFromPoint?.(point.x, point.y)
    if (position) {
      const range = editor.ownerDocument.createRange()
      range.setStart(position.offsetNode, position.offset)
      return range
    }
    const range = documentAtPoint.caretRangeFromPoint?.(point.x, point.y) ?? null
    range?.collapse(true)
    return range
  } catch {
    return null
  } finally {
    if (boundaryStyle) boundaryStyle.pointerEvents = previousPointerEvents!
  }
}

export function findMarkdownEditor(root: ParentNode | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>(MARKDOWN_EDITOR_SELECTOR) ?? null
}

export function isExactEditorInteractionReady(
  expectedEditor: HTMLElement,
  currentEditor: HTMLElement | null,
): boolean {
  const contenteditable =
    expectedEditor.isContentEditable || expectedEditor.getAttribute('contenteditable') === 'true'
  const active = expectedEditor.ownerDocument.activeElement
  // Code blocks can own native editing focus inside the same Markdown root.
  const nestedEditable = active instanceof HTMLElement &&
    active.isContentEditable &&
    ['true', 'plaintext-only'].includes(active.getAttribute('contenteditable') ?? '') &&
    !active.matches('button, input, textarea, select, a[href], iframe, object, embed, [role="button"], [role="link"]') &&
    expectedEditor.contains(active)
  return Boolean(
    expectedEditor === currentEditor &&
      expectedEditor.isConnected &&
      contenteditable &&
      (active === expectedEditor || nestedEditable) &&
      isCollapsedEditorSelection(
        expectedEditor,
        expectedEditor.ownerDocument.defaultView?.getSelection() ?? null,
      ),
  )
}

export function focusEditorForFirstIntent(
  editor: HTMLElement,
  point: { x: number; y: number } | null,
): EditorCaretPlacement {
  editor.focus({ preventScroll: true })
  if (point) {
    const range = pointRange(editor, point)
    if (range && rangeIsContained(editor, range) && installSelection(editor, range)) return 'point'
  }
  return placeCaretAtRootEnd(editor) ? 'rootEnd' : 'failed'
}

export function createBoundedEditorReadinessCoordinator({
  currentEditor,
  prepareEditor,
  requestFrame,
  cancelFrame,
  now,
  maxFrames = 180,
  maxDurationMs = 3_000,
  onReady,
  onFailure,
}: EditorReadinessCoordinatorOptions): EditorReadinessCoordinator {
  let expectedEditor: HTMLElement | null = null
  let pendingFrame: number | null = null
  let startedAt = 0
  let frames = 0
  let started = false
  let finished = false
  let cancelled = false
  let finalPreparationAttempted = false

  const fail = (reason: EditorReadinessFailure) => {
    if (finished || cancelled) return
    finished = true
    onFailure(reason)
  }
  const schedule = () => {
    if (finished || cancelled || pendingFrame !== null) return
    pendingFrame = requestFrame(step)
  }
  const step: FrameRequestCallback = () => {
    pendingFrame = null
    if (finished || cancelled) return
    frames += 1
    let current: HTMLElement | null
    try {
      current = currentEditor()
    } catch {
      fail('exception')
      return
    }
    if (expectedEditor && isExactEditorInteractionReady(expectedEditor, current)) {
      finished = true
      onReady(expectedEditor)
      return
    }
    if (finalPreparationAttempted || frames >= maxFrames) {
      fail('timeout')
      return
    }
    if (now() - startedAt >= maxDurationMs) {
      // A large native commit can consume the waiting budget before its first
      // focus attempt. Give that connected editor one preparation and one
      // confirming frame, without renewing the deadline or accepting a swap.
      if (!current?.isConnected || (expectedEditor && current !== expectedEditor)) {
        fail('timeout')
        return
      }
      finalPreparationAttempted = true
    }
    if (current) {
      try {
        if (!prepareEditor(current)) {
          fail('prepare-failed')
          return
        }
      } catch {
        fail('exception')
        return
      }
      expectedEditor = current
    }
    // Preparation itself may perform the first expensive native layout.
    if (current && now() - startedAt >= maxDurationMs) finalPreparationAttempted = true
    schedule()
  }

  return {
    start: (initialExpectedEditor = null) => {
      if (started || finished || cancelled) return
      started = true
      startedAt = now()
      expectedEditor = initialExpectedEditor
      schedule()
    },
    cancel: () => {
      if (cancelled || finished) return
      cancelled = true
      if (pendingFrame !== null) {
        cancelFrame(pendingFrame)
        pendingFrame = null
      }
    },
  }
}

export function requestExactEditorReadinessFrame({
  expectedEditor,
  currentEditor,
  requestFrame,
  onReady,
  onNotReady,
}: ReadinessFrameOptions): number {
  return requestFrame(() => {
    const current = currentEditor()
    if (isExactEditorInteractionReady(expectedEditor, current)) onReady(expectedEditor)
    else onNotReady(current)
  })
}
