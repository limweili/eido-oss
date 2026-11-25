import { ArrowLeft, Check, ChevronUp, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { HIGHLIGHT_PALETTE, nextTagColor, paletteColor } from '../graph/highlights'
import { useGraph } from '../graph/store'
import type { HighlightTag } from '../graph/types'
import { words } from '../shared/words'
import { Button, ColourPicker, Field, IconButton, Menu, MenuItem, Popover } from '../ui/primitives'
import { useDeleteHighlightTag } from './useDeleteHighlightTag'

const HIGHLIGHT_PALETTE_LABELS: Record<string, string> = {
  yellow: words.highlightColorYellow,
  green: words.highlightColorGreen,
  blue: words.highlightColorBlue,
  pink: words.highlightColorPink,
  orange: words.highlightColorOrange,
  purple: words.highlightColorPurple,
  teal: words.highlightColorTeal,
  red: words.highlightColorRed,
  brown: words.highlightColorBrown,
  gray: words.highlightColorGray,
}

const HIGHLIGHT_COLOUR_OPTIONS = HIGHLIGHT_PALETTE.map((colour) => ({
  value: colour.id,
  label: HIGHLIGHT_PALETTE_LABELS[colour.id],
  swatch: colour.swatch,
}))

// The highlighter's pen bar: while the tool is active, a compact chip shows the
// tag the pen paints with. Clicking it opens the tag menu — search or create at
// the top, one row per tag, and a drill-in page per tag for rename, color, and
// delete. The one-line how-to only appears until the first highlight exists.

export function HighlighterTray() {
  const tags = useGraph((s) => s.highlightTags)
  const activeTagId = useGraph((s) => s.activeHighlightTagId)
  const hasHighlights = useGraph((s) => s.highlights.length > 0)
  const [menuOpen, setMenuOpen] = useState(false)

  const activeTag = tags.find((tag) => tag.id === activeTagId) ?? tags[0]
  const chipColor = activeTag ? paletteColor(activeTag.color) : undefined

  return (
    <div className="highlighter-pen-bar">
      {!hasHighlights && <div className="highlighter-howto t-hint">{words.highlightHowTo}</div>}
      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        dismissOnTab={false}
        trigger={
          <Button
            className="pen-tag-chip"
            variant="quiet"
            size="compact"
            style={chipColor ? ({ '--tag-bg': chipColor.bg, '--tag-dot': chipColor.swatch } as CSSProperties) : undefined}
          >
            <span className="tag-dot" aria-hidden="true" />
            <span className="tag-name t-value">{activeTag ? activeTag.name : words.highlightPickTag}</span>
            <ChevronUp aria-hidden="true" className="pen-tag-chevron" />
          </Button>
        }
      >
        <TagMenu tags={tags} activeTagId={activeTag?.id ?? null} onClose={() => setMenuOpen(false)} />
      </Popover>
    </div>
  )
}

function TagMenu({
  tags,
  activeTagId,
  onClose,
}: {
  tags: HighlightTag[]
  activeTagId: string | null
  onClose: () => void
}) {
  const [manageTagId, setManageTagId] = useState<string | null>(null)
  const [returnFocusTagId, setReturnFocusTagId] = useState<string | null>(null)
  const managed = tags.find((tag) => tag.id === manageTagId)

  const openTagOptions = (tagId: string) => {
    setReturnFocusTagId(null)
    setManageTagId(tagId)
  }

  const closeTagOptions = () => {
    setReturnFocusTagId(managed?.id ?? null)
    setManageTagId(null)
  }

  return (
    <Menu className="tag-menu" ariaLabel={words.highlightTags}>
      {managed ? (
        <TagManagePage tag={managed} onBack={closeTagOptions} onClose={onClose} />
      ) : (
        <TagListPage
          tags={tags}
          activeTagId={activeTagId}
          focusOptionsTagId={returnFocusTagId}
          onManage={openTagOptions}
          onClose={onClose}
        />
      )}
    </Menu>
  )
}

function TagListPage({
  tags,
  activeTagId,
  focusOptionsTagId,
  onManage,
  onClose,
}: {
  tags: HighlightTag[]
  activeTagId: string | null
  focusOptionsTagId: string | null
  onManage: (id: string) => void
  onClose: () => void
}) {
  const setActiveHighlightTag = useGraph((s) => s.setActiveHighlightTag)
  const createHighlightTag = useGraph((s) => s.createHighlightTag)
  const [query, setQuery] = useState('')
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)

  useLayoutEffect(() => {
    if (focusOptionsTagId) returnFocusRef.current?.focus()
  }, [focusOptionsTagId])

  const trimmed = query.trim()
  const lower = trimmed.toLowerCase()
  const visibleTags = lower ? tags.filter((tag) => tag.name.toLowerCase().includes(lower)) : tags
  const exactMatch = tags.find((tag) => tag.name.trim().toLowerCase() === lower)
  const nextColor = paletteColor(nextTagColor(tags))

  const pick = (id: string) => {
    setActiveHighlightTag(id)
    onClose()
  }

  const submit = () => {
    if (!trimmed) return
    if (exactMatch) {
      pick(exactMatch.id)
      return
    }
    createHighlightTag(trimmed)
    onClose()
  }

  return (
    <>
      <Field
        className="tag-menu-search"
        data-menu-roving-handoff="arrow-down"
        autoFocus
        value={query}
        placeholder={words.highlightTagPlaceholder}
        aria-label={words.highlightTagPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="tag-menu-list">
        {visibleTags.map((tag) => {
          const color = paletteColor(tag.color)
          const active = tag.id === activeTagId
          return (
            <div key={tag.id} className={`tag-menu-row ${active ? 'active' : ''}`}>
              <MenuItem
                className="tag-menu-pick"
                aria-current={active || undefined}
                style={{ '--tag-bg': color.bg, '--tag-dot': color.swatch } as CSSProperties}
                onClick={() => pick(tag.id)}
              >
                <span className="tag-dot" aria-hidden="true" />
                <span className="tag-name">{tag.name}</span>
                {active && <Check size={13} strokeWidth={2.2} aria-hidden="true" />}
              </MenuItem>
              <IconButton
                ref={tag.id === focusOptionsTagId ? returnFocusRef : undefined}
                className="tag-menu-more"
                variant="ghost"
                size="inline"
                role="menuitem"
                tabIndex={-1}
                label={`${words.highlightTagOptions}: ${tag.name}`}
                tooltip={words.highlightTagOptions}
                icon={<MoreHorizontal aria-hidden="true" />}
                onClick={() => onManage(tag.id)}
              />
            </div>
          )
        })}
        {trimmed && !exactMatch && (
          <MenuItem
            className="tag-menu-create"
            aria-label={`${words.highlightTagCreate} ${trimmed}`}
            style={{ '--tag-bg': nextColor.bg, '--tag-dot': nextColor.swatch } as CSSProperties}
            onClick={submit}
          >
            <Plus aria-hidden="true" />
            <span>{words.highlightTagCreate}</span>
            <span className="tag-menu-create-chip">
              <span className="tag-dot" aria-hidden="true" />
              <span className="tag-name">{trimmed}</span>
            </span>
          </MenuItem>
        )}
        {tags.length === 0 && !trimmed && (
          <div className="tag-menu-empty t-hint">{words.highlightNoTagsHint}</div>
        )}
      </div>
      <div className="tag-menu-foot t-hint">{words.highlightHowTo}</div>
    </>
  )
}

function TagManagePage({
  tag,
  onBack,
  onClose,
}: {
  tag: HighlightTag
  onBack: () => void
  onClose: () => void
}) {
  const renameHighlightTag = useGraph((s) => s.renameHighlightTag)
  const setHighlightTagColor = useGraph((s) => s.setHighlightTagColor)
  const deleteHighlightTag = useDeleteHighlightTag()
  const taggedCount = useGraph((s) => s.highlights.filter((h) => h.tagId === tag.id).length)
  const [nameDraft, setNameDraft] = useState(tag.name)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const selectedColorId = paletteColor(tag.color).id

  useLayoutEffect(() => {
    nameRef.current?.focus()
  }, [])

  const commitName = () => renameHighlightTag(tag.id, nameDraft)

  const onDelete = async () => {
    if (await deleteHighlightTag(tag.id, taggedCount)) onClose()
  }

  return (
    <>
      <div className="tag-manage-head">
        <IconButton
          className="tag-manage-back"
          variant="ghost"
          size="inline"
          role="menuitem"
          label={words.highlightTagBack}
          icon={<ArrowLeft aria-hidden="true" />}
          onClick={onBack}
        />
        <span className="tag-manage-title t-micro">{words.highlightTagOptions}</span>
      </div>
      <Field
        ref={nameRef}
        className="tag-menu-search tag-manage-name"
        value={nameDraft}
        aria-label={words.highlightTagName}
        onChange={(event) => setNameDraft(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitName()
            onBack()
          }
        }}
      />
      <div className="tag-manage-label t-label">{words.highlightTagColor}</div>
      <ColourPicker
        ariaLabel={words.highlightTagColor}
        value={selectedColorId}
        options={HIGHLIGHT_COLOUR_OPTIONS}
        onValueChange={(colour) => setHighlightTagColor(tag.id, colour)}
      />
      <MenuItem danger className="tag-manage-delete" tabIndex={0} onClick={() => void onDelete()}>
        <Trash2 aria-hidden="true" />
        <span>{words.deleteHighlightTag}</span>
        {taggedCount > 0 && <span className="tag-manage-count t-value">{taggedCount}</span>}
      </MenuItem>
    </>
  )
}
