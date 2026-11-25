import { $isLinkNode } from '@lexical/link'
import {
  activeEditor$,
  addComposerChild$,
  createActiveEditorSubscription$,
  realmPlugin,
} from '@mdxeditor/editor'
import {
  Cell,
  Signal,
  useCellValue,
  usePublisher,
  withLatestFrom,
} from '@mdxeditor/gurx'
import { Pencil, Unlink } from 'lucide-react'
import {
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $isTextNode,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from 'lexical'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useGraph } from '../../graph/store'
import { isSafeMarkdownHref } from '../../shared/markdown'
import { noteLinkPreviews } from '../../shared/linkPreview'
import { words } from '../../shared/words'
import { Field, FieldLabel, IconButton, Popover } from '../../ui/primitives'

type LinkDialogState =
  | { type: 'inactive' }
  | {
      type: 'preview' | 'edit'
      nodeKey: string
      url: string
      title: string
      origin: HTMLAnchorElement
    }

const linkDialogState$ = Cell<LinkDialogState>({ type: 'inactive' })
const editLink$ = Signal()
const closeLinkDialog$ = Signal()
// One half of the link at a time, because the two fields are edited
// separately and an absent half means "leave this one alone".
const applyLink$ = Signal<{
  nodeKey: string
  url?: string
  title?: string
  // Whether this keystroke continues an edit already under way.
  continues: boolean
}>()
const removeLink$ = Signal<{ nodeKey: string; url: string; cardId: string | null }>()

// The Card this link lives in, read from the canvas node the anchor sits
// inside. The Markdown editor is a generic surface that is handed a document
// and never the Card id, so asking the DOM which Card the founder is looking
// at is cheaper and less invasive than threading an id through every editor
// between here and the Note.
function noteCardIdFor(anchor: HTMLElement): string | null {
  return anchor.closest<HTMLElement>('.react-flow__node')?.dataset.id ?? null
}

export const markdownLinkDialogPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, MarkdownLinkDialog)
    realm.pub(createActiveEditorSubscription$, (editor) => editor.registerCommand(
      CLICK_COMMAND,
      (event) => {
        const target = event.target
        if (!(target instanceof Element)) return false
        const anchor = target.closest<HTMLAnchorElement>('a')
        if (!anchor) return false
        const nearestNode = $getNearestNodeFromDOMNode(anchor)
        const linkNode = $isLinkNode(nearestNode)
          ? nearestNode
          : nearestNode && $isLinkNode(nearestNode.getParent())
            ? nearestNode.getParent()
            : null
        if (!linkNode || !$isLinkNode(linkNode)) return false
        event.preventDefault()
        event.stopPropagation()
        // Contenteditable descendants are not consistently programmatically
        // focusable across browsers. Keep the real link out of the tab order
        // while making it a stable focus-return target for the dialog.
        anchor.tabIndex = -1
        realm.pub(linkDialogState$, {
          type: 'preview',
          nodeKey: linkNode.getKey(),
          url: linkNode.getURL(),
          title: linkNode.getTextContent(),
          origin: anchor,
        })
        return true
      },
      COMMAND_PRIORITY_HIGH,
    ))

    realm.sub(editLink$, () => {
      const state = realm.getValue(linkDialogState$)
      if (state.type === 'preview') realm.pub(linkDialogState$, { ...state, type: 'edit' })
    })
    // Closing hands the writer back to their Note. Escape has already returned
    // focus to the link itself; a click outside the dialog has returned it
    // nowhere, and an editor nobody is focused on stops reporting the blur the
    // Note reads as "the writer is done".
    realm.sub(
      realm.pipe(closeLinkDialog$, withLatestFrom(activeEditor$)),
      ([, editor]) => {
        realm.pub(linkDialogState$, { type: 'inactive' })
        const root = editor?.getRootElement()
        if (root && !root.contains(document.activeElement)) editor?.focus()
      },
    )
    realm.sub(
      realm.pipe(applyLink$, withLatestFrom(activeEditor$)),
      ([change, editor]) => {
        // Where the founder is typing. A discrete update reconciles the
        // editor's own selection back onto the document, which pulled focus out
        // of the field mid-word and sent the rest of the address into the
        // Note's prose. The link's selection is dropped for the same reason,
        // and focus is handed back to whatever the founder was using.
        const typingIn = document.activeElement
        editor?.update(
          () => {
            const node = $getNodeByKey(change.nodeKey)
            if (!$isLinkNode(node)) return
            if (change.url !== undefined) node.setURL(change.url.trim())
            if (change.title !== undefined) {
              // The title is the link's own text, so writing it must leave the
              // node holding exactly the words the founder typed. Reusing the
              // first text child rather than rebuilding the node keeps any
              // formatting the writer had already applied to those words.
              const [first, ...rest] = node.getChildren()
              if ($isTextNode(first)) {
                first.setTextContent(change.title)
                for (const extra of rest) extra.remove()
              } else {
                for (const child of node.getChildren()) child.remove()
                node.append($createTextNode(change.title))
              }
            }
            $setSelection(null)
          },
          // Every keystroke is its own editor update, so without a tag a
          // founder who retyped an address would need thirty undos to get back
          // to it. The first keystroke of an edit opens one undo entry and
          // every keystroke after it folds into that entry, which is what
          // typing into the body already does.
          {
            discrete: true,
            tag: change.continues ? 'history-merge' : 'history-push',
          },
        )
        if (typingIn instanceof HTMLElement
          && typingIn.isConnected
          && document.activeElement !== typingIn) {
          typingIn.focus({ preventScroll: true })
        }
        const state = realm.getValue(linkDialogState$)
        if (state.type !== 'inactive' && state.nodeKey === change.nodeKey) {
          realm.pub(linkDialogState$, {
            ...state,
            url: change.url ?? state.url,
            title: change.title ?? state.title,
          })
        }
      },
    )
    realm.sub(
      realm.pipe(removeLink$, withLatestFrom(activeEditor$)),
      ([request, editor]) => {
        editor?.update(() => {
          const node = $getNodeByKey(request.nodeKey)
          if (!$isLinkNode(node)) return
          // WHAT "REMOVE LINK" MEANS. The address stops being part of this
          // Note. Unwrapping the anchor and keeping its words is right when the
          // words are prose, but a link whose words ARE its address has no
          // prose to keep: leaving that text behind left a bare address that
          // the passive render relinked and the preview scanner refetched, so
          // the founder pressed Remove link and watched the link and its
          // preview come straight back.
          const keepsWords = node.getTextContent().trim() !== node.getURL().trim()
          if (keepsWords) for (const child of node.getChildren()) node.insertBefore(child)
          node.remove()
        }, { discrete: true })
        // The tile that address already grew goes with it, so the action the
        // founder took is the state they see. A tile is only asked for when one
        // exists: the unnamed removal is the X's own gesture and would take the
        // local HTML preview with it. Nothing needs to be remembered as
        // dismissed, because the address is no longer in the body at all and
        // the generator reads the body.
        const cardId = request.cardId
        if (cardId) {
          const graph = useGraph.getState()
          const card = graph.cards.find((candidate) => candidate.id === cardId)
          if (noteLinkPreviews(card).some((preview) => preview.url === request.url)) {
            graph.removeNotePreview(cardId, request.url)
          }
        }
        realm.pub(linkDialogState$, { type: 'inactive' })
        editor?.focus()
      },
    )
  },
})

type AnchorRectangle = { top: number; left: number; width: number; height: number }

function sameRectangle(a: AnchorRectangle, b: AnchorRectangle): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

// The link's live screen geometry, not a snapshot of it. The Board can pan,
// zoom, or reflow the Note under an open dialog, and none of those move the
// anchor in a way a scroll or resize listener would report, so the rectangle is
// read once a frame and published only when it actually changed.
function useAnchorRectangle(anchor: HTMLAnchorElement | null): AnchorRectangle | null {
  const [rectangle, setRectangle] = useState<AnchorRectangle | null>(null)

  useEffect(() => {
    if (!anchor) {
      setRectangle(null)
      return
    }
    let frame = 0
    const follow = () => {
      const bounds = anchor.getBoundingClientRect()
      const next = {
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
      }
      setRectangle((current) => (current && sameRectangle(current, next) ? current : next))
      frame = window.requestAnimationFrame(follow)
    }
    follow()
    return () => window.cancelAnimationFrame(frame)
  }, [anchor])

  return rectangle
}

function MarkdownLinkDialog() {
  const state = useCellValue(linkDialogState$)
  const close = usePublisher(closeLinkDialog$)
  const anchor = state.type === 'inactive' ? null : state.origin
  const rectangle = useAnchorRectangle(anchor)
  // Escape hands the writer back to where they were. Editing the title
  // rebuilds the link's text, and a Board reflow can replace the anchor
  // outright, so the target is resolved when focus is actually returned and
  // falls back to the body the link belongs to.
  const returnFocusRef = useMemo(() => ({
    get current(): HTMLElement | null {
      if (!anchor) return null
      if (anchor.isConnected) return anchor
      return anchor.closest<HTMLElement>('.react-flow__node')
        ?.querySelector<HTMLElement>('[contenteditable="true"]') ?? null
    },
  }), [anchor])

  if (state.type === 'inactive' || !rectangle || typeof document === 'undefined') return <></>

  // The whole dialog leaves the composer for the document body. Its trigger is
  // positioned in viewport coordinates, and the composer sits inside React
  // Flow's transformed viewport, where `position: fixed` resolves against that
  // transform instead of the window: the surface then landed offset and scaled
  // by the Board's zoom, sometimes off screen entirely. Portalling keeps the
  // React tree - and so the realm this dialog publishes through - intact.
  return createPortal(
    <Popover
      open
      dismissOnTab={false}
      ariaHasPopup="dialog"
      returnFocusRef={returnFocusRef}
      onOpenChange={(open) => {
        if (!open) close(undefined)
      }}
      trigger={(
        <span
          className="e-markdown-link-dialog__anchor"
          style={{
            top: rectangle.top,
            left: rectangle.left,
            width: rectangle.width,
            height: rectangle.height,
          }}
        />
      )}
    >
      <div
        className="e-markdown-link-dialog"
        data-markdown-link-dialog=""
        role="dialog"
        aria-label={words.linkDialog}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {state.type === 'preview'
          ? <MarkdownLinkPreview state={state} />
          : <MarkdownLinkEditForm state={state} />}
      </div>
    </Popover>,
    document.body,
  )
}

function MarkdownLinkPreview({ state }: {
  state: Exclude<LinkDialogState, { type: 'inactive' }>
}) {
  const edit = usePublisher(editLink$)
  const remove = usePublisher(removeLink$)

  return (
    <>
      <a
        className="e-markdown-link-dialog__destination t-ui"
        href={state.url}
        target="_blank"
      >
        {state.url}
      </a>
      <div className="e-markdown-link-dialog__actions-inline">
        <IconButton
          label={words.editLink}
          icon={<Pencil />}
          onClick={() => edit(undefined)}
        />
        <IconButton
          label={words.removeLink}
          icon={<Unlink />}
          onClick={() => remove({
            nodeKey: state.nodeKey,
            url: state.url,
            cardId: noteCardIdFor(state.origin),
          })}
        />
      </div>
    </>
  )
}

// The form IS the link: what it holds is what the body holds, applied as the
// founder types. There is no Save because there is nothing to defer, and no
// Cancel because there is no pending state to throw away; Escape simply
// closes. The one thing that is never applied is an address Eido would refuse
// to render, so an unsafe scheme is reported here and the body keeps the last
// address that was safe.
function MarkdownLinkEditForm({ state }: {
  state: Exclude<LinkDialogState, { type: 'inactive' }>
}) {
  const apply = usePublisher(applyLink$)
  const titleRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(state.title)
  const [url, setUrl] = useState(state.url)
  const [urlRefused, setUrlRefused] = useState(false)
  // One undo entry per visit to this form, opened by its first applied change.
  const editUnderWay = useRef(false)
  const applyChange = (change: { url?: string; title?: string }) => {
    apply({ nodeKey: state.nodeKey, ...change, continues: editUnderWay.current })
    editUnderWay.current = true
  }

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
    titleRef.current?.select()
  }, [])

  return (
    <form
      className="e-markdown-link-dialog__form"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="e-markdown-link-dialog__field">
        <FieldLabel htmlFor="markdown-link-title">
          {words.linkTitle}
        </FieldLabel>
        <Field
          ref={titleRef}
          id="markdown-link-title"
          value={title}
          onChange={(event) => {
            const next = event.currentTarget.value
            setTitle(next)
            // A link with no words is not a link the reader can see, so an
            // emptied field is a title still being typed, not a title of none.
            if (next.trim()) applyChange({ title: next })
          }}
        />
      </div>
      <div className="e-markdown-link-dialog__field">
        <FieldLabel htmlFor="markdown-link-url">
          {words.linkUrl}
        </FieldLabel>
        <Field
          id="markdown-link-url"
          value={url}
          aria-invalid={urlRefused || undefined}
          aria-describedby={urlRefused ? 'markdown-link-url-message' : undefined}
          onChange={(event) => {
            const input = event.currentTarget
            const next = input.value
            setUrl(next)
            const safe = isSafeMarkdownHref(next)
            input.setCustomValidity(safe ? '' : words.unsupportedLink)
            setUrlRefused(!safe)
            if (safe) applyChange({ url: next })
          }}
        />
      </div>
      {urlRefused ? (
        <p
          className="e-markdown-link-dialog__message t-micro"
          id="markdown-link-url-message"
          role="alert"
        >
          {words.unsupportedLink}
        </p>
      ) : null}
    </form>
  )
}
