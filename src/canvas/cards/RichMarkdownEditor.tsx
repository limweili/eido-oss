import {
  MDXEditor,
  addExportVisitor$,
  addImportVisitor$,
  codeBlockPlugin,
  createRootEditorSubscription$,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  realmPlugin,
  tablePlugin,
  thematicBreakPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorProps,
  type MDXEditorMethods,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  type ElementNode,
  type LexicalNode,
} from 'lexical'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { NoteFontSize } from '../../graph/noteFontSize'
import { markdownTextFromClipboard } from '../../shared/clipboardText'
import {
  authoredBlankParagraphs,
  isDirectMarkdownHref,
  isSafeMarkdownHref,
  neutralizeMarkdownAngles,
  neutralizeUnsafeMarkdownLinks,
  normalizeMarkdownTransport,
  restoreMarkdownAngles,
} from '../../shared/markdown'
import {
  createBoundedEditorReadinessCoordinator,
  findMarkdownEditor,
  focusEditorForFirstIntent,
} from './markdownEditorReadiness'
import { markdownLinkDialogPlugin } from './MarkdownLinkDialog'
import { proseRoleClass } from './proseRoles'

export type EditorFocusPoint = { x: number; y: number } | null

export type RichMarkdownEditorProps = {
  markdown: string
  placeholder: string
  ariaLabel: string
  proseSize?: NoteFontSize
  focusPoint: EditorFocusPoint
  onChange: (markdown: string) => void
  onBlur: (markdown: string) => void
  onContentReady?: () => void
}

type MountedRichMarkdownEditorProps = Omit<RichMarkdownEditorProps, 'onContentReady'> & {
  onContentReady?: (editor: HTMLElement) => void
  sourceRevision?: number
}

// One authored empty paragraph, spelled as a character Markdown carries but
// nobody types: a marked paragraph survives the mdast round trip that would
// otherwise swallow a blank line, and never reaches the live document, because
// the blank paragraph plugin trades the mark for a real empty paragraph on the
// way in and mints it back on the way out.
const blankParagraphMark = '​'

// The two halves of the blank paragraph transport. On the way in a marked
// paragraph becomes a genuinely empty one, so a blank line behaves natively
// under the caret and a single Backspace removes it. On the way out an empty
// paragraph carries the mark again, because MDXEditor trims its exported
// document and would otherwise delete the blank lines a writer left at the top
// or the bottom of a Note.
const blankParagraphPlugin = realmPlugin({
  init(realm) {
    // Every paragraph the import visitor below mints for a marked mdast node
    // is a blank line the writer actually typed. Recording its key gives
    // export a provenance check that survives no matter what block sits
    // before the paragraph, instead of guessing from sibling shape alone.
    const authoredEmptyParagraphKeys = new Set<string>()
    // MDXEditor pads a document that does not end in a paragraph with an empty
    // one, so a writer has somewhere to type after a heading, a list or a code
    // fence. That paragraph is the library's furniture, not anybody's text: it
    // must not be exported, and it must not make a Card one line taller to
    // write than the same Note is to read. Its mdast shape says so exactly - a
    // paragraph with no children at all, which authored Markdown never
    // produces - so it is recognised here rather than guessed at later.
    const furnitureParagraphKeys = new Set<string>()

    realm.pub(addImportVisitor$, {
      priority: 1,
      testNode: (node) => (
        node.type === 'paragraph' &&
        node.children.length === 1 &&
        node.children[0].type === 'text' &&
        node.children[0].value === blankParagraphMark
      ),
      visitNode: ({ lexicalParent }) => {
        const paragraph = $createParagraphNode()
        authoredEmptyParagraphKeys.add(paragraph.getKey());
        (lexicalParent as ElementNode).append(paragraph)
      },
    })
    realm.pub(addImportVisitor$, {
      priority: 1,
      testNode: (node) => node.type === 'paragraph' && node.children.length === 0,
      visitNode: ({ lexicalParent }) => {
        const paragraph = $createParagraphNode()
        furnitureParagraphKeys.add(paragraph.getKey());
        (lexicalParent as ElementNode).append(paragraph)
      },
    })
    realm.pub(createRootEditorSubscription$, (lexicalEditor) => (
      lexicalEditor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          for (const key of furnitureParagraphKeys) {
            const node = $getNodeByKey(key)
            if (!node || !$isParagraphNode(node)) {
              furnitureParagraphKeys.delete(key)
              continue
            }
            // Furniture only while it stays what the library made: empty, at
            // the very end, and not where the writer has put the caret. Take
            // the caret there and it opens up like the line it is about to
            // become; the Card grows because somebody chose to write, not
            // because they opened the editor.
            const selection = $getSelection()
            const occupied = $isRangeSelection(selection) &&
              (selection.anchor.getNode().getKey() === key ||
                selection.focus.getNode().getKey() === key)
            const spare = node.getChildrenSize() === 0 &&
              node.getNextSibling() === null &&
              !occupied
            lexicalEditor.getElementByKey(key)?.toggleAttribute('data-editor-spare', spare)
          }
        })
      })
    ))
    realm.pub(addExportVisitor$, {
      priority: 1,
      testLexicalNode: (node): node is LexicalNode => (
        $isParagraphNode(node) && node.getChildrenSize() === 0
      ),
      visitLexicalNode: ({ lexicalNode, actions }) => {
        // MDXEditor parks an empty paragraph after a document that ends in a
        // heading, a list or a table, so the writer has somewhere to type.
        // That one never went through the import visitor above, so it holds
        // no authored key; it is the library's furniture rather than a blank
        // line anybody left, and marking it would grow every such Note by a
        // line on first edit. A key recorded above always wins this check,
        // so an authored trailing blank survives regardless of what precedes it.
        const authored = authoredEmptyParagraphKeys.has(lexicalNode.getKey())
        const previous = lexicalNode.getPreviousSibling()
        if (!authored && lexicalNode.getNextSibling() === null && previous && !$isParagraphNode(previous)) {
          actions.nextVisitor()
          return
        }
        actions.addAndStepInto(
          'paragraph',
          { children: [{ type: 'text', value: blankParagraphMark }] },
          false,
        )
      },
    })
  },
})

function plugins() {
  return [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin({ validateUrl: isSafeMarkdownHref }),
    markdownLinkDialogPlugin(),
    tablePlugin(),
    codeBlockPlugin({
      defaultCodeBlockLanguage: 'txt',
      codeBlockEditorDescriptors: [
        {
          priority: 0,
          match: () => true,
          Editor: CardCodeBlockEditor,
        },
      ],
    }),
    markdownShortcutPlugin(),
    blankParagraphPlugin(),
    caretFollowPlugin(),
  ]
}

function isBlockLine(line: string): boolean {
  return /^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|```|\|)/.test(line.trim())
}

type MarkdownLineEdit = {
  line: string
  replacePrevious?: boolean
}

function transformMarkdownLines(
  markdown: string,
  transform: (context: {
    line: string
    next: string | undefined
    previous: string | undefined
    inCode: boolean
  }) => MarkdownLineEdit,
): string {
  const sourceLines = markdown.split('\n')
  const lines: string[] = []
  let inCode = false

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index]
    if (/^```/.test(line.trim())) {
      inCode = !inCode
      lines.push(line)
      continue
    }

    const edit = transform({
      line,
      next: sourceLines[index + 1],
      previous: lines[lines.length - 1],
      inCode,
    })
    if (edit.replacePrevious && lines.length > 0) lines[lines.length - 1] = edit.line
    else lines.push(edit.line)
  }

  return lines.join('\n')
}

// MDXEditor reads Markdown through mdast, where a run of blank lines is nothing
// but a paragraph break. Carry every empty paragraph the writer typed across
// that seam so the editor shows the same blank lines the passive Card draws.
function editorBlankParagraphs(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let inCode = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^```/.test(line.trim())) inCode = !inCode
    if (inCode || line.trim() !== '') {
      out.push(line)
      continue
    }

    let last = index
    while (last + 1 < lines.length && lines[last + 1].trim() === '') last += 1
    const opensDocument = out.length === 0
    const betweenBlocks = !opensDocument && last < lines.length - 1
    const empties = authoredBlankParagraphs(last - index + 1, betweenBlocks)
    const marked = Array.from({ length: empties }, () => [blankParagraphMark, '']).flat()
    out.push(...(opensDocument ? marked : ['', ...marked]))
    index = last
  }

  return out.join('\n')
}

// The passive renderer follows Markdown's soft-break rule: one newline inside
// a paragraph is a space. MDXEditor otherwise materialises each such line as a
// paragraph, which can abruptly grow a tall card when it enters edit mode.
// Keep both representations geometrically equivalent while leaving real
// Markdown blocks and explicit hard breaks intact.
function editorMarkdown(markdown: string): string {
  return editorBlankParagraphs(transformMarkdownLines(markdown, ({ line, previous, inCode }) => {
    const joinsPrevious =
      !inCode &&
      previous !== undefined &&
      previous.trim() !== '' &&
      line.trim() !== '' &&
      !/(?: {2}|\\)$/.test(previous) &&
      !isBlockLine(previous) &&
      !isBlockLine(line)

    return joinsPrevious
      ? { line: `${previous} ${line.trimStart()}`, replacePrevious: true }
      : { line }
  }))
}

// MDXEditor serialises a line-break node as a single newline, which ordinary
// Markdown reads as a soft space. By the time content reaches this seam,
// pre-existing soft lines were already joined by editorMarkdown, so remaining
// prose newlines represent authored editor breaks and can be made explicit.
function persistedEditorMarkdown(markdown: string): string {
  // Each marked paragraph goes back to being the blank line it stands for. The
  // mark is the editor's transport, never the writer's text, so the Graph keeps
  // ordinary Markdown that any other reader understands.
  const asBlankLines = transformMarkdownLines(markdown, ({ line, inCode }) => ({
    line: !inCode && line.trim() === blankParagraphMark ? '' : line,
  }))
  const withHardBreaks = transformMarkdownLines(asBlankLines, ({ line, next, inCode }) => {
    const needsHardBreak =
      !inCode &&
      next !== undefined &&
      line.trim() !== '' &&
      next.trim() !== '' &&
      !/(?: {2}|\\)$/.test(line) &&
      !isBlockLine(line) &&
      !isBlockLine(next)

    return { line: needsHardBreak ? `${line}  ` : line }
  })
  return restoreMarkdownAngles(withHardBreaks)
}

// The block the caret sits in: the editor's own direct child, which is the one
// element whose line-height describes the line the writer is looking at.
function caretBlock(node: Node, editor: HTMLElement): HTMLElement | null {
  let block = node instanceof Element ? node : node.parentElement
  while (block && block.parentElement !== editor) block = block.parentElement
  return block instanceof HTMLElement ? block : null
}

// The whole line box under the caret, not the glyphs inside it. A caret rect is
// the text's own height, a couple of pixels short of the line box at both ends,
// and on a blank line it has no height at all. Both are reconstructed from the
// same place: the caret's vertical centre, opened out to the block's leading.
function caretLineBox(
  range: Range,
  editor: HTMLElement,
): { block: HTMLElement; top: number; bottom: number } | null {
  const block = caretBlock(range.startContainer, editor)
  if (!block) return null
  const caret = range.getBoundingClientRect()
  const measured = caret.height > 0 ? caret : block.getBoundingClientRect()
  const centre = (measured.top + measured.bottom) / 2
  const leading = Number.parseFloat(getComputedStyle(block).lineHeight)
  const half = (Number.isFinite(leading) ? leading : measured.height) / 2
  return { block, top: centre - half, bottom: centre + half }
}

// Whether the writer is on the document's last line. The spare paragraph the
// library parks at the end is a place rather than a line and carries no height
// until the caret enters it, so a block it trails is still the last one.
function isLastBlock(block: HTMLElement): boolean {
  for (let after = block.nextElementSibling; after; after = after.nextElementSibling) {
    if (!(after instanceof HTMLElement) || !after.hasAttribute('data-editor-spare')) return false
  }
  return true
}

// Keep the line being written visible, and move nothing else. Lexical already
// scrolls the caret as it reconciles, but it measures the caret's own rectangle
// - empty on a blank line - and walks every scrollable ancestor out to the
// window, so the canvas itself could travel because a Note grew a line. This
// runs in the same reconciliation, so the view follows the keystroke rather
// than the key release, and it scrolls the Card body by the smallest amount
// that puts the line on screen, so no space appears below the caret that the
// writer did not type.
function followCaretLineInCardBody(editor: HTMLElement): void {
  const body = editor.closest('.card-body')
  if (!(body instanceof HTMLElement)) return
  const selection = window.getSelection()
  if (!selection?.isCollapsed || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return
  const line = caretLineBox(range, editor)
  if (!line) return

  const view = body.getBoundingClientRect()
  const delta = line.top < view.top
    ? line.top - view.top
    : line.bottom > view.bottom
      ? line.bottom - view.bottom
      : 0
  if (delta === 0) return
  // A scroller settles on whole pixels, so a fractional move can leave a
  // hairline of the line still cut off. Round away from zero: the line is
  // whole, and the extra is under one pixel.
  const step = delta > 0 ? Math.ceil(delta) : Math.floor(delta)

  // The Card body holds a padding under its text, so the smallest scroll that
  // reveals the last line still leaves that padding below the caret: the
  // writer can see what they wrote, and can also still scroll. When the line
  // being written is the document's last one, travel the whole way instead, so
  // writing at the end of a Note comes to rest where reading it does. A last
  // block taller than the view keeps the smallest move, which is the only one
  // that leaves the line the writer is on in sight.
  const remaining = body.scrollHeight - body.clientHeight - body.scrollTop
  const pinsToBottom = step > 0 &&
    remaining > step &&
    isLastBlock(line.block) &&
    line.top - remaining >= view.top
  if (pinsToBottom) body.scrollTop = body.scrollHeight - body.clientHeight
  else body.scrollTop += step
}

const caretFollowPlugin = realmPlugin({
  init(realm) {
    realm.pub(createRootEditorSubscription$, (lexicalEditor) => (
      lexicalEditor.registerUpdateListener(() => {
        const editor = lexicalEditor.getRootElement()
        // Only a caret the writer is actually holding may move the Card. An
        // import or a background update must leave the reader where they are.
        if (!editor || document.activeElement !== editor) return
        followCaretLineInCardBody(editor)
      })
    ))
  },
})

function CardCodeBlockEditor({ code, focusEmitter }: CodeBlockEditorProps) {
  const codeRef = useRef<HTMLElement>(null)
  const { setCode } = useCodeBlockEditorContext()

  useEffect(() => {
    focusEmitter.subscribe(() => codeRef.current?.focus())
  }, [focusEmitter])

  return (
    <pre className="markdown-card-code-block">
      <code
        ref={codeRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Code block"
        spellCheck={false}
        onInput={(event) => setCode(event.currentTarget.textContent ?? '')}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {code}
      </code>
    </pre>
  )
}

export function RichMarkdownEditor({
  markdown,
  placeholder,
  ariaLabel,
  proseSize,
  focusPoint,
  onChange,
  onBlur,
  onContentReady,
  sourceRevision = 0,
}: MountedRichMarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const boundaryRef = useRef<HTMLDivElement>(null)
  const normalizedMarkdown = useMemo(
    () => editorMarkdown(
      neutralizeMarkdownAngles(neutralizeUnsafeMarkdownLinks(normalizeMarkdownTransport(markdown))),
    ),
    [markdown],
  )
  const importedSourceRef = useRef({
    markdown: normalizedMarkdown,
    revision: sourceRevision,
  })
  const editorPlugins = useMemo(plugins, [])
  const proseClass = proseRoleClass(proseSize)

  // MDXEditor reads its `markdown` prop only as initial state. Local edits
  // already live inside Lexical and must never be round-tripped through a full
  // import, but a true external Graph replacement still has to reach the
  // mounted editor. MarkdownCardEditor filters controlled local echoes before
  // they reach this seam, so every later source change here is authoritative.
  useEffect(() => {
    const imported = importedSourceRef.current
    if (normalizedMarkdown === imported.markdown && sourceRevision === imported.revision) return
    const editor = editorRef.current
    if (!editor) return
    importedSourceRef.current = {
      markdown: normalizedMarkdown,
      revision: sourceRevision,
    }
    editor.setMarkdown(normalizedMarkdown)
  }, [normalizedMarkdown, sourceRevision])

  useLayoutEffect(() => {
    let cancelled = false
    let lexicalFocusStarted = false
    let lexicalFocusReady = false
    let lexicalFocusFailed = false
    const currentEditor = () => {
      if (lexicalFocusFailed) throw new Error('Markdown editor focus preparation failed')
      const editor = findMarkdownEditor(boundaryRef.current)
      const methods = editorRef.current
      if (!editor || !methods) return null
      if (!lexicalFocusStarted) {
        lexicalFocusStarted = true
        if (focusPoint) {
          // A pointer activation already supplies the intended caret. Asking
          // Lexical to focus first would create a root-end selection that can
          // reassert after readiness and pull a long Card to the bottom.
          lexicalFocusReady = focusEditorForFirstIntent(editor, focusPoint) !== 'failed'
          lexicalFocusFailed = !lexicalFocusReady
        } else {
          methods.focus(() => {
            if (cancelled) return
            const focusedEditor = findMarkdownEditor(boundaryRef.current)
            if (!focusedEditor || focusEditorForFirstIntent(focusedEditor, null) === 'failed') {
              lexicalFocusFailed = true
              return
            }
            lexicalFocusReady = true
          }, { defaultSelection: 'rootEnd', preventScroll: true })
        }
      }
      return lexicalFocusReady ? editor : null
    }
    const coordinator = createBoundedEditorReadinessCoordinator({
      currentEditor,
      prepareEditor: (editor) => focusEditorForFirstIntent(editor, focusPoint) !== 'failed',
      requestFrame: window.requestAnimationFrame,
      cancelFrame: window.cancelAnimationFrame,
      now: () => performance.now(),
      onReady: (editor) => {
        if (!cancelled) onContentReady?.(editor)
      },
      onFailure: () => undefined,
    })
    coordinator.start()
    return () => {
      cancelled = true
      coordinator.cancel()
    }
  }, [focusPoint, onContentReady])

  return (
    <div
      ref={boundaryRef}
      className={`markdown-card-editor-boundary ${proseClass}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onPasteCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('.markdown-card-code-block')) return
        const selection = window.getSelection()
        const selectedTextIsInsideEditor =
          selection &&
          !selection.isCollapsed &&
          selection.rangeCount > 0 &&
          boundaryRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)
        const directHref = event.clipboardData.getData('text/plain').trim()
        // Lexical's LinkPlugin owns this exact journey. Let the native paste
        // reach it so a URL pasted over selected prose wraps that prose rather
        // than replacing it with the raw URL.
        if (selectedTextIsInsideEditor && isDirectMarkdownHref(directHref)) return
        const pastedMarkdown = markdownTextFromClipboard(event.clipboardData)
        const editor = editorRef.current
        if (!pastedMarkdown || !editor) return
        event.preventDefault()
        event.stopPropagation()
        editor.insertMarkdown(
          editorMarkdown(neutralizeMarkdownAngles(normalizeMarkdownTransport(pastedMarkdown))),
        )
      }}
    >
      <MDXEditor
        ref={editorRef}
        className="markdown-card-editor"
        contentEditableClassName={`note-render markdown e-prose ${proseClass} markdown-card-editor-content nodrag`}
        markdown={normalizedMarkdown}
        trim={false}
        placeholder={
          <span className={`markdown-card-editor-empty result-empty e-prose ${proseClass}`}>
            {placeholder}
          </span>
        }
        plugins={editorPlugins}
        onChange={(nextMarkdown, initialMarkdownNormalize) => {
          if (!initialMarkdownNormalize) onChange(persistedEditorMarkdown(nextMarkdown))
        }}
        onBlur={(event) => {
          // The link dialog is a part of this editor that happens to live in a
          // floating layer, so focus moving into it is not the writer leaving.
          // Reading that blur as an exit unmounted the dialog under the pointer
          // and swallowed the very click that caused it.
          const nextFocus = event.relatedTarget
          if (
            nextFocus instanceof Element &&
            nextFocus.closest('[data-markdown-link-dialog]')
          ) return
          onBlur(persistedEditorMarkdown(editorRef.current?.getMarkdown() ?? markdown))
        }}
        translation={(key, defaultValue) => (
          key === 'contentArea.editableMarkdown' ? ariaLabel : defaultValue
        )}
      />
    </div>
  )
}
