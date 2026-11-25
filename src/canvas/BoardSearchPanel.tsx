import { X } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  createBoardSearchIndex,
  searchBoardIndex,
  type SemanticBoard,
} from '../graph/boardSemantics'
import type { CardCreatorFilter } from '../graph/cardAuthorship'
import { words } from '../shared/words'
import {
  Badge,
  Button,
  Field,
  FieldLabel,
  IconButton,
  Segmented,
  type SegmentedOption,
} from '../ui/primitives'
import { BOARD_SEARCH_PANEL_METRICS } from '../ui/tokens'

export const BOARD_SEARCH_PAGE_SIZE = 24

const CREATOR_FILTER_OPTIONS: readonly SegmentedOption<CardCreatorFilter>[] = [
  { value: 'all', label: words.boardSearchCreatorAll },
  { value: 'agent', label: words.boardSearchCreatorAi },
  { value: 'user', label: words.boardSearchCreatorUser },
]

type BoardSearchPanelStyle = CSSProperties & {
  '--e-board-search-panel-width': string
}

type ResizeSession = {
  pointerId: number
  startX: number
  startWidth: number
}

function maximumBoardSearchWidth(viewportWidth: number) {
  return Math.min(
    BOARD_SEARCH_PANEL_METRICS.maxWidth,
    Math.max(
      BOARD_SEARCH_PANEL_METRICS.minWidth,
      viewportWidth - BOARD_SEARCH_PANEL_METRICS.viewportInset,
    ),
  )
}

function clampBoardSearchWidth(width: number, viewportWidth: number) {
  return Math.min(
    Math.max(width, BOARD_SEARCH_PANEL_METRICS.minWidth),
    maximumBoardSearchWidth(viewportWidth),
  )
}

export function BoardSearchPanel({
  open,
  board,
  onActivate,
  onClose,
}: {
  open: boolean
  board: SemanticBoard
  onActivate: (cardId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [creator, setCreator] = useState<CardCreatorFilter>('all')
  const [page, setPage] = useState(0)
  const [panelWidth, setPanelWidth] = useState<number>(BOARD_SEARCH_PANEL_METRICS.defaultWidth)
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === 'undefined'
      ? BOARD_SEARCH_PANEL_METRICS.maxWidth + BOARD_SEARCH_PANEL_METRICS.viewportInset
      : window.innerWidth
  ))
  const inputRef = useRef<HTMLInputElement | null>(null)
  const resizeSessionRef = useRef<ResizeSession | null>(null)
  // Extract semantic content only when immutable graph arrays change; typing a
  // query filters the derived index instead of rebuilding Card/version text.
  const searchIndex = useMemo(() => createBoardSearchIndex(board), [board])
  const results = useMemo(
    () => searchBoardIndex(searchIndex, query, creator),
    [creator, query, searchIndex],
  )
  const pageCount = Math.max(1, Math.ceil(results.length / BOARD_SEARCH_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visibleResults = results.slice(
    safePage * BOARD_SEARCH_PAGE_SIZE,
    (safePage + 1) * BOARD_SEARCH_PAGE_SIZE,
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCreator('all')
    setPage(0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])

  useEffect(() => {
    setPanelWidth((current) => clampBoardSearchWidth(current, viewportWidth))
  }, [viewportWidth])

  if (!open) return null

  const maximumWidth = maximumBoardSearchWidth(viewportWidth)
  const displayedWidth = clampBoardSearchWidth(panelWidth, viewportWidth)

  const resizePanelFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    setPanelWidth(clampBoardSearchWidth(
      session.startWidth + session.startX - event.clientX,
      viewportWidth,
    ))
  }

  const finishPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeSessionRef.current?.pointerId !== event.pointerId) return
    resizeSessionRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const resizePanelFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = BOARD_SEARCH_PANEL_METRICS.keyboardStep
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft') nextWidth = displayedWidth + step
    else if (event.key === 'ArrowRight') nextWidth = displayedWidth - step
    else if (event.key === 'Home') nextWidth = BOARD_SEARCH_PANEL_METRICS.defaultWidth
    else if (event.key === 'End') nextWidth = maximumWidth
    if (nextWidth === null) return
    event.preventDefault()
    setPanelWidth(clampBoardSearchWidth(nextWidth, viewportWidth))
  }

  return (
    <aside
      className="highlights-panel board-search-panel"
      role="search"
      aria-label={words.boardSearch}
      style={{ '--e-board-search-panel-width': `${displayedWidth}px` } as BoardSearchPanelStyle}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        className="board-search-resize-handle"
        role="separator"
        aria-label={words.boardSearchResize}
        aria-orientation="vertical"
        aria-valuemin={BOARD_SEARCH_PANEL_METRICS.minWidth}
        aria-valuemax={maximumWidth}
        aria-valuenow={Math.round(displayedWidth)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          resizeSessionRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: displayedWidth,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={resizePanelFromPointer}
        onPointerUp={finishPanelResize}
        onPointerCancel={finishPanelResize}
        onLostPointerCapture={(event) => {
          if (resizeSessionRef.current?.pointerId === event.pointerId) resizeSessionRef.current = null
        }}
        onKeyDown={resizePanelFromKeyboard}
        onDoubleClick={() => setPanelWidth(BOARD_SEARCH_PANEL_METRICS.defaultWidth)}
      />
      <div className="highlights-head">
        <h2 className="t-title">{words.boardSearch}</h2>
        <span aria-live="polite">
          <Badge className="highlights-count">{results.length}</Badge>
        </span>
        <IconButton
          className="nodrag highlights-close"
          variant="ghost"
          size="inline"
          onClick={onClose}
          label={words.close}
          icon={<X aria-hidden="true" />}
        />
      </div>

      <div className="board-search-field">
        <FieldLabel htmlFor="board-search-input">{words.boardSearchLabel}</FieldLabel>
        <Field
          ref={inputRef}
          id="board-search-input"
          type="search"
          value={query}
          placeholder={words.boardSearchPlaceholder}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
        />
      </div>

      <div className="board-search-creator-filter">
        <span className="t-label">{words.boardSearchCreator}</span>
        <Segmented
          ariaLabel={words.boardSearchCreator}
          value={creator}
          options={CREATOR_FILTER_OPTIONS}
          onValueChange={(value) => {
            setCreator(value)
            setPage(0)
          }}
        />
      </div>

      {results.length === 0 ? (
        <div className="highlights-empty">
          <h3 className="t-display">{words.boardSearchEmptyTitle}</h3>
          <p className="t-hint">{words.boardSearchEmptyHint}</p>
        </div>
      ) : (
        <>
          <ol className="highlights-list board-search-results" aria-label={words.boardSearchResults}>
            {visibleResults.map((result) => {
              const descriptionId = `board-search-result-${result.cardId}`
              return (
                <li key={result.cardId} className="highlight-row">
                  <button
                    type="button"
                    className="highlight-row-text board-search-result"
                    aria-label={result.label}
                    aria-describedby={result.excerpt ? descriptionId : undefined}
                    onClick={() => {
                      onActivate(result.cardId)
                      onClose()
                    }}
                  >
                    <span className="board-search-result-label t-title">{result.label}</span>
                    {result.excerpt && (
                      <span id={descriptionId} className="highlight-row-source board-search-result-excerpt t-prose-s">
                        {result.excerpt}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
          {pageCount > 1 && (
            <nav className="board-search-pages" aria-label={words.boardSearchPages}>
              <Button
                variant="ghost"
                size="compact"
                disabled={safePage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                {words.previousResults}
              </Button>
              <span className="t-value">{safePage + 1} / {pageCount}</span>
              <Button
                variant="ghost"
                size="compact"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              >
                {words.nextResults}
              </Button>
            </nav>
          )}
        </>
      )}
    </aside>
  )
}
