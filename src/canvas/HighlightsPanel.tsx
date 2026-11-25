import { Crosshair, StickyNote, Trash2, X } from 'lucide-react'
import { useMemo, type CSSProperties } from 'react'
import { paletteColor } from '../graph/highlights'
import { cardLabel } from '../graph/graphHelpers'
import { useGraph } from '../graph/store'
import type { Highlight } from '../graph/types'
import { words } from '../shared/words'
import { Badge, IconButton, Tooltip } from '../ui/primitives'
import { useDeleteHighlightTag } from './useDeleteHighlightTag'

// The reading room for everything the user has highlighted: grouped by tag color,
// each entry jumps back to its spot on the board or becomes a linked note card.

export function HighlightsPanel() {
  const open = useGraph((s) => s.highlightsPanelOpen)
  const setOpen = useGraph((s) => s.setHighlightsPanelOpen)
  const highlights = useGraph((s) => s.highlights)
  const tags = useGraph((s) => s.highlightTags)
  const cards = useGraph((s) => s.cards)
  const removeHighlight = useGraph((s) => s.removeHighlight)
  const deleteHighlightTag = useDeleteHighlightTag()
  const requestCardFocus = useGraph((s) => s.requestCardFocus)
  const createNoteFromHighlight = useGraph((s) => s.createNoteFromHighlight)
  const setActiveTool = useGraph((s) => s.setActiveTool)

  const groups = useMemo(() => {
    const byTag = new Map<string, Highlight[]>()
    for (const highlight of highlights) {
      const list = byTag.get(highlight.tagId) ?? []
      list.push(highlight)
      byTag.set(highlight.tagId, list)
    }
    return tags.map((tag) => ({
      tag,
      items: (byTag.get(tag.id) ?? []).slice().reverse(), // newest first
    }))
  }, [highlights, tags])

  if (!open) return null

  const jumpTo = (cardId: string) => {
    setActiveTool('select')
    requestCardFocus(cardId)
    setOpen(false)
  }

  const makeNote = (highlightId: string) => {
    const noteId = createNoteFromHighlight(highlightId)
    if (!noteId) return

    setActiveTool('select')
    requestCardFocus(noteId)
    setOpen(false)
  }

  const sourceLabel = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId)
    return card ? cardLabel(card) : words.highlightSourceGone
  }

  return (
    <aside className="highlights-panel" aria-label={words.highlights}>
      <div className="highlights-head">
        <h2 className="t-title">{words.highlights}</h2>
        <Badge className="highlights-count">{highlights.length}</Badge>
        <IconButton
          className="nodrag highlights-close"
          variant="ghost"
          size="inline"
          onClick={() => setOpen(false)}
          label={words.close}
          icon={<X aria-hidden="true" />}
        />
      </div>

      {highlights.length === 0 ? (
        <div className="highlights-empty">
          <h3 className="t-display">{words.highlightsEmptyTitle}</h3>
          <p className="t-hint">{words.highlightsEmptyHint}</p>
        </div>
      ) : (
        <div className="highlights-groups">
          {groups.map(({ tag, items }) => {
            const color = paletteColor(tag.color)
            return (
              <section
                key={tag.id}
                className="highlights-group"
                style={{ '--tag-bg': color.bg, '--tag-dot': color.swatch } as CSSProperties}
              >
                <header className="highlights-group-head">
                  <span className="tag-dot" aria-hidden="true" />
                  <span className="highlights-group-name t-micro">{tag.name}</span>
                  <Badge className="highlights-group-count">{items.length}</Badge>
                  <IconButton
                    className="highlights-danger-action"
                    variant="ghost"
                    size="inline"
                    onClick={() => void deleteHighlightTag(tag.id, items.length)}
                    label={`${words.deleteHighlightTag}: ${tag.name}`}
                    tooltip={words.deleteHighlightTag}
                    icon={<Trash2 aria-hidden="true" />}
                  />
                </header>

                {items.length === 0 ? (
                  <p className="highlights-group-empty t-hint">{words.highlightTagEmpty}</p>
                ) : (
                  <ul className="highlights-list">
                    {items.map((highlight) => (
                      <li key={highlight.id} className="highlight-row">
                        <Tooltip content={words.highlightGoToCard}>
                          <button className="highlight-row-text" onClick={() => jumpTo(highlight.cardId)}>
                            <span className="highlight-row-quote t-prose-s">{highlight.text}</span>
                            <span className="highlight-row-source t-value">{sourceLabel(highlight.cardId)}</span>
                          </button>
                        </Tooltip>
                        <div className="highlight-row-actions">
                          <IconButton
                            variant="ghost"
                            size="inline"
                            onClick={() => jumpTo(highlight.cardId)}
                            label={words.highlightGoToCard}
                            icon={<Crosshair aria-hidden="true" />}
                          />
                          <IconButton
                            variant="ghost"
                            size="inline"
                            onClick={() => makeNote(highlight.id)}
                            label={words.highlightMakeNote}
                            icon={<StickyNote aria-hidden="true" />}
                          />
                          <IconButton
                            className="highlights-danger-action"
                            variant="ghost"
                            size="inline"
                            onClick={() => removeHighlight(highlight.id)}
                            label={words.highlightRemove}
                            icon={<X aria-hidden="true" />}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </aside>
  )
}
