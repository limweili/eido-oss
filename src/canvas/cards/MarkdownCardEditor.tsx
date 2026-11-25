import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { normalizeMarkdownTransport, renderMarkdown } from '../../shared/markdown'
import type { RichMarkdownEditorProps } from './RichMarkdownEditor'
import {
  createBoundedEditorReadinessCoordinator,
  findMarkdownEditor,
  focusEditorForFirstIntent,
  type EditorReadinessCoordinator,
} from './markdownEditorReadiness'
import { proseRoleClass } from './proseRoles'

const RichMarkdownEditor = lazy(async () => {
  const { default: Prism } = await import('prismjs')
  ;(globalThis as typeof globalThis & { Prism: typeof Prism }).Prism = Prism
  const module = await import('./RichMarkdownEditor')
  return { default: module.RichMarkdownEditor }
})

// Canvas cards keep the lightweight renderer mounted until the rich editor has
// focused and the card has restored its scroll position. Both surfaces share a
// grid cell so the handoff cannot change the card's document geometry.
export function MarkdownCardEditor(props: RichMarkdownEditorProps) {
  const [editorReady, setEditorReady] = useState(false)
  const readinessCoordinatorRef = useRef<EditorReadinessCoordinator | null>(null)
  const transitionRef = useRef<HTMLDivElement>(null)
  const [editorSource, setEditorSource] = useState(() => ({
    markdown: props.markdown,
    revision: 0,
  }))
  const graphMarkdownRef = useRef(props.markdown)
  const pendingLocalEchoRef = useRef<string | null>(null)

  // MDXEditor already owns the live document, selection, and undo history.
  // `onChange` writes that document into the Graph immediately, which then
  // echoes the same complete value back through this controlled prop. Keep
  // that acknowledgement out of both Markdown import surfaces: re-importing
  // a giant document would replace the native editor state the user just
  // produced, while rendering its hidden passive twin would do duplicate work.
  // A different Graph value is an external semantic replacement and becomes
  // the editor source normally.
  const graphChanged = props.markdown !== graphMarkdownRef.current
  const isLocalEcho = graphChanged && props.markdown === pendingLocalEchoRef.current
  useLayoutEffect(() => {
    if (!graphChanged) return
    graphMarkdownRef.current = props.markdown
    pendingLocalEchoRef.current = null
    if (!isLocalEcho) {
      setEditorSource((current) => ({
        markdown: props.markdown,
        revision: current.revision + 1,
      }))
    }
  }, [graphChanged, isLocalEcho, props.markdown])
  const renderedText = useMemo(
    () => (editorSource.markdown.trim() ? renderMarkdown(editorSource.markdown) : ''),
    [editorSource.markdown],
  )
  const proseClass = proseRoleClass(props.proseSize)
  const handleChange = useCallback((nextMarkdown: string) => {
    pendingLocalEchoRef.current = nextMarkdown
    props.onChange(nextMarkdown)
  }, [props.onChange])
  const handleBlur = useCallback((nextMarkdown: string) => {
    // MDXEditor reports its initial entity/transport cleanup as normalization,
    // not as a user change. Commit that canonical document on exit so an
    // artifact that was invisible in the editor is actually removed from the
    // Graph. Ordinary local changes already emitted through handleChange and
    // are not written twice, even if their controlled echo has not rendered.
    const graphMarkdown = graphMarkdownRef.current
    if (
      normalizeMarkdownTransport(graphMarkdown) !== graphMarkdown &&
      nextMarkdown !== graphMarkdownRef.current &&
      nextMarkdown !== pendingLocalEchoRef.current
    ) handleChange(nextMarkdown)
    props.onBlur(nextMarkdown)
  }, [handleChange, props.onBlur])
  const handleContentReady = useCallback((preparedEditor?: HTMLElement) => {
    if (!preparedEditor) return
    readinessCoordinatorRef.current?.cancel()
    const createCoordinator = (
      onReady: (editor: HTMLElement) => void,
    ) => createBoundedEditorReadinessCoordinator({
      currentEditor: () => findMarkdownEditor(transitionRef.current),
      prepareEditor: (editor) => focusEditorForFirstIntent(editor, props.focusPoint) !== 'failed',
      requestFrame: window.requestAnimationFrame,
      cancelFrame: window.cancelAnimationFrame,
      now: () => performance.now(),
      onReady,
      onFailure: () => {
        readinessCoordinatorRef.current = null
      },
    })
    const beforeScrollRestore = createCoordinator((stableEditor) => {
      // The card restores its saved scroll position only after the exact editor
      // has stayed ready for a frame. Keep the passive surface visible through
      // that paint and verify the same identity on the following frame.
      props.onContentReady?.()
      const afterScrollRestore = createCoordinator(() => {
        readinessCoordinatorRef.current = null
        setEditorReady(true)
      })
      readinessCoordinatorRef.current = afterScrollRestore
      // Lexical's initial reconciliation may replace the native caret. Resolve
      // the pointer again against the restored viewport before admitting input.
      afterScrollRestore.start(props.focusPoint ? null : stableEditor)
    })
    readinessCoordinatorRef.current = beforeScrollRestore
    beforeScrollRestore.start(preparedEditor)
  }, [props.focusPoint, props.onContentReady])

  useEffect(() => () => {
    readinessCoordinatorRef.current?.cancel()
    readinessCoordinatorRef.current = null
  }, [])

  return (
    <div
      ref={transitionRef}
      className={`markdown-card-editor-transition ${editorReady ? 'ready' : ''}`}
      data-editor-ready={editorReady}
    >
      <div
        className={`markdown-card-editor-placeholder note-render markdown e-prose ${proseClass} nodrag`}
        aria-hidden="true"
      >
        {editorSource.markdown.trim() ? (
          <div dangerouslySetInnerHTML={{ __html: renderedText }} />
        ) : (
          <span className="result-empty">{props.placeholder}</span>
        )}
      </div>
      <Suspense fallback={null}>
        <RichMarkdownEditor
          {...props}
          markdown={editorSource.markdown}
          sourceRevision={editorSource.revision}
          onChange={handleChange}
          onBlur={handleBlur}
          onContentReady={handleContentReady}
        />
      </Suspense>
    </div>
  )
}

export type { EditorFocusPoint } from './RichMarkdownEditor'
