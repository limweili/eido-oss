import { expect, type ElementHandle, type Locator, type Page } from '@playwright/test'

type ExactReadyMarkdownEditor = {
  editor: Locator
  pressSequentially: (text: string, options?: { delay?: number }) => Promise<void>
}

type FirstEditorLatch = {
  first: HTMLElement | null
  observer: MutationObserver
}

type FirstEditorLatchWindow = Window & {
  __EIDO_FIRST_EDITOR_LATCHES__?: Record<string, FirstEditorLatch>
}

type ExactEditorTyping = {
  expectStable: () => Promise<void>
  type: () => Promise<void>
}

// Browser-bound callbacks below are deliberately closure-free. The global
// registry stores only an opaque token, the first Element, and its observer;
// selectors, card ids, and content never become global diagnostic state.
export function armFirstEditorLatchInDocument(input: {
  token: string
  rootSelector: string
}) {
  const latchWindow = window as FirstEditorLatchWindow
  const latches = latchWindow.__EIDO_FIRST_EDITOR_LATCHES__ ?? {}
  latchWindow.__EIDO_FIRST_EDITOR_LATCHES__ = latches
  if (latches[input.token]) throw new Error('Duplicate first-editor latch token')
  const root = document.querySelector<HTMLElement>(input.rootSelector)
  if (!root) throw new Error('Missing first-editor latch root')
  const editorSelector = '.markdown-card-editor-content[contenteditable="true"]'
  const record: FirstEditorLatch = {
    first: null,
    observer: new MutationObserver(() => undefined),
  }
  const captureFirst = (editor: HTMLElement | null) => {
    if (record.first || !editor) return
    record.first = editor
    record.observer.disconnect()
  }
  const candidateFromNode = (node: Node) => {
    if (!(node instanceof HTMLElement)) return null
    if (node.matches(editorSelector)) return node
    return node.querySelector<HTMLElement>(editorSelector)
  }
  record.observer = new MutationObserver((records) => {
    for (const mutation of records) {
      if (mutation.type === 'attributes') captureFirst(candidateFromNode(mutation.target))
      for (const added of mutation.addedNodes) captureFirst(candidateFromNode(added))
      if (record.first) return
    }
    captureFirst(root.querySelector<HTMLElement>(editorSelector))
  })
  latches[input.token] = record
  record.observer.observe(root, {
    attributes: true,
    attributeFilter: ['class', 'contenteditable'],
    childList: true,
    subtree: true,
  })
  captureFirst(root.querySelector<HTMLElement>(editorSelector))
}

export function firstEditorFromLatchInDocument(token: string): HTMLElement | null {
  return (window as FirstEditorLatchWindow).__EIDO_FIRST_EDITOR_LATCHES__?.[token]?.first ?? null
}

export function disposeFirstEditorLatchInDocument(token: string) {
  const latchWindow = window as FirstEditorLatchWindow
  const latches = latchWindow.__EIDO_FIRST_EDITOR_LATCHES__
  const latch = latches?.[token]
  latch?.observer.disconnect()
  if (!latches) return
  delete latches[token]
  if (Object.keys(latches).length === 0) delete latchWindow.__EIDO_FIRST_EDITOR_LATCHES__
}

// Passed directly across Playwright's browser boundary. Keep this closure-free
// so every candidate observes the same exact-node focus/Selection contract.
export function observeExactEditorReadinessInDocument(
  expectedEditor: HTMLElement,
  editorSelector?: string,
): boolean {
  const transition = expectedEditor.closest<HTMLElement>('.markdown-card-editor-transition')
  const currentEditor = transition?.querySelector<HTMLElement>(
    '.markdown-card-editor-content[contenteditable="true"]',
  ) ?? null
  const selection = window.getSelection()
  const active = document.activeElement
  const nestedEditable = active instanceof HTMLElement &&
    active.isContentEditable &&
    ['true', 'plaintext-only'].includes(active.getAttribute('contenteditable') ?? '') &&
    !active.matches('button, input, textarea, select, a[href], iframe, object, embed, [role="button"], [role="link"]') &&
    expectedEditor.contains(active)
  const contains = (node: Node | null) =>
    node !== null && (node === expectedEditor || expectedEditor.contains(node))
  return Boolean(
    transition?.dataset.editorReady === 'true' &&
      (!editorSelector || document.querySelector(editorSelector) === expectedEditor) &&
      currentEditor === expectedEditor &&
      expectedEditor.isConnected &&
      (active === expectedEditor || nestedEditable) &&
      selection &&
      selection.rangeCount === 1 &&
      selection.isCollapsed &&
      contains(selection.anchorNode) &&
      contains(selection.focusNode) &&
      selection.anchorNode === selection.focusNode &&
      selection.anchorOffset === selection.focusOffset,
  )
}

async function expectStableExactEditor(
  page: Page,
  editorHandle: ElementHandle<HTMLElement>,
  editorSelector: string,
  timeout: number,
) {
  // waitForFunction treats an async predicate's Promise as truthy before its
  // boolean settles. Poll the awaited frame check so false keeps waiting.
  await expect.poll(() => page.evaluate(
    async ({ expectedEditor, editorSelector }) => {
      const ready = () => {
        const transition = expectedEditor.closest<HTMLElement>('.markdown-card-editor-transition')
        const currentEditor = transition?.querySelector<HTMLElement>(
          '.markdown-card-editor-content[contenteditable="true"]',
        ) ?? null
        const selection = window.getSelection()
        const active = document.activeElement
        const nestedEditable = active instanceof HTMLElement &&
          active.isContentEditable &&
          ['true', 'plaintext-only'].includes(active.getAttribute('contenteditable') ?? '') &&
          !active.matches('button, input, textarea, select, a[href], iframe, object, embed, [role="button"], [role="link"]') &&
          expectedEditor.contains(active)
        const contains = (node: Node | null) =>
          node !== null && (node === expectedEditor || expectedEditor.contains(node))
        return Boolean(
          transition?.dataset.editorReady === 'true' &&
            document.querySelector(editorSelector) === expectedEditor &&
            currentEditor === expectedEditor &&
            expectedEditor.isConnected &&
            (active === expectedEditor || nestedEditable) &&
            selection &&
            selection.rangeCount === 1 &&
            selection.isCollapsed &&
            contains(selection.anchorNode) &&
            contains(selection.focusNode) &&
            selection.anchorNode === selection.focusNode &&
            selection.anchorOffset === selection.focusOffset,
        )
      }
      if (!ready()) return false
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      return ready()
    },
    { expectedEditor: editorHandle, editorSelector },
  ), { timeout }).toBe(true)
}

export async function runExactEditorTyping({
  expectStable,
  type,
}: ExactEditorTyping) {
  // Keep the delivery boundary to one browser-side readiness decision. A
  // second Playwright RPC cannot be "immediately before" keyboard delivery:
  // focus/Selection can legitimately move between the two observations. The
  // stable check already owns the exact Element identity and verifies it on
  // both sides of a requestAnimationFrame.
  await expectStable()
  await type()
  await expectStable()
}

export async function activateAndRequireExactReadyMarkdownEditor(
  page: Page,
  nodeSelector: string,
  activate: () => Promise<void>,
  timeout = 30_000,
): Promise<ExactReadyMarkdownEditor> {
  const editorSelector = `${nodeSelector} .markdown-card-editor-content[contenteditable="true"]`
  const token = `rich-card-editor-${crypto.randomUUID()}`
  await page.evaluate(armFirstEditorLatchInDocument, { token, rootSelector: nodeSelector })
  let editorHandle: ElementHandle<HTMLElement> | null = null
  try {
    await activate()
    const firstEditor = await page.waitForFunction(firstEditorFromLatchInDocument, token, { timeout })
    editorHandle = firstEditor.asElement() as ElementHandle<HTMLElement> | null
    if (!editorHandle) throw new Error('First Markdown editor latch did not return an Element')
  } finally {
    await page.evaluate(disposeFirstEditorLatchInDocument, token).catch(() => undefined)
  }
  if (!editorHandle) throw new Error('Missing exact Markdown editor identity after first click')
  await expectStableExactEditor(page, editorHandle, editorSelector, timeout)
  const editor = page.locator(editorSelector)

  return {
    editor,
    pressSequentially: async (text, options = {}) => {
      await runExactEditorTyping({
        expectStable: () => expectStableExactEditor(page, editorHandle, editorSelector, timeout),
        type: () => page.keyboard.type(text, { delay: options.delay ?? 0 }),
      })
    },
  }
}
