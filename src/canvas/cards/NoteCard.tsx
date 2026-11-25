import type { NodeProps } from '@xyflow/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { canEditSelectedCard, highlightableTextDragBlockingClass, useRelativeScrollPosition, useWheelGate } from '../cardInteraction'
import { followCardTextLink } from '../cardLinks'
import { useGraph } from '../../graph/store'
import { cardTextFromBlocks, textHasContent } from '../../graph/graphHelpers'
import { assetsFromClipboard, clipboardHasSupportedAssets } from '../../shared/clipboardAssets'
import {
  linkPreviewAttempted,
  linkPreviewDismissed,
  LINK_PREVIEW_MAX_PER_NOTE,
  noteLinkPreviews,
  webUrlsInText,
} from '../../shared/linkPreview'
import { renderMarkdown } from '../../shared/markdown'
import { markdownPreviewText } from '../../shared/markdownPreview'
import { words } from '../../shared/words'
import { displayHost } from '../../shared/webUrl'
import { CardFileAttachments, CardImagePanel } from './CardAssets'
import { cardImageRenditionPlan } from './cardImageRenditionPolicy'
import type { AttachmentPanelKind } from '../../graph/attachmentPanelGrowth'
import { CardShell } from './CardShell'
import { NotePreviewPanel } from './NotePreviewPanel'
import { MarkdownCardEditor, type EditorFocusPoint } from './MarkdownCardEditor'
import {
  armCardPointerEditIntent,
  consumeCardEditIntent,
  subscribeToCardEditIntent,
} from './cardEditIntent'
import { noteFontSizeOf } from '../../graph/noteFontSize'
import { proseRoleClass } from './proseRoles'
import { useCardHighlights } from './useCardHighlights'

// A typing burst settles this long before the body's first url is treated as
// final and a preview fetch starts.
const NOTE_LINK_PREVIEW_DEBOUNCE_MS = 600

export function NoteCard({ id, selected, data }: NodeProps) {
  const card = useGraph(useShallow((s) => {
    const found = s.graph().cardById(id)
    return {
      exists: Boolean(found),
      blocks: found?.blocks,
      fixedHeight: Boolean(found?.size?.height),
      fontSize: noteFontSizeOf(found),
      source: found?.source,
      assets: found?.assets,
      linkPreview: found?.linkPreview,
      meta: found?.meta,
      localHtmlPreview: found?.localHtmlPreview,
    }
  }))
  const setCardText = useGraph((s) => s.setCardText)
  const ensureNoteLinkPreview = useGraph((s) => s.ensureNoteLinkPreview)
  const recordCardContentEdited = useGraph((s) => s.recordCardContentEdited)
  const addCardAssets = useGraph((s) => s.addCardAssets)
  const removeCardAsset = useGraph((s) => s.removeCardAsset)
  const activeTool = useGraph((s) => s.activeTool)
  const growCardForAttachmentPanels = useGraph((s) => s.growCardForAttachmentPanels)
  const fixedHeight = card.fixedHeight

  const [editing, setEditing] = useState(false)
  const [editIntentVersion, setEditIntentVersion] = useState(0)
  const editingRef = useRef(false)
  const editFocusPointRef = useRef<EditorFocusPoint>(null)
  const pointerFocusRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const editStartTextRef = useRef('')
  const renderRef = useRef<HTMLDivElement | null>(null)
  const currentIdeaId = useGraph((s) => s.currentIdeaId)
  const text = card.blocks ? cardTextFromBlocks(card.blocks) : ''
  // An auto-height Note must keep one geometry whether passive or editable;
  // truncating it would make editor entry expand the Card at the screen edge.
  // A fixed-height Note keeps a bounded passive preview. Entering the editor
  // already mounts the full source, so expanding the hidden preview too would
  // parse the same million-character body twice during that click.
  const passiveText = useMemo(() => {
    // The editor transition owns its own exact placeholder during activation.
    // Once Live editing begins this passive Note subtree is unmounted, so keep
    // Graph echoes from parsing a second, hidden copy of the complete body.
    if (editing) return ''
    return fixedHeight ? markdownPreviewText(text, false, fixedHeight) : text
  }, [editing, fixedHeight, text])
  const hasPassiveText = useMemo(() => textHasContent(passiveText), [passiveText])
  const renderedPassiveText = useMemo(
    () => (hasPassiveText ? renderMarkdown(passiveText) : ''),
    [hasPassiveText, passiveText],
  )
  const canEdit = canEditSelectedCard({ activeTool, data, selected: !!selected })
  // A passive Note's own text is truncated to fit, so it never used to need a
  // scroll owner outside editing. An appended Link Preview breaks that: it can
  // push a selected-but-passive body past the Card's bottom edge, so the gate
  // must claim the wheel there too (matching ResultCard/ConversationResultCard,
  // whose passive bodies can already overflow). shouldCaptureWheel still only
  // takes the gesture when the body actually has room left to scroll.
  const bodyWheelGate = useWheelGate(!!selected, bodyRef)
  const { rememberScrollPosition, restoreScrollPosition } = useRelativeScrollPosition(
    currentIdeaId,
    id,
    bodyRef,
  )

  // Repaint when the passive render returns (editing ends) or its text changes.
  useCardHighlights(id, renderRef, editing ? null : renderedPassiveText)

  // The Note's own body drives preview generation, not only the bare-URL
  // paste path: prose with a link, a typed link, or a paste into a Note that
  // already has content all resolve to "the http(s) links this body carries".
  // A body with several links grows a tile for each, in body order, up to the
  // per-Note cap. Debounced so a typing burst settles once before the fetches
  // kick off.
  //
  // Two things keep this from spending the founder's network on every Board
  // they open, both read from the Note's meta bag: the url they explicitly
  // removed with the X never grows straight back, and a url that has already
  // had its one attempt never gets another on the next mount, reload, or
  // Board visit. The kickoff also checks the founder is still on this Board,
  // because a debounce that outlives the Board it was armed on belongs to
  // nothing.
  useEffect(() => {
    if (card.localHtmlPreview) return
    const shown = noteLinkPreviews(card)
    if (shown.length >= LINK_PREVIEW_MAX_PER_NOTE) return
    // The scan itself waits for the debounce, not just the fetch. Reading the
    // links out of the body means stripping its code spans and fences and then
    // running the url pattern over what is left, which is work proportional to
    // the whole Note; doing that before the timer meant every keystroke in a
    // long Note paid for a scan whose answer was thrown away by the next
    // keystroke. Once per settled burst is enough, because nothing acts on the
    // answer until then.
    const timer = window.setTimeout(
      () => {
        if (useGraph.getState().currentIdeaId !== currentIdeaId) return
        const pending = webUrlsInText(text)
          .filter((url) => !shown.some((preview) => preview.url === url))
          .filter((url) => !linkPreviewDismissed(card, url))
          .filter((url) => !linkPreviewAttempted(card, url))
          .slice(0, LINK_PREVIEW_MAX_PER_NOTE - shown.length)
        for (const url of pending) ensureNoteLinkPreview(id, url)
      },
      NOTE_LINK_PREVIEW_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
    // `card` is the shallow-compared selection above, so its identity changes
    // only when one of the fields this effect reads actually changed.
  }, [card, currentIdeaId, ensureNoteLinkPreview, id, text])

  // Which attachment panels this Note is actually showing right now. Read the
  // same two conditions the panels themselves render on, so "the panel is on
  // screen" and "the Card was paid for the panel" can never drift apart: the
  // images panel appears when the rendition plan finds an image among the
  // ordinary assets, the previews panel when there is a link preview or a local
  // HTML preview to carry.
  // Joined to a string, not left as an array, so the effect below re-runs when
  // the SET of panels changes rather than on every keystroke: the selection
  // this reads from gets a new identity on every edit to the Note.
  const presentPanels = useMemo<string>(() => {
    const previewAssetId = card.localHtmlPreview?.assetId
    const ordinary = (card.assets ?? []).filter((asset) => asset.id !== previewAssetId)
    const panels: AttachmentPanelKind[] = []
    if (cardImageRenditionPlan(ordinary).images.length) panels.push('images')
    if (noteLinkPreviews(card).length || card.localHtmlPreview) panels.push('previews')
    return panels.join(',')
  }, [card])

  // A panel is pinned to the bottom of the Card, so it takes its height out of
  // the Note body unless the Card grows to pay for it. This asks for that
  // growth every time the set of panels changes; the store grants it at most
  // once per panel per Card, from a marker in the Card's own settings envelope,
  // so a reload, an undo, or a re-render of a Note that already has previews
  // asks and is refused. See `attachmentPanelGrowth.ts`.
  //
  // The first pass is the one exception, and it is what keeps opening a Board
  // from rearranging it: panels the Note ALREADY had when it mounted are
  // recorded as paid without a resize, because that Card's height is one the
  // founder has already seen and may have set themselves. Only a panel that
  // appears afterwards -- the link preview that just resolved, the image that
  // was just pasted -- is one the founder watched take room from the body, and
  // only that one buys height.
  const panelsSeenOnce = useRef(false)
  useEffect(() => {
    const how = panelsSeenOnce.current ? 'arrived' : 'already-there'
    panelsSeenOnce.current = true
    if (!presentPanels) return
    growCardForAttachmentPanels(id, presentPanels.split(',') as AttachmentPanelKind[], how)
  }, [growCardForAttachmentPanels, id, presentPanels])

  function beginEditing(focusPoint: EditorFocusPoint) {
    if (editingRef.current) return
    editingRef.current = true
    editFocusPointRef.current = focusPoint
    rememberScrollPosition()
    editStartTextRef.current = text
    setEditing(true)
  }

  function startEditing(focusPoint: EditorFocusPoint = null) {
    if (activeTool !== 'select') return
    if (!canEdit || editingRef.current) return
    // A selected Note's pointerup publishes before its click. The click owns
    // the direct begin, so consume that handoff instead of leaving it able to
    // reopen a rapidly remounted Note.
    const pointerIntent = consumeCardEditIntent(currentIdeaId, id)
    if (focusPoint && pointerIntent === undefined) return
    beginEditing(pointerIntent ?? focusPoint)
  }

  function armPointerEditIntent(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target
    if (
      e.button !== 0 ||
      e.shiftKey ||
      e.metaKey ||
      e.ctrlKey ||
      activeTool !== 'select' ||
      (target instanceof Element && target.closest('a'))
    ) {
      return
    }
    pointerFocusRef.current = true
    armCardPointerEditIntent({
      ideaId: currentIdeaId,
      cardId: id,
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      onClear: e.pointerType === 'mouse'
        ? () => { pointerFocusRef.current = false }
        : undefined,
    })
  }

  function commitTextEdit(nextText: string) {
    if (nextText !== editStartTextRef.current) recordCardContentEdited(id)
    editStartTextRef.current = nextText
  }

  function finishEditing(nextText: string) {
    if (!editingRef.current) return
    editingRef.current = false
    rememberScrollPosition()
    commitTextEdit(nextText)
    setEditing(false)
  }

  useLayoutEffect(() => {
    if (canEdit && !editing) {
      const focusPoint = consumeCardEditIntent(currentIdeaId, id)
      if (focusPoint !== undefined) {
        beginEditing(focusPoint)
        return
      }
    }
    if (activeTool !== 'select' && editing) finishEditing(text)
  }, [activeTool, canEdit, currentIdeaId, editIntentVersion, editing, id, text])

  useLayoutEffect(() => subscribeToCardEditIntent(
    currentIdeaId,
    id,
    () => setEditIntentVersion((version) => version + 1),
  ), [currentIdeaId, id])

  useLayoutEffect(() => {
    restoreScrollPosition()
  }, [editing, restoreScrollPosition])

  if (!card.exists) return null
  const fontStep = card.fontSize
  const previewAssetId = card.localHtmlPreview?.assetId
  const ordinaryAssets = (card.assets ?? []).filter((asset) => asset.id !== previewAssetId)

  const removeAsset = (assetId: string) => {
    removeCardAsset(id, assetId)
    recordCardContentEdited(id)
  }

  const onPasteAssets = async (e: React.ClipboardEvent) => {
    if (!clipboardHasSupportedAssets(e)) return
    e.preventDefault()
    const assets = await assetsFromClipboard(e)
    if (!assets.length) return
    addCardAssets(id, assets)
    recordCardContentEdited(id)
  }

  return (
    <CardShell
      id={id}
      kind="note"
      selected={!!selected}
      data={data}
    >
      <div
        className={`card-body note-body note-font-${fontStep} ${editing ? 'editing' : ''}`}
        ref={bodyWheelGate}
        onScroll={rememberScrollPosition}
        onPaste={onPasteAssets}
      >
        {/* Where this Note came from, if it came from the web. Provenance, not
            content: it stays put while the text is edited, because editing the
            text does not change where it was read from. */}
        {card.source ? (
          <div className="card-meta t-micro">
            <span className="web-source-chip" title={card.source.url}>
              {words.webSource}: {displayHost(card.source.url)}
            </span>
          </div>
        ) : null}
        {editing ? (
          <MarkdownCardEditor
            ariaLabel="Note body"
            placeholder={words.notePlaceholder}
            markdown={text}
            proseSize={fontStep}
            focusPoint={editFocusPointRef.current}
            onBlur={finishEditing}
            onChange={(nextText) => setCardText(id, nextText)}
            onContentReady={restoreScrollPosition}
          />
        ) : (
          <div
            ref={renderRef}
            className={`note-render markdown e-prose ${proseRoleClass(fontStep)} ${
              highlightableTextDragBlockingClass(activeTool, !!selected)
            }`}
            tabIndex={0}
            role="textbox"
            aria-label="Note body"
            onPointerDown={armPointerEditIntent}
            onClick={(e) => {
              if (followCardTextLink(e)) return
              startEditing({ x: e.clientX, y: e.clientY })
            }}
            onFocus={(e) => {
              if (pointerFocusRef.current) {
                pointerFocusRef.current = false
                return
              }
              const target = e.target
              if (target instanceof Element && target.closest('a')) return
              startEditing()
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              startEditing()
            }}
          >
            {hasPassiveText ? (
              <div dangerouslySetInnerHTML={{ __html: renderedPassiveText }} />
            ) : (
              <span className="result-empty">{words.notePlaceholder}</span>
            )}
          </div>
        )}
        <CardFileAttachments
          assets={ordinaryAssets}
          selected={!!selected}
          onRemove={removeAsset}
        />
      </div>
      {/* Attachments are pinned below the body, not flowed through it, so the
          Note's own text keeps the whole scrolling body and neither panel can
          be pushed off the bottom edge of the Card. Each panel appears only
          when it has something to carry. */}
      <CardImagePanel
        assets={ordinaryAssets}
        selected={!!selected}
        onRemove={removeAsset}
      />
      <NotePreviewPanel
        cardId={id}
        selected={!!selected}
        linkPreviews={noteLinkPreviews(card)}
        localHtmlPreview={card.localHtmlPreview}
        assets={card.assets ?? []}
      />
    </CardShell>
  )
}
