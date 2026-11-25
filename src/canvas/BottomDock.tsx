import { useReactFlow } from '@xyflow/react'
import {
  Bot,
  BringToFront,
  Check,
  Copy,
  FolderInput,
  GitBranch,
  Group,
  Hand,
  Highlighter,
  Link2,
  MessageSquare,
  Minus,
  MousePointer2,
  Plus,
  SendToBack,
  SlidersHorizontal,
  Space,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Redo2,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { paletteColor } from '../graph/highlights'
import { noteFontSizeOf, type NoteFontSize } from '../graph/noteFontSize'
import { useGraph } from '../graph/store'

import type { CardKind } from '../graph/types'
import { availableProfileModTemplates } from '../persistence/profileBuiltInMods'
import { cardLabel } from '../graph/graphHelpers'
import { formatCardDeepLink } from '../shared/deepLinks'
import { writeTextToClipboard } from '../shared/clipboardText'
import { words } from '../shared/words'
import { useDialogs } from '../ui/overlays'
import { DockKey, Tooltip } from '../ui/primitives'
import { NOTE_FONT_STEP_MAX, NOTE_FONT_STEP_MIN } from '../ui/tokens'
import { useCard } from './graphSelectors'
import { HighlighterTray } from './HighlighterTray'

// One bottom-centre toolbox. Persistent canvas modes live in the main strip;
// selected-card controls unfold nearby, while connection controls live on the
// connection pill/popover.

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

export function BottomDock() {
  const selection = useGraph((s) => s.selection)
  const selectedCardIds = useGraph((s) => s.selectedCardIds)
  const activeTool = useGraph((s) => s.activeTool)
  const setActiveTool = useGraph((s) => s.setActiveTool)
  const activeHighlightTag = useGraph((s) =>
    s.highlightTags.find((tag) => tag.id === s.activeHighlightTagId),
  )
  const undo = useGraph((s) => s.undo)
  const redo = useGraph((s) => s.redo)
  const canUndo = useGraph((s) => s.undoStack.length > 0)
  const canRedo = useGraph((s) => s.redoStack.length > 0)
  const selectedGroupableCards = useGraph(useShallow((s) => {
    const graph = s.graph()
    return s.selectedCardIds
      .flatMap((id) => {
        const card = graph.cardById(id)
        return card && card.kind !== 'group' && card.kind !== 'title' ? [card] : []
      })
      .sort((left, right) => (graph.cardOrder(left.id) ?? 0) - (graph.cardOrder(right.id) ?? 0))
  }))
  const addCard = useGraph((s) => s.addCard)
  const savedModTemplates = useGraph((s) => s.settings.profileModLibrary)
  const addModFromLibrary = useGraph((s) => s.addModFromLibrary)
  const createGroupFromSelection = useGraph((s) => s.createGroupFromSelection)
  const { screenToFlowPosition } = useReactFlow()
  const [modLibraryOpen, setModLibraryOpen] = useState(false)
  const activeToolRef = useRef(activeTool)
  const spacebarPreviousTool = useRef<typeof activeTool | null>(null)
  const selectedCardId =
    selection?.kind === 'card' ? selection.id : selection ? null : selectedCardIds.length === 1 ? selectedCardIds[0] : null
  const contextualActionsOpen = selectedGroupableCards.length >= 2 || Boolean(selectedCardId)
  const currentContext = {
    cardId: selectedCardId,
    groupableIds: selectedGroupableCards.length >= 2
      ? selectedGroupableCards.map(card => card.id)
      : [],
  }
  const retainedContext = useRef(currentContext)
  if (contextualActionsOpen) retainedContext.current = currentContext
  const renderedContext = contextualActionsOpen ? currentContext : retainedContext.current

  useEffect(() => {
    activeToolRef.current = activeTool
  }, [activeTool])

  // React Flow already uses Space as a held pan gesture. Mirror that temporary
  // mode in the graph store so the dock's pressed Move key stays truthful.
  useEffect(() => {
    const restorePreviousTool = () => {
      const previousTool = spacebarPreviousTool.current
      if (!previousTool) return
      spacebarPreviousTool.current = null
      setActiveTool(previousTool)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const isSpacebar = event.code === 'Space' || event.key === ' '
      if (!isSpacebar || isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (spacebarPreviousTool.current) return
      spacebarPreviousTool.current = activeToolRef.current
      if (activeToolRef.current !== 'pan') setActiveTool('pan')
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') restorePreviousTool()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', restorePreviousTool)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', restorePreviousTool)
    }
  }, [setActiveTool])

  const center = () => {
    try {
      return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    } catch {
      return { x: 120, y: 120 }
    }
  }

  const createCard = (kind: CardKind) => {
    setActiveTool('select')
    addCard(kind, center())

    setModLibraryOpen(false)
  }

  const createModFromLibrary = (libraryId: string) => {
    setActiveTool('select')
    addModFromLibrary(libraryId, center())

    setModLibraryOpen(false)
  }

  // The Mod menu is a light popover: Escape or any press outside the dock closes it.
  useEffect(() => {
    if (!modLibraryOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.bottom-dock')) return
      setModLibraryOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModLibraryOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [modLibraryOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return

      const key = event.key.toLowerCase()
      if (key === 'v') {
        event.preventDefault()
        setActiveTool('select')
      } else if (key === 'h') {
        event.preventDefault()
        setActiveTool('highlight')
      } else if (key === 'n') {
        event.preventDefault()
        createCard('note')
      } else if (key === 'a') {
        event.preventDefault()
        createCard('askAi')
      } else if (key === 'c') {
        event.preventDefault()
        createCard('conversation')
      } else if (key === 'm') {
        event.preventDefault()
        createCard('mod')
      } else if (key === 't') {
        event.preventDefault()
        createCard('title')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addCard, screenToFlowPosition, setActiveTool])

  return (
    <div className="bottom-dock" aria-label={words.toolbox}>
      {activeTool === 'highlight' && <HighlighterTray />}
      {modLibraryOpen && (
        <section className="mod-library-menu" role="menu" aria-label={words.modLibrary}>
          {availableProfileModTemplates(savedModTemplates).map(({ templateId, mod, builtIn }, index, all) => {
            const label = builtIn ? mod.kind.toUpperCase() : mod.title
            const firstSaved = !builtIn && (index === 0 || all[index - 1].builtIn)
            return (
              <button
                key={templateId}
                className={`mod-library-row t-label ${firstSaved ? 'first-saved' : ''}`}
                type="button"
                role="menuitem"
                onClick={() => createModFromLibrary(templateId)}
              >
                {label}
              </button>
            )
          })}
        </section>
      )}
      <div className="dock-stack">
        <div
          className={`dock-context-tray dock-group context ${contextualActionsOpen ? 'open' : ''}`}
          role="toolbar"
          aria-label={words.selectedCardActions}
          aria-hidden={!contextualActionsOpen || undefined}
          {...(!contextualActionsOpen ? { inert: '' } : {})}
        >
          {renderedContext.groupableIds.length >= 2 && (
            <ToolButton
              key={contextualActionsOpen ? 'group-active' : 'group-retired'}
              icon={Group}
              label={words.groupSelection}
              primary
              onClick={() => createGroupFromSelection(renderedContext.groupableIds)}
            />
          )}
          {renderedContext.cardId && (
            <CardControls
              key={`${renderedContext.cardId}-${contextualActionsOpen ? 'active' : 'retired'}`}
              id={renderedContext.cardId}
            />
          )}
        </div>
        <div className="canvas-toolbox" role="toolbar" aria-label={words.toolbox}>
          <div className="tool-cluster">
            <ToolButton
              icon={MousePointer2}
              label={words.toolSelect}
              shortcut="V"
              active={activeTool === 'select'}
              onClick={() => setActiveTool('select')}
            />
            <ToolButton
              icon={Hand}
              label={words.toolPan}
              shortcut={<SpacebarShortcutIcon />}
              active={activeTool === 'pan'}
              onClick={() => setActiveTool('pan')}
            />
            <div
              className="highlighter-btn-wrap"
              style={
                activeHighlightTag
                  ? ({ '--active-tag-color': paletteColor(activeHighlightTag.color).swatch } as CSSProperties)
                  : undefined
              }
            >
              <ToolButton
                icon={Highlighter}
                label={
                  activeHighlightTag
                    ? `${words.toolHighlighter} — ${activeHighlightTag.name}`
                    : words.toolHighlighter
                }
                shortcut="H"
                preserveTooltipCase={Boolean(activeHighlightTag)}
                active={activeTool === 'highlight'}
                onClick={() => setActiveTool(activeTool === 'highlight' ? 'select' : 'highlight')}
              />
              {activeHighlightTag && <span className="highlighter-tag-ink" aria-hidden="true" />}
            </div>
          </div>
          <div className="tool-divider" />
          <div className="tool-cluster">
            <ToolButton
              icon={StickyNote}
              label={words.addNote}
              shortcut="N"
              onClick={() => createCard('note')}
            />
            <ToolButton
              icon={Bot}
              label={words.askAi}
              shortcut="A"
              onClick={() => createCard('askAi')}
            />
            <ToolButton
              icon={MessageSquare}
              label={words.addConversation}
              shortcut="C"
              onClick={() => createCard('conversation')}
            />
            <ToolButton
              icon={SlidersHorizontal}
              label={words.addMod}
              shortcut="M"
              hasPopup
              popupKind="dialog"
              expanded={modLibraryOpen}
              onClick={() => setModLibraryOpen((open) => !open)}
            />
            <ToolButton
              icon={Type}
              label={words.addTitle}
              shortcut="T"
              onClick={() => createCard('title')}
            />
          </div>
          <div className="tool-divider" />
          <div className="tool-cluster">
            <ToolButton
              icon={Undo2}
              label={words.undo}
              shortcut="⌘Z"
              disabled={!canUndo}
              onClick={undo}
            />
            <ToolButton
              icon={Redo2}
              label={words.redo}
              shortcut="⇧⌘Z"
              disabled={!canRedo}
              onClick={redo}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  primary = false,
  danger = false,
  disabled = false,
  hasPopup = false,
  preserveTooltipCase = false,
  popupKind = 'menu',
  expanded = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  shortcut?: ReactNode
  active?: boolean
  primary?: boolean
  danger?: boolean
  disabled?: boolean
  hasPopup?: boolean
  preserveTooltipCase?: boolean
  popupKind?: 'menu' | 'dialog'
  expanded?: boolean
  onClick: () => void
}) {
  const shortcutLabel = preserveTooltipCase || label.trim().split(/\s+/).length > 2
    ? label
    : label.toUpperCase()
  const tooltip = shortcut ? <>{shortcutLabel} · {shortcut}</> : label
  return (
    <DockKey
      label={label}
      tooltip={tooltip}
      icon={<Icon aria-hidden="true" />}
      pressed={!hasPopup && active === true}
      aria-pressed={!hasPopup && active !== undefined ? active : undefined}
      variant={primary ? 'primary' : danger ? 'danger' : 'quiet'}
      aria-haspopup={hasPopup ? popupKind : undefined}
      aria-expanded={hasPopup ? expanded : undefined}
      disabled={disabled}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
    />
  )
}

// The Note text size control. One pill: minus, the step the Note reads at, then
// plus behind a hairline. The number IS the control's value, not a label, so it
// is a spinbutton and moves under the arrow keys like any other numeric
// control. Steps are the Note text ladder's steps (src/ui/tokens.ts); this
// component never names a size.
function NoteSizeStepper({
  step,
  onStep,
}: {
  step: NoteFontSize
  onStep: (step: NoteFontSize) => void
}) {
  const atMin = step <= NOTE_FONT_STEP_MIN
  const atMax = step >= NOTE_FONT_STEP_MAX
  const moveTo = (next: number) => {
    const bounded = Math.min(NOTE_FONT_STEP_MAX, Math.max(NOTE_FONT_STEP_MIN, next))
    if (bounded !== step) onStep(bounded as NoteFontSize)
  }
  const onValueKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? step + 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? step - 1
        : event.key === 'Home' ? NOTE_FONT_STEP_MIN
          : event.key === 'End' ? NOTE_FONT_STEP_MAX
            : null
    if (next === null) return
    // The canvas listens for keys on the window; a step is not a board command.
    event.preventDefault()
    event.stopPropagation()
    moveTo(next)
  }
  return (
    <Tooltip content={`${words.noteSize}: ${step}`}>
      <div className="e-stepper dock-stepper" role="group" aria-label={words.noteSize}>
        <button
          type="button"
          aria-label={words.noteSizeSmaller}
          disabled={atMin}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => moveTo(step - 1)}
        >
          <Minus aria-hidden="true" />
        </button>
        <div
          className="e-stepper__value dock-stepper__value t-value"
          role="spinbutton"
          tabIndex={0}
          aria-label={words.noteSize}
          aria-valuenow={step}
          aria-valuemin={NOTE_FONT_STEP_MIN}
          aria-valuemax={NOTE_FONT_STEP_MAX}
          onKeyDown={onValueKeyDown}
        >
          {step}
        </div>
        <span className="dock-stepper__divider" aria-hidden="true" />
        <button
          type="button"
          aria-label={words.noteSizeBigger}
          disabled={atMax}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => moveTo(step + 1)}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
    </Tooltip>
  )
}

function SpacebarShortcutIcon() {
  return (
    <Space
      aria-label={words.spacebar}
      className="shortcut-spacebar-icon"
      size={18}
      strokeWidth={1.75}
    />
  )
}

function CardControls({ id }: { id: string }) {
  const card = useCard(id)
  const groups = useGraph(useShallow((s) => s.graph().cardsByKind('group')))
  const hasConnections = useGraph((s) => s.graph().connectionsForCard(id).length > 0)
  const currentIdeaId = useGraph((s) => s.currentIdeaId)
  const deleteCard = useGraph((s) => s.deleteCard)
  const duplicateCard = useGraph((s) => s.duplicateCard)
  const bringCardsToFront = useGraph((s) => s.bringCardsToFront)
  const sendCardsToBack = useGraph((s) => s.sendCardsToBack)
  const setCardFontSize = useGraph((s) => s.setCardFontSize)
  const addCardToGroup = useGraph((s) => s.addCardToGroup)
  const removeCardFromGroup = useGraph((s) => s.removeCardFromGroup)
  const dialogs = useDialogs()
  const { getViewport } = useReactFlow()
  const [copied, setCopied] = useState(false)
  const [openMenu, setOpenMenu] = useState<'group' | null>(null)
  const controlsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timeout)
  }, [copied])

  useEffect(() => {
    setOpenMenu(null)
  }, [id])

  useEffect(() => {
    if (!openMenu) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && controlsRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  if (!card) return null
  const currentGroup = groups.find((group) => group.id === card.groupId)
  const canAssignGroup = card.kind !== 'group' && card.kind !== 'title' && groups.length > 0

  const onDelete = async () => {
    const targetId = id
    if (card.kind === 'group') {
      const confirmed = await dialogs.confirm({
        title: words.deleteGroup,
        message: words.deleteGroupConfirm,
        confirmLabel: words.deleteGroup,
        tone: 'danger',
      })
      if (!confirmed) return
    }
    deleteCard(targetId)
  }

  const copyCardLink = async () => {
    if (!currentIdeaId) return
    const href = formatCardDeepLink(window.location.href, {
      ideaId: currentIdeaId,
      cardId: id,
      viewport: getViewport(),
    })
    if (await writeTextToClipboard(href)) {
      setCopied(true)

    }
  }

  return (
    <div className="card-context-tools" ref={controlsRef}>
      <ToolButton icon={Link2} label={copied ? words.cardLinkCopied : words.copyCardLink} onClick={copyCardLink} disabled={!currentIdeaId} />
      <ToolButton icon={Copy} label={words.duplicateCard} onClick={() => duplicateCard(id)} />
      {hasConnections && (
        <ToolButton
          icon={GitBranch}
          label={words.duplicateWithConnections}
          onClick={() => duplicateCard(id, { cloneConnections: true })}
        />
      )}
      <ToolButton icon={BringToFront} label={words.bringForward} onClick={() => bringCardsToFront([id])} />
      <ToolButton icon={SendToBack} label={words.sendBackward} onClick={() => sendCardsToBack([id])} />
      {card.kind === 'note' && (
        <NoteSizeStepper
          step={noteFontSizeOf(card)}
          onStep={(step) => setCardFontSize(id, step)}
        />
      )}
      {canAssignGroup && (
        <div className={`dock-popover-wrap ${openMenu === 'group' ? 'open' : ''}`}>
          <ToolButton
            icon={FolderInput}
            label={currentGroup ? `${words.groupMode}: ${cardLabel(currentGroup)}` : words.notInGroup}
            active={openMenu === 'group'}
            hasPopup
            expanded={openMenu === 'group'}
            onClick={() => setOpenMenu(openMenu === 'group' ? null : 'group')}
          />
          {openMenu === 'group' && (
            <div className="dock-popover dock-menu" role="menu" aria-label={words.groupMode}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!card.groupId}
                className={!card.groupId ? 'active' : ''}
                onClick={() => {
                  removeCardFromGroup(id)
                  setOpenMenu(null)
                }}
              >
                <span className="dock-check-slot">
                  {!card.groupId && <Check size={14} strokeWidth={2} aria-hidden="true" />}
                </span>
                <span>{words.notInGroup}</span>
              </button>
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={card.groupId === group.id}
                  className={card.groupId === group.id ? 'active' : ''}
                  onClick={() => {
                    addCardToGroup(id, group.id)
                    setOpenMenu(null)
                  }}
                >
                  <span className="dock-check-slot">
                    {card.groupId === group.id && <Check size={14} strokeWidth={2} aria-hidden="true" />}
                  </span>
                  <span>{cardLabel(group)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <ToolButton
        icon={Trash2}
        label={card.kind === 'group' ? words.deleteGroup : words.deleteCard}
        danger
        onClick={() => void onDelete()}
      />
    </div>
  )
}
