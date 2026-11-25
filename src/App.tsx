import { ReactFlowProvider, useReactFlow, type Viewport } from '@xyflow/react'
import { ArrowRight, ChevronDown, Trash2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Board } from './canvas/Board'
import { HighlightsPanel } from './canvas/HighlightsPanel'
import { renderedCardSize } from './canvas/renderPlanning'
import { TimelinePlayback } from './canvas/TimelinePlayback'
import { playbackEventIndexAtProgress, playbackProgressForEventIndex } from './canvas/playbackTimeline'
import { UndoControls } from './canvas/UndoControls'
import { serializeIdeaExport } from './graph/ideaExport'
import { noteFontSizeOf } from './graph/noteFontSize'
import { useGraph, type ProfileStartupState } from './graph/store'
import { createTimelineProjector, sortedTimelineEvents, type TimelineProjection } from './graph/timeline'
import type { Card, Connection, IdeaExport, SavedBoard } from './graph/types'
import { ideaCardCountLabel, ideaDeletedLabel, ideaUpdatedLabel, words } from './shared/words'
import { ModalShell, useDialogs } from './ui/overlays'
import { Badge, Button, Field, IconButton, StateWord } from './ui/primitives'
import { useAppliedTheme } from './ui/themeStore'
import { cameraDuration, useAppliedReducedMotion } from './ui/motion'
import type { ThemeId } from './ui/tokens'
import { useRendererCountersEnabled } from './ui/rendererCountersPreference'

const PLAYBACK_DURATION_MS = 12000
const PLAYBACK_PROJECTION_THROTTLE_MS = 45
const EMPTY_GHOST_CARD_IDS = new Set<string>()
const EMPTY_GHOST_CONNECTION_IDS = new Set<string>()
const BoardSearchPanel = lazy(() =>
  import('./canvas/BoardSearchPanel').then((module) => ({ default: module.BoardSearchPanel })),
)
const BottomDock = lazy(() =>
  import('./canvas/BottomDock').then((module) => ({ default: module.BottomDock })),
)
const SettingsModal = lazy(() =>
  import('./canvas/SettingsModal').then((module) => ({ default: module.SettingsModal })),
)
const RendererCountersOverlay = lazy(() =>
  import('./canvas/RendererCountersOverlay').then((module) => ({
    default: module.RendererCountersOverlay,
  })),
)

export default function App() {
  const theme = useAppliedTheme()
  const reducedMotion = useAppliedReducedMotion()
  const rendererCountersEnabled = useRendererCountersEnabled()
  const hydrate = useGraph((s) => s.hydrate)
  const hydrated = useGraph((s) => s.hydrated)
  const profileStartupState = useGraph((s) => s.profileStartupState)
  const keyPromptOpen = useGraph((s) => s.keyPromptOpen)
  const setKeyPromptOpen = useGraph((s) => s.setKeyPromptOpen)
  const ideaManagerOpen = useGraph((s) => s.ideaManagerOpen)
  const setIdeaManagerOpen = useGraph((s) => s.setIdeaManagerOpen)
  const setHighlightsPanelOpen = useGraph((s) => s.setHighlightsPanelOpen)
  const [playbackOpen, setPlaybackOpen] = useState(false)
  const [boardSearchOpen, setBoardSearchOpen] = useState(false)
  // Where the user was before opening playback, so exiting puts them back.
  const [playbackReturnViewport, setPlaybackReturnViewport] = useState<Viewport | null>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (playbackOpen || keyPromptOpen || ideaManagerOpen) return
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      setHighlightsPanelOpen(false)
      setBoardSearchOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [ideaManagerOpen, keyPromptOpen, playbackOpen, setHighlightsPanelOpen])

  if (!hydrated) return <ProfileStartupSurface state={profileStartupState} />

  return (
    <ReactFlowProvider>
      <div className={`app ${playbackOpen ? 'playback-active' : ''}`}>
        <TopBar
          playbackOpen={playbackOpen}
          searchOpen={boardSearchOpen}
          onSetSearchOpen={setBoardSearchOpen}
          onOpenPlayback={() => {
            setBoardSearchOpen(false)
            setPlaybackOpen(true)
          }}
          onExitPlayback={() => setPlaybackOpen(false)}
          onCaptureViewport={setPlaybackReturnViewport}
        />
        <div className={`board-wrap ${playbackOpen ? 'playback-mode' : ''}`}>
          {playbackOpen ? (
            <PlaybackBoard
              theme={theme}
              reducedMotion={reducedMotion}
              onExit={() => setPlaybackOpen(false)}
            />
          ) : (
            <>
              <Board
                theme={theme}
                reducedMotion={reducedMotion}
                ghostCardIds={EMPTY_GHOST_CARD_IDS}
                ghostConnectionIds={EMPTY_GHOST_CONNECTION_IDS}
                resumeViewport={playbackReturnViewport}
              />
              <EmptyState />
              <UndoControls />
              <Suspense fallback={null}>
                <BottomDock />
              </Suspense>
              <HighlightsPanel />
              {boardSearchOpen && (
                <Suspense fallback={null}>
                  <ConnectedBoardSearchPanel
                    open
                    onClose={() => setBoardSearchOpen(false)}
                  />
                </Suspense>
              )}
            </>
          )}
        </div>
      </div>
      {rendererCountersEnabled && (
        <Suspense fallback={null}>
          <RendererCountersOverlay />
        </Suspense>
      )}
      {keyPromptOpen && (
        <Suspense fallback={null}>
          <SettingsModal initialCategory="ai" onClose={() => setKeyPromptOpen(false)} />
        </Suspense>
      )}
      <IdeaManagerModal open={ideaManagerOpen} onClose={() => setIdeaManagerOpen(false)} />
    </ReactFlowProvider>
  )
}

export function ProfileStartupSurface({ state }: { state: ProfileStartupState }) {
  const candidates = useGraph((store) => store.recoveryCandidates)
  const restoringCandidateId = useGraph((store) => store.restoringRecoveryCandidateId)
  const startingFresh = useGraph((store) => store.startingFreshProfile)
  const profileStartupError = useGraph((store) => store.profileStartupError)
  const profileStartupErrorKind = useGraph((store) => store.profileStartupErrorKind)
  const restoreProfileRecovery = useGraph((store) => store.restoreProfileRecovery)
  const startFreshProfile = useGraph((store) => store.startFreshProfile)
  const verifiedCandidates = candidates.filter((candidate) => candidate.verified)

  if (state === 'recovery-required') {
    return (
      <main className="app">
        <div className="board-wrap">
          <section className="empty" aria-labelledby="profile-recovery-title">
            <h2 id="profile-recovery-title" className="t-display">{words.profileRecoveryTitle}</h2>
            <p className="t-hint">{words.profileRecoveryHint}</p>
            {verifiedCandidates.length === 0 && !profileStartupError ? (
              <p className="t-hint" role="alert">{words.profileRecoveryEmpty}</p>
            ) : verifiedCandidates.map((candidate) => {
              const recoveryDate = formatIdeaDate(candidate.createdAt)
              return (
                <div className="idea-row" key={candidate.id}>
                  <span className="idea-row-date t-value">{recoveryDate}</span>
                  {restoringCandidateId === candidate.id ? (
                    <StateWord tone="running">{words.restoringProfile}</StateWord>
                  ) : (
                    <Button
                      aria-label={`${words.restoreProfile} ${recoveryDate}`}
                      className="empty__action"
                      disabled={restoringCandidateId !== null || startingFresh}
                      onClick={() => void restoreProfileRecovery(candidate.id)}
                    >
                      {words.restoreProfile}
                    </Button>
                  )}
                </div>
              )
            })}
            <p className="t-hint">{words.startFreshProfileHint}</p>
            {startingFresh ? (
              <StateWord tone="running">{words.startingFreshProfile}</StateWord>
            ) : (
              <Button
                className="empty__action"
                disabled={restoringCandidateId !== null}
                onClick={() => void startFreshProfile()}
              >
                {words.startFreshProfile}
              </Button>
            )}
            {profileStartupError && (
              <p className="idea-error t-hint" role="alert" aria-live="assertive">
                {profileStartupErrorKind === 'start-fresh'
                  ? words.profileStartFreshFailed
                  : words.profileRecoveryFailed}
              </p>
            )}
          </section>
        </div>
      </main>
    )
  }

  const failed = state === 'failed'
  return (
    <main className="app">
      <div className="board-wrap">
        <section className="empty" role={failed ? 'alert' : 'status'} aria-live="polite">
          <h2 className="t-display">
            {failed ? words.profileUnavailableTitle : words.profileLoadingTitle}
          </h2>
          <p className="t-hint">
            {failed ? words.profileUnavailableHint : words.profileLoadingHint}
          </p>
        </section>
      </div>
    </main>
  )
}

function ConnectedBoardSearchPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cards = useGraph((s) => s.cards)
  const connections = useGraph((s) => s.connections)
  const outputs = useGraph((s) => s.outputs)
  const runs = useGraph((s) => s.runs)
  const requestCardFocus = useGraph((s) => s.requestCardFocus)
  const setActiveTool = useGraph((s) => s.setActiveTool)
  const board = useMemo(() => ({ cards, connections, outputs, runs }), [cards, connections, outputs, runs])

  return (
    <BoardSearchPanel
      open={open}
      board={board}
      onActivate={(cardId) => {
        setActiveTool('select')
        requestCardFocus(cardId)
      }}
      onClose={onClose}
    />
  )
}

function PlaybackBoard({
  theme,
  reducedMotion,
  onExit,
}: {
  theme: ThemeId
  reducedMotion: boolean
  onExit: () => void
}) {
  const cards = useGraph((s) => s.cards)
  const connections = useGraph((s) => s.connections)
  const intentLog = useGraph((s) => s.intentLog)
  const outputs = useGraph((s) => s.outputs)
  const [playing, setPlaying] = useState(false)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [projectedProgress, setProjectedProgress] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(2)
  const lastProjectedAtRef = useRef(0)
  const playbackProgressRef = useRef(0)
  const { fitBounds } = useReactFlow()

  useEffect(() => {
    playbackProgressRef.current = playbackProgress
  }, [playbackProgress])

  const playbackBoard = useMemo<Pick<SavedBoard, 'cards' | 'connections' | 'intentLog' | 'outputs'>>(
    () => ({
      cards,
      connections,
      intentLog,
      outputs,
    }),
    [cards, connections, intentLog, outputs],
  )
  const timelineProjector = useMemo(() => createTimelineProjector(playbackBoard), [playbackBoard])
  const range = timelineProjector.range
  const playbackEventCount = useMemo(() => sortedTimelineEvents(intentLog).length, [intentLog])
  // Playback is paced by event order. Recorded timestamps remain untouched as
  // provenance and still supply the content/version time for each projection.
  const projectedEventIndex = playbackEventIndexAtProgress(playbackEventCount, projectedProgress)
  const projection = useMemo(
    () => timelineProjector.projectThrough(projectedEventIndex),
    [projectedEventIndex, timelineProjector],
  )
  const boardProjection = useStablePlaybackProjection(projection)

  // Every card the timeline ever shows, live or ghost, sits inside the end
  // projection, so fitting to it keeps the whole replay on screen.
  const timelineBounds = useMemo(() => {
    if (!range) return null
    const endProjection = timelineProjector.projectAt(range.endAt)
    if (!endProjection.cards.length) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const card of endProjection.cards) {
      const size = renderedCardSize(card)
      minX = Math.min(minX, card.position.x)
      minY = Math.min(minY, card.position.y)
      maxX = Math.max(maxX, card.position.x + size.width)
      maxY = Math.max(maxY, card.position.y + size.height)
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }, [range, timelineProjector])

  useEffect(() => {
    if (!timelineBounds) return
    // Two frames so React Flow has measured its pane before the fit.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        void fitBounds(timelineBounds, {
          padding: 0.15,
          duration: cameraDuration(0, reducedMotion),
        })
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fitBounds, reducedMotion, timelineBounds])

  // Throttle, not debounce: while playing, progress changes every animation
  // frame, so a resetting debounce would starve and freeze the projection.
  useEffect(() => {
    const elapsed = performance.now() - lastProjectedAtRef.current
    const delay = Math.max(0, PLAYBACK_PROJECTION_THROTTLE_MS - elapsed)
    const handle = window.setTimeout(() => {
      lastProjectedAtRef.current = performance.now()
      setProjectedProgress(playbackProgress)
    }, delay)
    return () => window.clearTimeout(handle)
  }, [playbackProgress])

  const changePlaying = useCallback((nextPlaying: boolean) => {
    // Playing again from the end restarts, like a video.
    if (nextPlaying && playbackProgressRef.current >= 1) {
      setPlaybackProgress(0)
      setProjectedProgress(0)
    }
    setPlaying(nextPlaying)
  }, [])

  const stepToEvent = useCallback(
    (direction: 1 | -1) => {
      if (!range || playbackEventCount === 0) return
      setPlaying(false)
      setPlaybackProgress((current) => {
        const currentEventIndex = playbackEventIndexAtProgress(playbackEventCount, current)
        return playbackProgressForEventIndex(currentEventIndex + direction, playbackEventCount)
      })
    },
    [playbackEventCount, range],
  )

  // Video-style keys: Space plays/pauses, arrows step between events.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        onExit()
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        changePlaying(!playing)
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        stepToEvent(event.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [changePlaying, onExit, playing, stepToEvent])

  useEffect(() => {
    if (!playing || !range) return
    let frame = 0
    let previous = performance.now()
    const step = (now: number) => {
      const delta = now - previous
      previous = now
      setPlaybackProgress((current) => {
        const next = Math.min(1, current + (delta * playbackSpeed) / PLAYBACK_DURATION_MS)
        if (next >= 1) setPlaying(false)
        return next
      })
      frame = window.requestAnimationFrame(step)
    }
    frame = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(frame)
  }, [playbackSpeed, playing, range])

  return (
    <>
      <Board
        theme={theme}
        reducedMotion={reducedMotion}
        cards={boardProjection.cards}
        connections={boardProjection.connections}
        readOnly
        ghostCardIds={boardProjection.ghostCardIds}
        ghostConnectionIds={boardProjection.ghostConnectionIds}
      />
      <TimelinePlayback
        range={range}
        projection={projection}
        progress={playbackProgress}
        playing={playing}
        speed={playbackSpeed}
        onProgressChange={(progress) => {
          setPlaying(false)
          setPlaybackProgress(progress)
        }}
        onPlayingChange={changePlaying}
        onSpeedChange={setPlaybackSpeed}
      />
    </>
  )
}

function useStablePlaybackProjection(projection: TimelineProjection): TimelineProjection {
  const previousRef = useRef<TimelineProjection | null>(null)

  return useMemo(() => {
    const previous = previousRef.current
    if (previous && samePlaybackGraph(previous, projection)) {
      const stable = {
        ...projection,
        cards: previous.cards,
        connections: previous.connections,
        ghostCardIds: previous.ghostCardIds,
        ghostConnectionIds: previous.ghostConnectionIds,
      }
      previousRef.current = stable
      return stable
    }

    previousRef.current = projection
    return projection
  }, [projection])
}

function samePlaybackGraph(a: TimelineProjection, b: TimelineProjection): boolean {
  return (
    sameGhostIds(a.ghostCardIds, b.ghostCardIds) &&
    sameGhostIds(a.ghostConnectionIds, b.ghostConnectionIds) &&
    a.cards.length === b.cards.length &&
    a.connections.length === b.connections.length &&
    a.cards.every((card, index) => samePlaybackCard(card, b.cards[index])) &&
    a.connections.every((connection, index) => samePlaybackConnection(connection, b.connections[index]))
  )
}

function sameGhostIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

function samePlaybackCard(a: Card, b: Card): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.title === b.title &&
    a.headerColor === b.headerColor &&
    a.headerFill === b.headerFill &&
    a.groupId === b.groupId &&
    noteFontSizeOf(a) === noteFontSizeOf(b) &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    (a.size?.width ?? null) === (b.size?.width ?? null) &&
    (a.size?.height ?? null) === (b.size?.height ?? null) &&
    samePlaybackBlocks(a.blocks, b.blocks) &&
    (a.assets?.length ?? 0) === (b.assets?.length ?? 0)
  )
}

function samePlaybackBlocks(a: Card['blocks'], b: Card['blocks']): boolean {
  return a.length === b.length && a.every((block, index) => block.id === b[index].id && block.text === b[index].text)
}

function samePlaybackConnection(a: Connection, b: Connection): boolean {
  return (
    a.id === b.id &&
    a.from.cardId === b.from.cardId &&
    a.from.blockId === b.from.blockId &&
    a.to.cardId === b.to.cardId &&
    a.to.blockId === b.to.blockId &&
    a.strength === b.strength &&
    a.polarity === b.polarity &&
    a.role === b.role &&
    a.reason === b.reason &&
    (a.meta?.groupMode ?? null) === (b.meta?.groupMode ?? null)
  )
}

export function TopBar({
  playbackOpen,
  searchOpen,
  onSetSearchOpen,
  onOpenPlayback,
  onExitPlayback,
  onCaptureViewport,
}: {
  playbackOpen: boolean
  searchOpen: boolean
  onSetSearchOpen: (open: boolean) => void
  onOpenPlayback: () => void
  onExitPlayback: () => void
  onCaptureViewport: (viewport: Viewport) => void
}) {
  const { getViewport } = useReactFlow()
  const saveState = useGraph((s) => s.saveState)
  const storageStatus = useGraph((s) => s.storageStatus)
  const ideas = useGraph((s) => s.ideas)
  const currentIdeaId = useGraph((s) => s.currentIdeaId)
  const setKeyPromptOpen = useGraph((s) => s.setKeyPromptOpen)
  const setIdeaManagerOpen = useGraph((s) => s.setIdeaManagerOpen)
  const highlightCount = useGraph((s) => s.highlights.length)
  const highlightsPanelOpen = useGraph((s) => s.highlightsPanelOpen)
  const setHighlightsPanelOpen = useGraph((s) => s.setHighlightsPanelOpen)
  const currentIdea = ideas.find((idea) => idea.id === currentIdeaId)

  const saveLabel =
    saveState === 'saving'
      ? words.saving
      : saveState === 'failed'
        ? words.saveFailed
        : storageStatus?.backend === 'disk'
          ? words.saved
          : storageStatus?.backend === 'browser'
            ? words.savedBrowser
            : words.saved
  const saveTitle =
    storageStatus?.backend === 'disk'
      ? storageStatus.dataFile
      : storageStatus?.backend === 'browser'
        ? storageStatus.warning || words.browserStorageWarning
        : undefined

  return (
    <header className="topbar">
      <span className="brand t-display">Eido</span>
      <div className="topbar-idea">
        <Button
          className="idea-pill"
          size="compact"
          typographyRole="ui"
          onClick={() => {
            onSetSearchOpen(false)
            setIdeaManagerOpen(true)
          }}
          title={words.ideas}
        >
          <span>{currentIdea?.name ?? words.ideas}</span>
          <ChevronDown aria-hidden="true" focusable="false" />
        </Button>
        <span
          className={`save-state t-value ${saveState === 'failed' ? 'failed' : ''} ${
            storageStatus?.backend === 'browser' ? 'browser' : ''
          }`}
          title={saveTitle}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {saveLabel}
          {saveState === 'saving' && <span className="save-state__pulse" aria-hidden="true" />}
        </span>
      </div>

      <span className="spacer" />

      <div className="topbar-actions" role="group" aria-label={words.topbarActions}>
        <Button
          className="topbar-action"
          variant="ghost"
          size="compact"
          aria-pressed={searchOpen}
          onClick={() => {
            setHighlightsPanelOpen(false)
            onSetSearchOpen(!searchOpen)
          }}
          title={words.boardSearchLabel}
        >
          {words.boardSearch}
        </Button>

        <Button
          className="topbar-action"
          variant="ghost"
          size="compact"
          aria-pressed={highlightsPanelOpen}
          onClick={() => {
            onSetSearchOpen(false)
            setHighlightsPanelOpen(!highlightsPanelOpen)
          }}
          title={words.highlightsTitle}
        >
          {words.highlights}
          {highlightCount > 0 && <Badge>{highlightCount}</Badge>}
        </Button>

        <Button
          className="topbar-action"
          variant="ghost"
          size="compact"
          aria-pressed={playbackOpen}
          onClick={() => {
            if (playbackOpen) {
              onExitPlayback()
              return
            }
            onSetSearchOpen(false)
            // Capture before the playback board mounts: mounting resets the
            // shared viewport, and exiting should land back right here.
            onCaptureViewport(getViewport())
            onOpenPlayback()
          }}
        >
          {words.playback}
        </Button>

        <Button
          className="topbar-action"
          variant="ghost"
          size="compact"
          onClick={() => {
            onSetSearchOpen(false)
            setKeyPromptOpen(true)
          }}
        >
          {words.settings}
        </Button>
      </div>
    </header>
  )
}

export function IdeaManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogs = useDialogs()
  const ideas = useGraph((s) => s.ideas)
  const currentIdeaId = useGraph((s) => s.currentIdeaId)
  const cardCount = useGraph((s) => s.cards.length)
  const createIdea = useGraph((s) => s.createIdea)
  const loadIdea = useGraph((s) => s.loadIdea)
  const renameCurrentIdea = useGraph((s) => s.renameCurrentIdea)
  const duplicateCurrentIdea = useGraph((s) => s.duplicateCurrentIdea)
  const deleteIdea = useGraph((s) => s.deleteIdea)
  const pendingIdeaDelete = useGraph((s) => s.pendingIdeaDelete)
  const stageIdeaDelete = useGraph((s) => s.stageIdeaDelete)
  const undoStagedIdeaDelete = useGraph((s) => s.undoStagedIdeaDelete)
  const commitStagedIdeaDelete = useGraph((s) => s.commitStagedIdeaDelete)
  const importIdea = useGraph((s) => s.importIdea)
  const exportCurrentIdeaToNative = useGraph((s) => s.exportCurrentIdeaToNative)
  const importIdeaFromNative = useGraph((s) => s.importIdeaFromNative)
  const persistenceKind = useGraph((s) => s.persistenceKind)
  const snapshot = useGraph((s) => s.snapshot)
  const currentIdea = ideas.find((idea) => idea.id === currentIdeaId)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [renameName, setRenameName] = useState(currentIdea?.name ?? '')
  const [importError, setImportError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setRenameName(currentIdea?.name ?? '')
  }, [currentIdea?.name])

  // The shelf lists everywhere you could return to — most recently touched
  // first. The current Board lives on the cover above, not in the shelf, and
  // a staged deletion hides its row while the undo window is open.
  const otherIdeas = useMemo(
    () =>
      ideas
        .filter((idea) => idea.id !== currentIdeaId && idea.id !== pendingIdeaDelete?.id)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [currentIdeaId, ideas, pendingIdeaDelete?.id],
  )

  const resetTransientState = () => {
    setNewName('')
    setCreating(false)
    setRenameName(currentIdea?.name ?? '')
    setImportError('')
    // Closing takes the undo affordance with it, so the staged delete lands.
    void commitStagedIdeaDelete()
  }

  // Creating a Board flushes the current Board first, so the wait is visible.
  // Hold the pending state here rather than reading the save word: the top bar
  // reports durability for the whole Profile, not this one action.
  const create = async () => {
    if (creating) return
    setCreating(true)
    try {
      await createIdea(newName.trim() || 'Untitled idea')
    } finally {
      setCreating(false)
    }
  }

  // Inline rename commits when the name field loses focus (Enter blurs it).
  // Empty and unchanged names quietly revert — no error state to manage.
  const commitRename = async () => {
    const next = renameName.trim()
    if (!currentIdea || !next || next === currentIdea.name) {
      setRenameName(currentIdea?.name ?? '')
      return
    }
    await renameCurrentIdea(next)
  }

  const duplicate = async () => {
    await duplicateCurrentIdea(`${currentIdea?.name ?? 'Untitled idea'} copy`)
  }

  const confirmRemoval = (name: string) => dialogs.confirm({
    title: `${words.deleteIdea} "${name}"?`,
    message: words.ideaDeleteConsequence,
    confirmLabel: words.deleteIdea,
    tone: 'danger',
  })

  const remove = async (id: string, name: string) => {
    if (!await confirmRemoval(name)) return
    await deleteIdea(id)
  }

  // A shelf row keeps its undo window, but closing this dialog commits the
  // staged deletion, so the ask comes before staging rather than after it.
  const removeFromShelf = async (id: string, name: string) => {
    if (!await confirmRemoval(name)) return
    await stageIdeaDelete(id)
  }

  const exportCurrent = async () => {
    if (persistenceKind === 'packaged-profile') {
      await exportCurrentIdeaToNative()
      return
    }
    if (currentIdea) {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(
        new Blob([serializeIdeaExport(currentIdea, snapshot())], { type: 'application/json' }),
      )
      link.download = `${safeFileName(currentIdea.name)}.eido-idea.json`
      link.click()
      URL.revokeObjectURL(link.href)
    }
  }

  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImportError('')
    try {
      const raw = JSON.parse(await file.text()) as Partial<IdeaExport> | SavedBoard
      const board = isSavedBoard(raw) ? raw : isSavedBoard(raw.board) ? raw.board : null
      if (!board) throw new Error('Invalid Idea file')
      const importedName = !isSavedBoard(raw) && raw.idea?.name ? raw.idea.name : file.name.replace(/\.eido-idea\.json$/i, '')
      await importIdea(importedName, board)
    } catch {
      setImportError(words.ideaImportFailed)
    }
  }

  return (
    <ModalShell
      open={open}
      title={words.ideas}
      subtitle={words.ideaLocalHint}
      dismissOnBackdrop
      className="idea-modal"
      onDismiss={onClose}
      onExitComplete={resetTransientState}
      footer={<Button onClick={onClose}>{words.close}</Button>}
    >
        {currentIdea && (
          <>
            <section className="idea-cover e-grain e-grain--green">
              <span className="idea-cover__eyebrow t-micro">{words.currentIdea}</span>
              <input
                className="idea-cover__name"
                aria-label={words.currentIdea}
                title={words.renameIdea}
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
              <span className="idea-cover__meta t-value">
                {ideaCardCountLabel(cardCount)} · {ideaUpdatedLabel(humanizeIdeaDate(currentIdea.updatedAt))}
              </span>
            </section>
            <div className="idea-cover-actions">
              <Button onClick={duplicate}>
                {words.duplicateIdea}
              </Button>
              <Button onClick={() => void exportCurrent()}>
                {words.exportIdea}
              </Button>
              <Button onClick={() => {
                if (persistenceKind === 'packaged-profile') {
                  void importIdeaFromNative().catch(() => undefined)
                }
                else fileInputRef.current?.click()
              }}>
                {words.importIdea}
              </Button>
              <Button
                variant="danger"
                className="idea-delete-current"
                disabled={ideas.length <= 1}
                onClick={() => void remove(currentIdea.id, currentIdea.name)}
              >
                {words.deleteIdea}
              </Button>
            </div>
          </>
        )}

        {persistenceKind === 'browser-development' && (
          <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={readImport} />
        )}
        {importError && (
          <p className="idea-error t-hint" role="alert" aria-live="assertive">
            {importError}
          </p>
        )}

        <form
          className="idea-create"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <Field
            aria-label={words.ideaName}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={words.ideaCreatePlaceholder}
            disabled={creating}
          />
          {creating ? (
            <StateWord tone="running">{words.creatingIdea}</StateWord>
          ) : (
            <Button type="submit" variant="primary" size="field-mate">
              {words.createIdea}
            </Button>
          )}
        </form>

        {otherIdeas.length > 0 ? (
          <ul className="idea-shelf">
            {otherIdeas.map((idea) => (
              <li className="idea-shelf__row" key={idea.id}>
                <button
                  type="button"
                  className="idea-shelf__open"
                  aria-label={`${words.loadIdea} "${idea.name}"`}
                  onClick={() => {
                    void loadIdea(idea.id)
                  }}
                >
                  <span className="idea-shelf__text">
                    <span className="idea-shelf__name t-title">{idea.name}</span>
                    <span className="idea-shelf__meta t-value">
                      {ideaUpdatedLabel(humanizeIdeaDate(idea.updatedAt))}
                    </span>
                  </span>
                  <ArrowRight className="idea-shelf__go" aria-hidden="true" focusable="false" />
                </button>
                <IconButton
                  variant="ghost"
                  className="idea-shelf__delete"
                  label={`${words.deleteIdea} "${idea.name}"`}
                  tooltip={words.deleteIdea}
                  icon={<Trash2 aria-hidden="true" focusable="false" />}
                  onClick={() => void removeFromShelf(idea.id, idea.name)}
                />
              </li>
            ))}
          </ul>
        ) : (
          !pendingIdeaDelete && <p className="idea-shelf-empty t-hint">{words.ideaShelfEmpty}</p>
        )}
        {pendingIdeaDelete && (
          <div className="idea-undo" role="status" aria-live="polite">
            <span className="idea-undo__text t-ui">{ideaDeletedLabel(pendingIdeaDelete.name)}</span>
            <Button variant="ghost" size="compact" onClick={undoStagedIdeaDelete}>
              {words.undo}
            </Button>
          </div>
        )}
    </ModalShell>
  )
}

function safeFileName(name: string): string {
  return name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'eido-idea'
}

function formatIdeaDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Recent stamps read like a friend would say them ("today, 14:02"); anything
// older falls back to the plain date form.
function humanizeIdeaDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const startOfDay = (of: Date) => new Date(of.getFullYear(), of.getMonth(), of.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)
  if (dayDiff !== 0 && dayDiff !== 1) return formatIdeaDate(value)
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${dayDiff === 0 ? words.today : words.yesterday}, ${time}`
}

function isSavedBoard(value: unknown): value is SavedBoard {
  if (!value || typeof value !== 'object') return false
  const board = value as Partial<SavedBoard>
  return (
    board.version === 1 &&
    Array.isArray(board.cards) &&
    Array.isArray(board.connections) &&
    Array.isArray(board.outputs) &&
    Array.isArray(board.runs) &&
    typeof board.updatedAt === 'string'
  )
}

export function EmptyState() {
  const count = useGraph((s) => s.cards.length)
  const addCard = useGraph((s) => s.addCard)
  if (count > 0) return null
  return (
    <section className="empty" aria-labelledby="empty-title">
      <svg
        className="empty-ghost"
        viewBox="0 0 236 96"
        aria-hidden="true"
        focusable="false"
      >
        <rect className="empty-ghost__card empty-ghost__card--first" x="1" y="9" width="102" height="58" rx="8" />
        <rect className="empty-ghost__card empty-ghost__card--second" x="133" y="29" width="102" height="58" rx="8" />
        <path className="empty-ghost__wire" d="M 104 38 C 121 38 115 58 132 58" />
        <svg
          className="empty-ghost__asterisk"
          x="44"
          y="30"
          width="16"
          height="16"
          viewBox="0 0 24 24"
        >
          <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
        </svg>
      </svg>
      <h2 className="t-display" id="empty-title">{words.emptyTitle}</h2>
      <p className="t-hint">{words.emptyHint}</p>
      <Button className="empty__action" variant="primary" onClick={() => {
        addCard('note', { x: 0, y: 0 })
      }}>
        {words.addNote}
      </Button>
    </section>
  )
}
