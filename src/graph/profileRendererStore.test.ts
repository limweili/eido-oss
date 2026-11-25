// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT,
  PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT,
  type InstalledProfileBridge,
  type ProfileRendererAgentBarrierAck,
} from '../../electron/profileBridgeContract'
import { runCard } from '../brain/runEngine'
import { registerProfileAgentMutationBarrierHandler } from '../desktop/profileAgentMutationBarrier'
import { createSeedMod, listModPartIdentities, remapModPartIdentities } from '../mods'
import { createCompleteProfileFixture } from '../persistence/fixtures/profileLogicalProjectionFixture'
import { profileServiceFailure, type ProfileRecoveryPointSummary } from '../persistence/profileServiceContract'
import {
  createProfileRendererPersistence,
  ProfileRendererPersistenceError,
  type ProfileRendererHydration,
  type ProfileRendererPersistence,
  type ProfileRendererStateSink,
} from './profileRendererPersistence'
import type { ProfileModOriginCompanion } from './profileModOrigins'
import {
  applyProfileRendererSaveStatus,
  captureCurrentProfileRendererCommitState,
  configureGraphApiCredential,
  configureGraphPersistence,
  freezeProfileRendererMutationAdmissionForUpdate,
  profileRendererCheckpointPersistence,
  resetGraphPersistenceForTests,
  useGraph,
} from './store'
import type { InstalledKeychainBridge } from '../../electron/keychainBridgeContract'
import type { Card, IdeaSummary, SavedBoard } from './types'

const IDEA: IdeaSummary = {
  id: 'idea-main',
  name: 'Main Idea',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  lastOpenedAt: '2026-07-20T00:00:00.000Z',
}

function board(cards: Card[] = []): SavedBoard {
  return {
    version: 1,
    cards,
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
}

function v2ModCard(id: string): Card {
  return {
    id,
    kind: 'mod',
    blocks: [{ id: `block-${id}`, text: '' }],
    position: { x: 0, y: 0 },
    modV2: createSeedMod('slider', {
      createId: (role, ordinal) => `${id}-${role}-${ordinal}`,
    }),
  }
}

function hydration(input: Partial<ProfileRendererHydration> = {}): ProfileRendererHydration {
  const hydratedBoard = input.board ?? board()
  const idea = input.idea ?? IDEA
  return {
    intentActorId: input.intentActorId ?? 'actor-trusted-owner',
    idea,
    board: hydratedBoard,
    ideas: input.ideas ?? [idea],
    userModTemplates: input.userModTemplates ?? [],
    modOrigins: input.modOrigins ?? {},
  }
}

function fakePersistence(
  overrides: Partial<ProfileRendererPersistence> = {},
  applyHydrationOnConnect = true,
): ProfileRendererPersistence {
  const current = hydration()
  let sink: ProfileRendererStateSink | undefined
  const base: ProfileRendererPersistence = {
    connectStateSink: vi.fn((candidate) => {
      sink = candidate
    }),
    hydrate: vi.fn(async () => current),
    applyAuthoritativeSnapshot: vi.fn((snapshot) => ({
      status: 'applied' as const,
      revision: snapshot.revision,
    })),
    beginAuthoritativeMutation: vi.fn(async () => ({
      generation: 1,
      nativeGeneration: 1,
      revision: 2,
    })),
    sealAuthoritativeMutation: vi.fn(async () => ({
      generation: 1,
      nativeGeneration: 1,
      revision: 2,
    })),
    captureAuthoritativeMutationProgress: vi.fn(() => false),
    finishAuthoritativeMutation: vi.fn(async () => ({
      generation: 1,
      nativeGeneration: 1,
      revision: 2,
    })),
    stampModTemplate: vi.fn(() => {
      throw new Error('No stamped fixture was configured')
    }),
    schedule: vi.fn(() => 1),
    flush: vi.fn(async () => ({ generation: 1, nativeGeneration: 1, revision: 2 })),
    loadIdea: vi.fn(async () => current),
    createOrdinaryIdea: vi.fn(async () => current),
    renameCurrentIdea: vi.fn(async () => current),
    deleteIdea: vi.fn(async () => current),
    duplicateCurrentIdea: vi.fn(async () => ({
      receipt: {
        kind: 'duplicate-idea' as const,
        operationId: 'duplicate-operation',
        previousRevision: 1,
        revision: 2,
        targetIdeaId: current.idea.id,
        insertedRecordIds: [],
        importedAssetIds: [],
        replayed: false,
      },
      hydration: current,
    })),
    exportPortable: vi.fn(async () => ({ cancelled: true as const })),
    importIdeaClosure: vi.fn(async () => ({ cancelled: true as const })),
    inspectRecovery: vi.fn(async () => ({
      mode: 'inspect' as const,
      currentRevision: 1,
      candidates: [],
      rejectedCandidateIds: [],
      quarantinedCurrentState: false as const,
    })),
    restoreRecovery: vi.fn(async () => ({
      receipt: {
        mode: 'restore' as const,
        selectedCandidateId: 'candidate-1',
        rejectedCandidateIds: [],
        quarantinedCurrentState: true,
        previousRevision: 1,
        revision: 2,
      },
      hydration: current,
    })),
    startFreshProfile: vi.fn(async () => ({
      receipt: {
        mode: 'start-fresh' as const,
        operationId: 'start-fresh-operation',
        previousRevision: 1,
        profileId: 'profile-fresh',
        revision: 0,
        quarantinedCurrentState: true,
      },
      hydration: current,
    })),
  }
  const merged = { ...base, ...overrides }
  const configuredConnect = merged.connectStateSink
  return {
    ...merged,
    connectStateSink: vi.fn((candidate) => {
      sink = candidate
      if (configuredConnect !== base.connectStateSink) configuredConnect(candidate)
      if (applyHydrationOnConnect) candidate.applyHydration(current)
    }),
    hydrate: vi.fn(async () => {
      const value = await merged.hydrate()
      sink?.applyHydration(value)
      sink?.admitHydration()
      return value
    }),
    duplicateCurrentIdea: vi.fn(async (name) => {
      const value = await merged.duplicateCurrentIdea(name)
      sink?.applyHydration(value.hydration)
      sink?.admitHydration()
      return value
    }),
    importIdeaClosure: vi.fn(async (request) => {
      const value = await merged.importIdeaClosure(request)
      if (!('cancelled' in value)) {
        sink?.applyHydration(value.hydration)
        sink?.admitHydration()
      }
      return value
    }),
    restoreRecovery: vi.fn(async (candidateId) => {
      const value = await merged.restoreRecovery(candidateId)
      sink?.applyHydration(value.hydration)
      sink?.admitHydration()
      return value
    }),
  }
}

function configure(persistence: ProfileRendererPersistence): void {
  configureGraphPersistence({ kind: 'packaged-profile', persistence })
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    highlights: [],
    highlightTags: [],
    compactionSummaries: [],
    intentLog: [],
    ideas: [IDEA],
    currentIdeaId: IDEA.id,
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    hydrated: true,
    saveState: 'saved',
    profileStartupState: 'ready',
    profileStartupError: null,
    recoveryCandidates: [],
    restoringRecoveryCandidateId: null,
    settings: { ...useGraph.getState().settings },
  })
}

describe('installed Profile store wiring', () => {
  beforeEach(() => {
    resetGraphPersistenceForTests()
    localStorage.clear()
  })

  afterEach(() => {
    resetGraphPersistenceForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rejects user mutation after the terminal update seal freezes admission', () => {
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }))
    const before = useGraph.getState().cards

    freezeProfileRendererMutationAdmissionForUpdate()
    useGraph.getState().addCard('note', { x: 20, y: 30 })

    expect(useGraph.getState().cards).toEqual(before)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('uses the hydrated actor for sequential packaged commits without consulting localStorage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }))

    useGraph.getState().addCard('note', { x: 20, y: 30 })
    useGraph.getState().addCard('note', { x: 40, y: 50 })

    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(schedule).toHaveBeenCalledTimes(2)
    expect(schedule.mock.calls.map(([state]) => {
      const intentLog = state.board.intentLog
      return intentLog?.[intentLog.length - 1]?.actorId
    })).toEqual(['actor-trusted-owner', 'actor-trusted-owner'])
  })

  it('hydrates native idea.create with device defaults plus the active selected identity', async () => {
    const created = hydration({
      idea: { ...IDEA, id: 'idea-created-native' },
      board: board(),
      ideas: [{ ...IDEA, id: 'idea-created-native' }],
    })
    const createOrdinaryIdea = vi.fn(async () => created)
    configure(fakePersistence({ createOrdinaryIdea }))
    const selected = 'vendor/active-selected'
    useGraph.setState((state) => ({
      settings: {
        ...state.settings,
        provider: 'openrouter',
        model: selected,
        models: [selected],
        providerModels: {
          ...state.settings.providerModels!,
          openrouter: { model: selected, models: [selected] },
        },
        recommendedModelCatalog: ['openai/gpt-5.6-luna', 'google/gemini-3.7-flash'],
        recommendedModelCatalogExplicit: false,
      },
    }))

    await useGraph.getState().createIdea('Native defaults')

    expect(createOrdinaryIdea).toHaveBeenCalledWith('Native defaults')
    expect(useGraph.getState().settings.model).toBe(selected)
    expect(useGraph.getState().settings.models).toEqual([
      'openai/gpt-5.6-luna',
      'google/gemini-3.7-flash',
      selected,
    ])
    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual([
      'openai/gpt-5.6-luna',
      'google/gemini-3.7-flash',
    ])
  })

  it('keeps packaged text input off the synchronous whole-Profile capture path', async () => {
    vi.useFakeTimers()
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    const flush = vi.fn<ProfileRendererPersistence['flush']>(async () => ({
      generation: 1,
      nativeGeneration: 1,
      revision: 2,
    }))
    configure(fakePersistence({ schedule, flush }))

    const totalCharacters = 135_000
    const cardCount = 27
    const textPerCard = Math.floor(totalCharacters / cardCount)
    const cards = Array.from({ length: cardCount }, (_, index): Card => ({
      id: `typing-latency-note-${index}`,
      kind: 'note',
      blocks: [{
        id: `typing-latency-block-${index}`,
        text: 'x'.repeat(index === cardCount - 1
          ? totalCharacters - textPerCard * (cardCount - 1)
          : textPerCard),
      }],
      position: { x: index * 20, y: index * 20 },
    }))
    const group: Card = {
      id: 'typing-latency-group',
      kind: 'group',
      title: 'Research group',
      blocks: [{ id: 'typing-latency-group-block', text: '' }],
      compressionPrompt: 'Initial compression prompt',
      position: { x: 800, y: 800 },
    }
    useGraph.setState({ cards: [...cards, group] })

    useGraph.getState().setCardText(cards[0]!.id, `${cards[0]!.blocks[0]!.text}a`)
    useGraph.getState().setCardText(cards[0]!.id, `${cards[0]!.blocks[0]!.text}ab`)
    useGraph.getState().setCardTitle(cards[0]!.id, 'Edited title')
    useGraph.getState().setGroupCompressionPrompt(group.id, 'Edited compression prompt')

    // The installed persistence adapter validates and clones the complete
    // Profile projection. Doing that inline here makes each keystroke scale
    // with unrelated Board content.
    expect(schedule).not.toHaveBeenCalled()

    await vi.advanceTimersToNextFrame()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(schedule.mock.calls[0]?.[0].board.cards[0]?.blocks[0]?.text).toBe(
      `${cards[0]!.blocks[0]!.text}ab`,
    )
    expect(schedule.mock.calls[0]?.[0].board.cards[0]?.title).toBe('Edited title')
    expect(schedule.mock.calls[0]?.[0].board.cards.find((card) => card.id === group.id)).toMatchObject({
      compressionPrompt: 'Edited compression prompt',
    })

    useGraph.getState().setCardText(cards[0]!.id, `${cards[0]!.blocks[0]!.text}abc`)
    useGraph.getState().recordCardContentEdited(cards[0]!.id)
    // Blur records its narrative Intent immediately, but it does not force a
    // whole-Profile capture while the user may already be interacting with
    // another Card.
    expect(schedule).toHaveBeenCalledTimes(1)
    const intentLog = useGraph.getState().intentLog
    expect(intentLog[intentLog.length - 1]).toMatchObject({
      type: 'card.content.edited',
      cardId: cards[0]!.id,
    })
    await vi.advanceTimersToNextFrame()
    await vi.advanceTimersByTimeAsync(2_999)
    expect(schedule).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(schedule).toHaveBeenCalledTimes(2)
    expect(schedule.mock.calls[1]?.[0].board.cards[0]?.blocks[0]?.text).toBe(
      `${cards[0]!.blocks[0]!.text}abc`,
    )

    useGraph.getState().setCardText(cards[0]!.id, `${cards[0]!.blocks[0]!.text}abcd`)
    const checkpoint = profileRendererCheckpointPersistence().flush()
    await vi.runAllTimersAsync()
    await checkpoint

    // Quit/checkpoint and other explicit durability boundaries still capture
    // the latest text immediately instead of waiting for the debounce.
    expect(schedule).toHaveBeenCalledTimes(3)
    expect(schedule.mock.calls[2]?.[0].board.cards[0]?.blocks[0]?.text).toBe(
      `${cards[0]!.blocks[0]!.text}abcd`,
    )
    expect(flush).toHaveBeenCalledOnce()
  })

  it('captures alternating text and geometry once after three seconds of global quiet', async () => {
    vi.useFakeTimers()
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }))

    const card: Card = {
      id: 'alternating-card',
      kind: 'note',
      blocks: [{ id: 'alternating-block', text: 'initial' }],
      position: { x: 0, y: 0 },
    }
    useGraph.setState({ cards: [card] })

    useGraph.getState().setCardText(card.id, 'first text')
    await vi.advanceTimersToNextFrame()
    await vi.advanceTimersByTimeAsync(2_000)

    const beforeMove = structuredClone(useGraph.getState().cards)
    useGraph.getState().moveCard(card.id, { x: 120, y: 180 }, { recordHistory: false })
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      beforeMove,
      useGraph.getState().cards,
    )
    await vi.advanceTimersToNextFrame()
    await vi.advanceTimersByTimeAsync(2_000)

    useGraph.getState().setCardText(card.id, 'latest text')
    await vi.advanceTimersToNextFrame()
    applyProfileRendererSaveStatus('saved')

    // Queued work is not a write. The indicator only claims "Saving" once
    // the writer starts, so the quiet window keeps the last real status.
    expect(useGraph.getState().saveState).not.toBe('saving')
    await vi.advanceTimersByTimeAsync(2_999)
    expect(schedule).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(schedule).toHaveBeenCalledOnce()
    expect(schedule.mock.calls[0]![0].board.cards[0]).toEqual(
      expect.objectContaining({
        position: { x: 120, y: 180 },
        blocks: [expect.objectContaining({ text: 'latest text' })],
      }),
    )
  })

  it('coalesces packaged Card gesture summaries until after the release paint', async () => {
    // This Vitest version has an allow-list rather than `doNotFake`: keep the
    // timer/rAF controls synthetic while leaving the real performance clock
    // (and hrtime) available to the release-boundary assertion.
    vi.useFakeTimers({
      toFake: [
        'setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate',
        'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
      ],
    })
    let releaseBoundaryPassed = false
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => {
      // Positive control for the timing assertion below: if strict Profile
      // capture is moved back into release, this synthetic deep-capture cost
      // makes the real-clock gate fail. The actual deferred call happens only
      // after the boundary and therefore does not pay this control cost.
      if (!releaseBoundaryPassed) {
        const startedAt = performance.now()
        while (performance.now() - startedAt < 60) {
          // Deliberately model the expensive whole-Profile walk in this
          // disposable test seam; production code never busy-waits.
        }
      }
      return 1
    })
    configure(fakePersistence({ schedule }))

    const fixture = createCompleteProfileFixture()
    const fixtureBoard = fixture.snapshot.boards[fixture.snapshot.activeIdeaId]!
    const resultCard = structuredClone(fixtureBoard.cards.find((card) => card.kind === 'result')!)
    const resultOutput = structuredClone(
      fixtureBoard.outputs.find((output) => output.resultCardId === resultCard.id)!,
    )
    resultOutput.versions[0]!.text = 'x'.repeat(1_000_000)
    useGraph.setState({ cards: [resultCard], outputs: [resultOutput] })

    const firstStart = structuredClone(useGraph.getState().cards)
    const releaseStartedAt = performance.now()
    useGraph.getState().moveCard(resultCard.id, { x: 180, y: 210 }, { recordHistory: false })
    const firstEnd = structuredClone(useGraph.getState().cards)
    useGraph.getState().recordCardStructuralChange('moveCard', firstStart, firstEnd)

    const secondStart = structuredClone(useGraph.getState().cards)
    useGraph.getState().moveCard(resultCard.id, { x: 260, y: 310 }, { recordHistory: false })
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      secondStart,
      useGraph.getState().cards,
    )

    // The release path only records bounded geometry/history data. It must not
    // synchronously walk the retained million-character Profile projection.
    expect(performance.now() - releaseStartedAt).toBeLessThan(50)
    releaseBoundaryPassed = true

    // The gesture-end call remains independent of retained Result size because
    // the strict whole-Profile capture has not started on the pointer-up task.
    expect(schedule).not.toHaveBeenCalled()

    await vi.advanceTimersToNextFrame()
    expect(schedule).not.toHaveBeenCalled()
    await vi.runOnlyPendingTimersAsync()

    expect(schedule).toHaveBeenCalledOnce()
    expect(schedule.mock.calls[0]![0].board.cards[0]!.position).toEqual({ x: 260, y: 310 })
    expect(schedule.mock.calls[0]![0].board.outputs[0]!.versions[0]!.text).toHaveLength(1_000_000)
  })

  it('keeps a completed gesture capture alive across interrupted follow-on progress', async () => {
    vi.useFakeTimers()
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }))

    const card: Card = {
      id: 'interrupted-gesture-card',
      kind: 'note',
      blocks: [{ id: 'interrupted-gesture-block', text: 'final' }],
      position: { x: 0, y: 0 },
    }
    useGraph.setState({ cards: [card] })
    const completedBefore = structuredClone(useGraph.getState().cards)
    useGraph.getState().moveCard(card.id, { x: 120, y: 180 }, { recordHistory: false })
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      completedBefore,
      useGraph.getState().cards,
    )
    expect(schedule).not.toHaveBeenCalled()

    // A second gesture begins, then is interrupted before its own summary.
    // These renderer-local progress writes must not cancel the completed
    // gesture's pending capture.
    useGraph.getState().moveCard(card.id, { x: 240, y: 300 }, { recordHistory: false })
    useGraph.getState().moveCard(card.id, { x: 120, y: 180 }, { recordHistory: false })

    await vi.advanceTimersToNextFrame()
    await vi.runOnlyPendingTimersAsync()

    expect(schedule).toHaveBeenCalledOnce()
    expect(schedule.mock.calls[0]![0].board.cards[0]!.position).toEqual({ x: 120, y: 180 })
  })

  it('uses the global quiet period when the renderer has no rAF scheduler', async () => {
    vi.useFakeTimers()
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }))

    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', undefined)
    try {
      const card: Card = {
        id: 'fallback-gesture-card',
        kind: 'note',
        blocks: [{ id: 'fallback-gesture-block', text: 'final' }],
        position: { x: 0, y: 0 },
      }
      useGraph.setState({ cards: [card] })
      const before = structuredClone(useGraph.getState().cards)
      useGraph.getState().moveCard(card.id, { x: 120, y: 180 }, { recordHistory: false })
      useGraph.getState().recordCardStructuralChange(
        'moveCard',
        before,
        useGraph.getState().cards,
      )

      expect(schedule).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_999)
      expect(schedule).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(schedule).toHaveBeenCalledOnce()
      expect(schedule.mock.calls[0]![0].board.cards[0]!.position).toEqual({ x: 120, y: 180 })
    } finally {
      vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame)
    }
  })

  it('cancels deferred gesture capture when an immediate mutation is committed', async () => {
    vi.useFakeTimers()
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }))

    const card: Card = {
      id: 'immediate-cancel-card',
      kind: 'note',
      blocks: [{ id: 'immediate-cancel-block', text: 'final' }],
      position: { x: 0, y: 0 },
    }
    useGraph.setState({ cards: [card] })
    const before = structuredClone(useGraph.getState().cards)
    useGraph.getState().moveCard(card.id, { x: 120, y: 180 }, { recordHistory: false })
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      before,
      useGraph.getState().cards,
    )
    expect(schedule).not.toHaveBeenCalled()

    const addedCardId = useGraph.getState().addCard('note', { x: 300, y: 340 })
    expect(schedule).toHaveBeenCalledOnce()
    expect(schedule.mock.calls[0]![0].board.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: card.id, position: { x: 120, y: 180 } }),
        expect.objectContaining({ id: addedCardId }),
      ]),
    )

    await vi.advanceTimersByTimeAsync(3_000)
    await vi.runOnlyPendingTimersAsync()
    expect(schedule).toHaveBeenCalledOnce()
  })

  it('flushes deferred Card gesture geometry exactly at a Profile checkpoint', async () => {
    vi.useFakeTimers()
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    const flush = vi.fn<ProfileRendererPersistence['flush']>(async () => ({
      generation: 1,
      nativeGeneration: 1,
      revision: 2,
    }))
    configure(fakePersistence({ schedule, flush }))

    const fixture = createCompleteProfileFixture()
    const fixtureBoard = fixture.snapshot.boards[fixture.snapshot.activeIdeaId]!
    const resultCard = structuredClone(fixtureBoard.cards.find((card) => card.kind === 'result')!)
    const resultOutput = structuredClone(
      fixtureBoard.outputs.find((output) => output.resultCardId === resultCard.id)!,
    )
    resultOutput.versions[0]!.text = 'x'.repeat(1_000_000)
    useGraph.setState({ cards: [resultCard], outputs: [resultOutput] })

    const dragStart = structuredClone(useGraph.getState().cards)
    useGraph.getState().moveCard(resultCard.id, { x: 640, y: 480 }, { recordHistory: false })
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      dragStart,
      useGraph.getState().cards,
    )
    expect(schedule).not.toHaveBeenCalled()

    const checkpoint = profileRendererCheckpointPersistence().flush()
    expect(schedule).toHaveBeenCalledOnce()
    await checkpoint
    await vi.runAllTimersAsync()

    expect(schedule.mock.calls[0]![0].board.cards[0]!.position).toEqual({ x: 640, y: 480 })
    expect(schedule.mock.calls[0]![0].board.outputs[0]!.versions[0]!.text).toHaveLength(1_000_000)
    expect(schedule).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('saves a real Ask result through the strict packaged Profile capture', async () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = structuredClone(fixture.snapshot)
    const idea = snapshot.ideas.find((candidate) => candidate.id === 'idea-main')!
    const ask = snapshot.boards[idea.id]!.cards.find((card) => card.kind === 'askAi')!
    snapshot.boards[idea.id] = {
      version: 1,
      cards: [ask],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      updatedAt: '2026-07-20T00:00:00.000Z',
    }
    snapshot.modInstances = []

    let nativeGeneration = 0
    let nativeRevision = snapshot.revision
    const commitGuiProjection = vi.fn(async (
      _projection: Parameters<InstalledProfileBridge['commitGuiProjection']>[0],
    ) => {
      nativeGeneration += 1
      nativeRevision += 1
      return {
        ok: true as const,
        value: {
          generation: nativeGeneration,
          revision: nativeRevision,
          durable: true as const,
          dirty: false as const,
        },
      }
    })
    const unavailable = vi.fn(async () => {
      throw new Error('not used')
    })
    const bridge = {
      runtimeProbe: unavailable,
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: {
          intentActorId: 'actor-trusted-owner',
          snapshot,
          acknowledgement: { epoch: 'epoch-ask-result', revision: snapshot.revision },
        },
      })),
      ackHydration: vi.fn(async (epoch: string, revision: number) => ({
        ok: true as const,
        value: { acknowledged: true as const, epoch, revision },
      })),
      commitGuiProjection,
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
      createOrdinaryIdea: unavailable,
      confirmRevision: unavailable,
      status: unavailable,
      capabilities: unavailable,
      query: unavailable,
      exportPortable: unavailable,
      duplicateIdea: unavailable,
      importIdeaClosure: unavailable,
      inspectRecovery: unavailable,
      restoreRecovery: unavailable,
    } as unknown as InstalledProfileBridge
    const persistence = createProfileRendererPersistence(bridge)
    configureGraphPersistence({ kind: 'packaged-profile', persistence })
    useGraph.setState({ hydrated: false, profileStartupState: 'idle' })

    await useGraph.getState().hydrate()
    useGraph.setState((state) => ({
      settings: { ...state.settings, apiKey: 'synthetic-key', model: 'synthetic/model' },
    }))
    const outcome = await runCard(ask.id, {
      stream: async (_prompt, options) => {
        options.onChunk('Synthetic answer')
        return 'Synthetic answer'
      },
    })
    await persistence.flush()

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(useGraph.getState().saveState).toBe('saved')
    expect(commitGuiProjection).toHaveBeenCalled()
    expect(commitGuiProjection.mock.calls[commitGuiProjection.mock.calls.length - 1]![0].boardReplacements[idea.id])
      .toMatchObject({ outputs: [{ versions: [{ text: 'Synthetic answer' }] }] })
  })

  it('preserves a streamed chunk that arrives after a live Agent barrier begins', async () => {
    const fixture = createCompleteProfileFixture()
    const initial = structuredClone(fixture.snapshot)
    const ideaId = initial.activeIdeaId
    const initialBoard = initial.boards[ideaId]!
    const version = initialBoard.outputs[0]!.versions[0]!
    const streamedChunk = ' streamed after begin'
    let currentSnapshot = initial
    let nativeGeneration = 0
    let nativeRevision = initial.revision
    const submitted: Parameters<InstalledProfileBridge['commitGuiProjection']>[0][] = []
    const unavailable = vi.fn(async () => {
      throw new Error('not used')
    })
    const bridge = {
      runtimeProbe: unavailable,
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: {
          intentActorId: 'actor-trusted-owner',
          snapshot: currentSnapshot,
          acknowledgement: {
            epoch: `epoch-${currentSnapshot.revision}`,
            revision: currentSnapshot.revision,
          },
        },
      })),
      ackHydration: vi.fn(async (epoch: string, revision: number) => ({
        ok: true as const,
        value: { acknowledged: true as const, epoch, revision },
      })),
      commitGuiProjection: vi.fn(async (
        projection: Parameters<InstalledProfileBridge['commitGuiProjection']>[0],
      ) => {
        submitted.push(projection)
        nativeGeneration += 1
        nativeRevision += 1
        return {
          ok: true as const,
          value: {
            generation: nativeGeneration,
            revision: nativeRevision,
            durable: true as const,
            dirty: false as const,
          },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
      createOrdinaryIdea: unavailable,
      confirmRevision: unavailable,
      status: unavailable,
      capabilities: unavailable,
      query: unavailable,
      exportPortable: unavailable,
      duplicateIdea: unavailable,
      importIdeaClosure: unavailable,
      inspectRecovery: unavailable,
      restoreRecovery: unavailable,
    } as unknown as InstalledProfileBridge
    const persistence = createProfileRendererPersistence(bridge)
    configureGraphPersistence({ kind: 'packaged-profile', persistence })
    useGraph.setState({ hydrated: false, profileStartupState: 'idle' })
    await useGraph.getState().hydrate()

    const target = new EventTarget()
    const acknowledgements: ProfileRendererAgentBarrierAck[] = []
    const terminalFailures: Error[] = []
    target.addEventListener(PROFILE_RENDERER_AGENT_BARRIER_ACK_EVENT, (event) => {
      acknowledgements.push((event as CustomEvent<ProfileRendererAgentBarrierAck>).detail)
    })
    const dispose = registerProfileAgentMutationBarrierHandler(
      target,
      bridge,
      persistence,
      captureCurrentProfileRendererCommitState,
      {
        maxApplyAttempts: 1,
        waitForRetry: async () => undefined,
        onTerminalFailure: (error) => terminalFailures.push(error),
      },
    )

    target.dispatchEvent(new CustomEvent(PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT, {
      detail: { token: 'stream-race', phase: 'begin' },
    }))
    await vi.waitFor(() => expect(acknowledgements.find((candidate) => (
      candidate.token === 'stream-race' && candidate.phase === 'begin' && candidate.ok
    ))).toBeDefined())
    const began = acknowledgements.find((candidate) => (
      candidate.token === 'stream-race' && candidate.phase === 'begin' && candidate.ok
    ))
    if (!began || began.phase !== 'begin' || !began.ok) {
      throw new Error('Synthetic live Agent barrier did not begin')
    }

    useGraph.getState().appendVersionText(version.id, streamedChunk)
    const agentCard: Card = {
      id: 'card-agent-after-stream',
      kind: 'note',
      position: { x: 800, y: 100 },
      blocks: [{ id: 'block-agent-after-stream', text: 'Agent mutation' }],
      createdBy: { kind: 'agent', client: 'codex', sessionId: 'synthetic-live' },
      lastModifiedBy: { kind: 'agent', client: 'codex', sessionId: 'synthetic-live' },
    }
    nativeGeneration += 1
    nativeRevision = began.revision + 1
    currentSnapshot = {
      ...initial,
      revision: nativeRevision,
      boards: {
        ...initial.boards,
        [ideaId]: {
          ...initialBoard,
          cards: [...initialBoard.cards, agentCard],
          updatedAt: '2026-07-22T00:01:00.000Z',
        },
      },
    }
    target.dispatchEvent(new CustomEvent(PROFILE_RENDERER_AGENT_BARRIER_REQUEST_EVENT, {
      detail: { token: 'stream-race', phase: 'complete', revision: currentSnapshot.revision },
    }))
    await vi.waitFor(() => expect(acknowledgements.some((candidate) => (
      candidate.token === 'stream-race' && candidate.phase === 'complete'
    ))).toBe(true))

    expect(acknowledgements).toContainEqual({
      token: 'stream-race', phase: 'complete', ok: true,
    })
    expect(terminalFailures).toEqual([])
    expect(useGraph.getState().outputs[0]!.versions[0]!.text).toBe(
      `${version.text}${streamedChunk}`,
    )
    expect(useGraph.getState().cards).toContainEqual(agentCard)
    const finalSubmittedBoard = submitted[submitted.length - 1]!.boardReplacements[ideaId]!
    expect(finalSubmittedBoard.cards).toContainEqual(agentCard)
    expect(finalSubmittedBoard.outputs
      .flatMap((output) => output.versions)
      .find((candidate) => candidate.id === version.id)?.text).toBe(
      `${version.text}${streamedChunk}`,
    )
    dispose()
  })

  it('hydrates and writes the packaged API key only through the protected bridge', async () => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({
      apiKey: 'sk-legacy',
      theme: 'dark',
    }))
    const bridge: InstalledKeychainBridge = {
      get: vi.fn(async () => ({ ok: true, value: { apiKey: 'sk-protected' } } as const)),
      set: vi.fn(async () => ({ ok: true, value: { stored: true } } as const)),
      clear: vi.fn(async () => ({ ok: true, value: { cleared: true } } as const)),
      migrateLegacy: vi.fn(async () => ({ ok: true, value: { migrated: true } } as const)),
    }
    configure(fakePersistence())

    await configureGraphApiCredential('packaged-profile', bridge, localStorage)

    expect(bridge.migrateLegacy).toHaveBeenCalledWith('sk-legacy')
    expect(useGraph.getState().settings.apiKey).toBe('sk-protected')
    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')).toEqual({ theme: 'dark' })
    // The retired search key (ADR 0034) is no longer addressable from the
    // renderer at all: startup asks the keychain for nothing but its own keys.
    expect(bridge.clear).not.toHaveBeenCalled()

    await useGraph.getState().setApiKey('sk-next')
    expect(bridge.set).toHaveBeenCalledWith('sk-next')
    expect(useGraph.getState().settings.apiKey).toBe('sk-next')

    await useGraph.getState().setApiKey('')
    expect(bridge.clear).toHaveBeenCalledWith()
    expect(useGraph.getState().settings.apiKey).toBe('')
    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')).toEqual({ theme: 'dark' })
  })

  it('installs the hydrated actor before a ready observer can commit', async () => {
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }, false))
    useGraph.setState({
      cards: [],
      intentLog: [],
      hydrated: false,
      profileStartupState: 'idle',
    })
    const unsubscribe = useGraph.subscribe((state, previous) => {
      if (previous.profileStartupState !== 'ready' && state.profileStartupState === 'ready') {
        state.addCard('note', { x: 20, y: 30 })
      }
    })

    await useGraph.getState().hydrate()
    unsubscribe()

    expect(schedule).toHaveBeenCalledOnce()
    const intentLog = schedule.mock.calls[0]![0].board.intentLog
    expect(intentLog?.[intentLog.length - 1]?.actorId).toBe('actor-trusted-owner')
  })

  it.each([
    ['whitespace', '   '],
    ['multibyte byte overflow', 'é'.repeat(257)],
  ])('rejects a %s actor before applying or admitting native hydration', (_case, intentActorId) => {
    let sink: ProfileRendererStateSink | undefined
    configure(fakePersistence({
      connectStateSink: vi.fn((candidate) => {
        sink = candidate
      }),
    }, false))
    useGraph.setState({ hydrated: false, profileStartupState: 'loading' })

    expect(() => sink!.applyHydration(hydration({ intentActorId }))).toThrow(
      'Packaged Profile Intent actor identity is invalid',
    )
    expect(useGraph.getState()).toMatchObject({
      hydrated: false,
      profileStartupState: 'loading',
    })
  })

  it('schedules packaged mutations immediately and restages the exact direct origin on reintroduction', () => {
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }))

    const source = v2ModCard('mod-source-reintroduction')
    useGraph.setState({ cards: [source] })
    const [cardId] = useGraph.getState().duplicateCard(source.id)
    const firstOrigin = schedule.mock.calls[0]![0].newModOrigins[cardId!]

    expect(firstOrigin).toMatchObject({ kind: 'direct', instanceId: expect.any(String) })
    expect(schedule.mock.calls[0]![0].board.cards.some((card) => card.id === cardId)).toBe(true)

    useGraph.getState().undo()
    expect(schedule.mock.calls[1]![0].newModOrigins).toEqual({})
    useGraph.getState().redo()
    expect(schedule.mock.calls[2]![0].newModOrigins[cardId!]).toBe(firstOrigin)

    useGraph.getState().deleteCard(cardId)
    expect(schedule.mock.calls[3]![0].newModOrigins).toEqual({})
    useGraph.getState().undo()
    expect(schedule.mock.calls[4]![0].newModOrigins[cardId!]).toBe(firstOrigin)
  })

  it.each([
    ['direct', { kind: 'direct', instanceId: 'mod-instance-native-existing' } as const],
    ['stamped', {
      kind: 'stamped',
      instanceId: 'mod-instance-native-existing',
      sourceTemplateId: 'template-native',
      sourceTemplateVersion: 4,
      sourceToInstanceIdMap: {
        mod: { sourceId: 'template-native', instanceId: 'mod-instance-native-existing' },
        controls: [
          { sourceId: 'template-item-0', instanceId: 'native-item-0' },
          { sourceId: 'template-item-1', instanceId: 'native-item-1' },
        ],
      },
    } as const],
  ])('restages a %s Mod origin loaded from native state after delete and undo', (_kind, origin) => {
    let sink: ProfileRendererStateSink | undefined
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({
      schedule,
      connectStateSink: vi.fn((candidate) => {
        sink = candidate
      }),
    }))
    const loadedCard: Card = {
      id: 'card-native-existing',
      kind: 'mod',
      blocks: [{ id: 'block-native-existing', text: '' }],
      position: { x: 0, y: 0 },
      modV2: createSeedMod('slider', {
        createId: (role, ordinal) => `native-${role}-${ordinal}`,
      }),
    }
    sink!.applyHydration(hydration({
      board: board([loadedCard]),
      modOrigins: { [loadedCard.id]: origin },
    }))

    useGraph.getState().deleteCard(loadedCard.id)
    expect(schedule.mock.calls[0]![0].newModOrigins).toEqual({})
    useGraph.getState().undo()

    expect(schedule.mock.calls[1]![0].newModOrigins[loadedCard.id]).toBe(origin)
  })

  it('revokes packaged mutation admission immediately on an explicit terminal projection', () => {
    let sink: ProfileRendererStateSink | undefined
    configure(fakePersistence({
      connectStateSink: vi.fn((candidate) => {
        sink = candidate
      }),
    }))

    sink!.applyTerminalFailure({
      kind: 'terminal',
      error: new ProfileRendererPersistenceError('synthetic utility loss'),
    })

    expect(useGraph.getState()).toMatchObject({
      hydrated: false,
      profileStartupState: 'failed',
      saveState: 'failed',
    })
    expect(useGraph.getState().addCard('note', { x: 0, y: 0 })).toBeTruthy()
    expect(useGraph.getState().cards).toEqual([])
  })

  it('keeps a staged origin until the quiet capture schedule accepts', async () => {
    vi.useFakeTimers()
    const captured: Parameters<ProfileRendererPersistence['schedule']>[0][] = []
    const schedule = vi.fn((state: Parameters<ProfileRendererPersistence['schedule']>[0]) => {
      captured.push(state)
      if (captured.length === 1) throw new Error('synthetic admission failure')
      return captured.length
    })
    configure(fakePersistence({ schedule }))

    const source = v2ModCard('mod-source-retry')
    useGraph.setState({ cards: [source] })
    const [cardId] = useGraph.getState().duplicateCard(source.id)
    expect(useGraph.getState().saveState).toBe('failed')

    useGraph.getState().setCardTitle(cardId!, 'Accepted on retry')
    expect(captured).toHaveLength(1)

    await vi.advanceTimersToNextFrame()
    await vi.advanceTimersByTimeAsync(3_000)

    expect(captured[1]!.newModOrigins[cardId!]).toMatchObject({
      kind: 'direct',
      instanceId: expect.any(String),
    })
  })

  it('captures duplicate and paste Mods as fresh direct instances', () => {
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    configure(fakePersistence({ schedule }))
    const semanticProjection = (mod: NonNullable<Card['modV2']>) => (
      remapModPartIdentities(mod, ({ ordinal }) => `semantic-part-${ordinal}`).value
    )
    const source: Card = {
      id: 'mod-card-source',
      kind: 'mod',
      blocks: [{ id: 'block-source', text: '' }],
      position: { x: 0, y: 0 },
      modV2: createSeedMod('slider', {
        title: 'SOURCE',
        createId: (role, ordinal) => `source-${role}-${ordinal}`,
      }),
    }
    useGraph.setState({ cards: [source] })
    const sourcePartIds = new Set(
      listModPartIdentities(source.modV2!).map(({ sourceId }) => sourceId),
    )

    const [duplicateId] = useGraph.getState().duplicateCard(source.id)
    const duplicate = useGraph.getState().cards.find((card) => card.id === duplicateId)!
    const duplicateCommit = schedule.mock.calls[schedule.mock.calls.length - 1]![0]
    const duplicatePartIds = listModPartIdentities(duplicate.modV2!).map(({ sourceId }) => sourceId)
    expect(semanticProjection(duplicate.modV2!)).toEqual(semanticProjection(source.modV2!))
    expect(duplicatePartIds).not.toHaveLength(0)
    expect(duplicatePartIds.every((id) => !sourcePartIds.has(id))).toBe(true)
    expect(duplicateCommit.newModOrigins[duplicate.id]).toMatchObject({
      kind: 'direct',
      instanceId: expect.any(String),
    })

    useGraph.getState().copyCards([source.id])
    const [pasteId] = useGraph.getState().pasteCards({ x: 300, y: 200 })
    const pasted = useGraph.getState().cards.find((card) => card.id === pasteId)!
    const pasteCommit = schedule.mock.calls[schedule.mock.calls.length - 1]![0]
    const usedPartIds = new Set([...sourcePartIds, ...duplicatePartIds])
    const pastedPartIds = listModPartIdentities(pasted.modV2!).map(({ sourceId }) => sourceId)
    expect(semanticProjection(pasted.modV2!)).toEqual(semanticProjection(source.modV2!))
    expect(pastedPartIds).not.toHaveLength(0)
    expect(pastedPartIds.every((id) => !usedPartIds.has(id))).toBe(true)
    expect(pasteCommit.newModOrigins[pasted.id]).toMatchObject({
      kind: 'direct',
      instanceId: expect.any(String),
    })
  })

  it('uses the native template stamp and never writes the packaged Mod catalog to localStorage', () => {
    const stampedMod = createSeedMod('pad', {
      title: 'STAMPED',
      createId: (role, ordinal) => `stamped-${role}-${ordinal}`,
    })
    const stampedParts = listModPartIdentities(stampedMod)
    const companion: ProfileModOriginCompanion = Object.freeze({
      mod: stampedMod,
      origin: Object.freeze({
        kind: 'stamped',
        instanceId: 'mod-instance-stamped',
        sourceTemplateId: 'template-native',
        sourceTemplateVersion: 4,
        sourceToInstanceIdMap: {
          mod: { sourceId: 'template-native', instanceId: 'mod-instance-stamped' },
          controls: stampedParts.map((part) => ({
            sourceId: `template-${part.role}-${part.ordinal}`,
            instanceId: part.sourceId,
          })),
        },
      }),
    })
    const schedule = vi.fn<ProfileRendererPersistence['schedule']>(() => 1)
    const stampModTemplate = vi.fn(() => companion)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    configure(fakePersistence({ schedule, stampModTemplate }))

    const cardId = useGraph.getState().addModFromLibrary('template-native', { x: 40, y: 50 })

    expect(cardId).toBeTruthy()
    expect(stampModTemplate).toHaveBeenCalledWith('template-native')
    expect(schedule.mock.calls[0]![0].newModOrigins[cardId!]).toBe(companion.origin)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('settles and schedules the source Board before native Duplicate enters lifecycle preflush', async () => {
    const order: string[] = []
    const targetIdea = { ...IDEA, id: 'idea-copy', name: 'Main Idea copy' }
    const settledTarget = hydration({ idea: targetIdea, ideas: [IDEA, targetIdea] })
    const schedule = vi.fn((state: Parameters<ProfileRendererPersistence['schedule']>[0]) => {
      order.push(`schedule:${state.board.outputs[0]?.versions[0]?.followUpThread?.messages[0]?.status}`)
      return 1
    })
    const duplicateCurrentIdea = vi.fn(async () => {
      order.push('duplicate')
      return {
        receipt: {
          kind: 'duplicate-idea' as const,
          operationId: 'duplicate-operation',
          previousRevision: 1,
          revision: 2,
          targetIdeaId: targetIdea.id,
          insertedRecordIds: [],
          importedAssetIds: [],
          replayed: false,
        },
        hydration: settledTarget,
      }
    })
    configure(fakePersistence({ schedule, duplicateCurrentIdea }))
    useGraph.setState({
      outputs: [{
        id: 'output-1',
        resultCardId: 'result-1',
        chosenVersionId: 'version-1',
        versions: [{
          id: 'version-1',
          number: 1,
          text: 'Partial',
          createdAt: '2026-07-20T00:00:00.000Z',
          fromRunId: 'run-1',
          followUpThread: {
            messages: [{
              id: 'message-1',
              role: 'assistant',
              text: 'Still writing',
              createdAt: '2026-07-20T00:00:00.000Z',
              status: 'streaming',
            }],
          },
        }],
      }],
    })

    await useGraph.getState().duplicateCurrentIdea('Main Idea copy')

    expect(order).toEqual(['schedule:stopped', 'duplicate'])
    expect(useGraph.getState().currentIdeaId).toBe(targetIdea.id)
  })

  it('installs authoritative state synchronously while mutation stays closed until admission', async () => {
    resetGraphPersistenceForTests()
    let sink: ProfileRendererStateSink | undefined
    const nativeBoard = board([{
      id: 'card-native-hydration',
      kind: 'mod',
      blocks: [{ id: 'block-native-hydration', text: '' }],
      position: { x: 0, y: 0 },
      modV2: createSeedMod('switch', {
        title: 'NATIVE HYDRATION',
        createId: (role, ordinal) => `hydrated-${role}-${ordinal}`,
      }),
    }])
    const nativeHydration = hydration({
      board: nativeBoard,
      modOrigins: {
        'card-native-hydration': {
          kind: 'direct',
          instanceId: 'mod-instance-native-hydration',
        },
      },
    })
    const hydrate = vi.fn(async () => {
      expect(sink!.applyHydration(nativeHydration)).toBeUndefined()
      expect(useGraph.getState()).toMatchObject({
        hydrated: false,
        profileStartupState: 'loading',
        cards: nativeBoard.cards,
      })
      expect(useGraph.getState().addCard('note', { x: 10, y: 10 })).toBeTruthy()
      expect(useGraph.getState().cards).toEqual(nativeBoard.cards)
      expect(sink!.admitHydration()).toBeUndefined()
      expect(useGraph.getState()).toMatchObject({
        hydrated: true,
        profileStartupState: 'ready',
      })
      return nativeHydration
    })
    configureGraphPersistence({
      kind: 'packaged-profile',
      persistence: fakePersistence({
        hydrate,
        connectStateSink: vi.fn((candidate) => {
          sink = candidate
        }),
      }),
    })
    useGraph.setState({ hydrated: false, profileStartupState: 'idle', cards: [] })

    await useGraph.getState().hydrate()

    expect(hydrate).toHaveBeenCalledOnce()
  })

  it('applies native hydration and enters constrained recovery without trying a legacy backend', async () => {
    resetGraphPersistenceForTests()
    useGraph.setState({ hydrated: false, profileStartupState: 'idle' })
    const candidate: ProfileRecoveryPointSummary = {
      id: 'candidate-1',
      recordVersion: 2,
      revision: 7,
      verified: true,
      createdAt: '2026-07-19T00:00:00.000Z',
    }
    const nativeTemplate = {
      templateId: 'native-template',
      mod: createSeedMod('radar', {
        title: 'NATIVE',
        createId: (role, ordinal) => `recovered-${role}-${ordinal}`,
      }),
    }
    const hydrate = vi.fn(async () => {
      throw new ProfileRendererPersistenceError(
        'Profile recovery is required',
        profileServiceFailure('corrupt-or-recovery-required'),
      )
    })
    const inspectRecovery = vi.fn(async () => ({
      mode: 'inspect' as const,
      currentRevision: 7,
      candidates: [candidate],
      rejectedCandidateIds: [],
      quarantinedCurrentState: false as const,
    }))
    const restored = hydration({ userModTemplates: [nativeTemplate] })
    const restoreRecovery = vi.fn(async () => ({
      receipt: {
        mode: 'restore' as const,
        selectedCandidateId: candidate.id,
        rejectedCandidateIds: [],
        quarantinedCurrentState: true,
        previousRevision: 7,
        revision: 8,
      },
      hydration: restored,
    }))
    configureGraphPersistence({
      kind: 'packaged-profile',
      persistence: fakePersistence({ hydrate, inspectRecovery, restoreRecovery }),
    })

    await useGraph.getState().hydrate()
    expect(useGraph.getState()).toMatchObject({
      hydrated: false,
      profileStartupState: 'recovery-required',
      recoveryCandidates: [candidate],
    })

    await useGraph.getState().restoreProfileRecovery(candidate.id)
    expect(restoreRecovery).toHaveBeenCalledWith(candidate.id)
    expect(useGraph.getState()).toMatchObject({
      hydrated: true,
      profileStartupState: 'ready',
      currentIdeaId: IDEA.id,
    })
    expect(useGraph.getState().settings.profileModLibrary).toEqual([nativeTemplate])
  })

  it('captures checkpoint state from the live store instead of a bootstrap closure', () => {
    configure(fakePersistence())
    useGraph.setState({ cards: [] })
    const first = captureCurrentProfileRendererCommitState()
    useGraph.setState({
      cards: [{
        id: 'note-live',
        kind: 'note',
        blocks: [{ id: 'block-live', text: 'Newest state' }],
        position: { x: 10, y: 20 },
      }],
    })

    const second = captureCurrentProfileRendererCommitState()

    expect(first.board.cards).toEqual([])
    expect(second.board.cards[0]?.blocks[0]?.text).toBe('Newest state')
  })
})
