// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeMarkdownTransport, renderMarkdown } from '../../shared/markdown'
import { MarkdownCardEditor } from './MarkdownCardEditor'
import { RichMarkdownEditor } from './RichMarkdownEditor'

const editorBoundary = vi.hoisted(() => ({
  setMarkdown: vi.fn(),
  pluginSetup: vi.fn(),
  mdxRenders: vi.fn(),
}))

vi.mock('../../shared/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/markdown')>()
  return {
    ...actual,
    normalizeMarkdownTransport: vi.fn(actual.normalizeMarkdownTransport),
    renderMarkdown: vi.fn(() => '<p>passive projection</p>'),
  }
})

vi.mock('@mdxeditor/editor', async () => {
  const React = await import('react')
  const createPlugin = () => {
    editorBoundary.pluginSetup()
    return () => ({})
  }
  return {
    MDXEditor: React.forwardRef((props: {
      contentEditableClassName: string
      markdown: string
      onChange: (markdown: string, initialMarkdownNormalize: boolean) => void
      onBlur: () => void
    }, ref) => {
      editorBoundary.mdxRenders()
      const editorElementRef = React.useRef<HTMLDivElement>(null)
      const internalMarkdownRef = React.useRef(props.markdown)
      const [internalLength, setInternalLength] = React.useState(props.markdown.length)
      React.useImperativeHandle(ref, () => ({
        setMarkdown: (markdown: string) => {
          editorBoundary.setMarkdown(markdown)
          internalMarkdownRef.current = markdown
          setInternalLength(markdown.length)
        },
        getMarkdown: () => internalMarkdownRef.current,
        insertMarkdown: vi.fn(),
        focus: (callback?: () => void) => {
          editorElementRef.current?.focus()
          callback?.()
        },
      }))
      return (
        <div>
          <div
            ref={editorElementRef}
            className={props.contentEditableClassName}
            contentEditable
            data-testid="mdx-editor"
            data-source-markdown={props.markdown}
            data-internal-length={internalLength}
            onBlur={props.onBlur}
          />
          <button onClick={() => {
            const nextMarkdown = `${internalMarkdownRef.current}!`
            internalMarkdownRef.current = nextMarkdown
            setInternalLength(nextMarkdown.length)
            props.onChange(nextMarkdown, false)
          }}>
            type locally
          </button>
        </div>
      )
    }),
    codeBlockPlugin: createPlugin,
    createActiveEditorSubscription$: Symbol('createActiveEditorSubscription'),
    createRootEditorSubscription$: Symbol('createRootEditorSubscription'),
    headingsPlugin: createPlugin,
    linkPlugin: createPlugin,
    listsPlugin: createPlugin,
    markdownShortcutPlugin: createPlugin,
    quotePlugin: createPlugin,
    realmPlugin: () => createPlugin,
    tablePlugin: createPlugin,
    thematicBreakPlugin: createPlugin,
    useCodeBlockEditorContext: () => ({ setCode: vi.fn() }),
  }
})

vi.mock('./MarkdownLinkDialog', () => ({
  markdownLinkDialogPlugin: () => {
    editorBoundary.pluginSetup()
    return () => ({})
  },
}))

function editor(markdown: string, key?: string) {
  return (
    <RichMarkdownEditor
      key={key}
      markdown={markdown}
      placeholder="Write"
      ariaLabel="Note body"
      focusPoint={null}
      onChange={vi.fn()}
      onBlur={vi.fn()}
    />
  )
}

const LARGE_MARKDOWN = `start ${'large body '.repeat(60_000)}`

function ControlledEditorHarness() {
  const [graphMarkdown, setGraphMarkdown] = useState(LARGE_MARKDOWN)
  const [blurredMarkdown, setBlurredMarkdown] = useState('')
  return (
    <>
      <output data-testid="graph-length">{graphMarkdown.length}</output>
      <output data-testid="blurred-length">{blurredMarkdown.length}</output>
      <button onClick={() => setGraphMarkdown('external replacement')}>replace externally</button>
      <button onClick={() => setGraphMarkdown(LARGE_MARKDOWN)}>restore initial externally</button>
      <MarkdownCardEditor
        markdown={graphMarkdown}
        placeholder="Write"
        ariaLabel="Note body"
        focusPoint={null}
        onChange={setGraphMarkdown}
        onBlur={(nextMarkdown) => {
          setBlurredMarkdown(nextMarkdown)
          setGraphMarkdown(nextMarkdown)
        }}
      />
    </>
  )
}

describe('Rich Markdown editor Graph reconciliation', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('imports a semantic replacement into the already-mounted editor without re-importing its initial source', () => {
    const rendered = render(editor('initial markdown'))
    expect(editorBoundary.setMarkdown).not.toHaveBeenCalled()

    rendered.rerender(editor('external replacement'))

    expect(editorBoundary.setMarkdown).toHaveBeenCalledTimes(1)
    expect(editorBoundary.setMarkdown).toHaveBeenCalledWith('external replacement')
  })

  it('treats an Idea remount as a fresh editor source instead of an external import', () => {
    const rendered = render(editor('idea one', 'idea-one'))

    rendered.rerender(editor('idea two', 'idea-two'))

    expect(screen.getByTestId('mdx-editor').getAttribute('data-source-markdown')).toBe('idea two')
    expect(editorBoundary.setMarkdown).not.toHaveBeenCalled()
  })

  it('keeps sequential giant local edits inside MDX while updating the Graph and exact blur value', async () => {
    render(<ControlledEditorHarness />)
    const mdxEditor = await screen.findByTestId('mdx-editor')
    expect(mdxEditor.getAttribute('data-source-markdown')).toBe(LARGE_MARKDOWN)
    expect(renderMarkdown).toHaveBeenCalledTimes(1)
    expect(normalizeMarkdownTransport).toHaveBeenCalledTimes(1)
    // The plugin list is built once for the life of the editor. What matters
    // is that it never rebuilds, not how many plugins there happen to be.
    const initialPluginSetupCount = editorBoundary.pluginSetup.mock.calls.length
    expect(initialPluginSetupCount).toBeGreaterThan(0)
    const initialMdxRenderCount = editorBoundary.mdxRenders.mock.calls.length
    expect(initialMdxRenderCount).toBeGreaterThanOrEqual(1)

    fireEvent.click(screen.getByRole('button', { name: 'type locally' }))
    fireEvent.click(screen.getByRole('button', { name: 'type locally' }))

    expect(screen.getByTestId('graph-length').textContent).toBe(String(LARGE_MARKDOWN.length + 2))
    expect(mdxEditor.getAttribute('data-source-markdown')).toBe(LARGE_MARKDOWN)
    expect(mdxEditor.getAttribute('data-internal-length')).toBe(String(LARGE_MARKDOWN.length + 2))
    expect(renderMarkdown).toHaveBeenCalledTimes(1)
    expect(normalizeMarkdownTransport).toHaveBeenCalledTimes(1)
    expect(editorBoundary.pluginSetup).toHaveBeenCalledTimes(initialPluginSetupCount)
    expect(editorBoundary.setMarkdown).not.toHaveBeenCalled()
    expect(editorBoundary.mdxRenders.mock.calls.length).toBeGreaterThan(initialMdxRenderCount)

    fireEvent.click(screen.getByRole('button', { name: 'restore initial externally' }))
    expect(editorBoundary.setMarkdown).toHaveBeenCalledTimes(1)
    expect(editorBoundary.setMarkdown).toHaveBeenCalledWith(LARGE_MARKDOWN)
    expect(mdxEditor.getAttribute('data-internal-length')).toBe(String(LARGE_MARKDOWN.length))
    expect(renderMarkdown).toHaveBeenCalledTimes(1)
    expect(normalizeMarkdownTransport).toHaveBeenCalledTimes(1)

    fireEvent.blur(mdxEditor)
    expect(screen.getByTestId('blurred-length').textContent).toBe(String(LARGE_MARKDOWN.length))
  })

  it('commits transported character-reference cleanup when an otherwise untouched editor closes', async () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()
    render(
      <MarkdownCardEditor
        markdown={'* Before\n* &#x9;\n* After &#8217;'}
        placeholder="Write"
        ariaLabel="Note body"
        focusPoint={null}
        onChange={onChange}
        onBlur={onBlur}
      />,
    )

    fireEvent.blur(await screen.findByTestId('mdx-editor'))

    expect(onChange).toHaveBeenCalledWith('* Before\n\n* After ’')
    expect(onBlur).toHaveBeenCalledWith('* Before\n\n* After ’')
  })

  it('does not rewrite ordinary Markdown solely because the editor normalized its layout', async () => {
    const onChange = vi.fn()
    render(
      <MarkdownCardEditor
        markdown={'First soft line\nSecond soft line'}
        placeholder="Write"
        ariaLabel="Note body"
        focusPoint={null}
        onChange={onChange}
        onBlur={vi.fn()}
      />,
    )

    fireEvent.blur(await screen.findByTestId('mdx-editor'))

    expect(onChange).not.toHaveBeenCalled()
  })
})
