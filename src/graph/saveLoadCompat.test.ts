// Load compatibility for retired save data: `visualDecayEnabled` (#304), the
// intent-signal subsystem (#378), and pre-flight web research (#933, ADR 0033:
// Card `searchWeb` and Run `webSources`). Loading an old board must not throw,
// and re-saving must omit only those retired fields/events. These tests drive the
// REAL load seam — the store's loadIdea action through the disk storage API,
// which is the path that runs normalizeBoardForRuntime — exactly as
// storeLoad.test.ts does; useGraph.setState would bypass the seam under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectiveExecutionModel } from '../brain/executionPlan'
import { DEFAULT_RESEARCH_DEPTH, researchDepthOf } from '../brain/researchDepth'
import { reachModeOf } from '../brain/reachMode'
import { DEFAULT_NOTE_FONT_SIZE, noteFontSizeOf } from './noteFontSize'
import { createSeedMod } from '../mods'
import { resetStorageBackendForTests, saveIdeaBoard } from './save'
import { serializeIdeaExport } from './ideaExport'
import { useGraph } from './store'
import { createTimelineProjector } from './timeline'
import type { Card, IdeaExport, IdeaSummary, SavedBoard } from './types'

const idea: IdeaSummary = {
  id: 'idea-legacy',
  name: 'Legacy Idea',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
}

// A REPRESENTATIVE board exactly as an older build persisted it: every
// collection populated, plus the retired data. Held as a JSON string because
// that is the wire format under test. Every value is already in normalized
// form (settled follow-ups, no legacy ==marks==, no
// ask→ask connection, aiSettings complete for that older build), so the load path's
// normalizeBoardForRuntime is an identity on everything except dropping the
// retired data — which makes the round-trip comparison below exact: if ANY
// adjacent field is transformed or lost, the deep equality fails.
//
// Fixture values are deliberately DISTINGUISHABLE FROM FALLBACK DEFAULTS, so
// deep equality cannot mistake "regenerated" for "preserved":
// - every then-existing aiSettings field differs from defaultAiSettings() (reasoningEffort
//   'medium', chainConfirmThreshold 2, compactionMode 'when-needed');
// - systemPrompt is absent, as it was in saves before Idea-wide AI guidance;
// - note-a carries BOTH asset shapes (storage invariant: assets are preserved
//   user data), copied from cardAssetCompat.test.ts: one legacy asset with
//   no compression metadata (pre-compression saves must stay loadable
//   as-is, types.ts CardAsset), and one compressed asset carrying every
//   optional field (width/height/originalSize/originalMimeType/compression)
//   so stripping only that metadata fails the deep equality.
//
// Known gap, deliberately out of scope for this SavedBoard test: the Idea
// envelope (name, createdAt, lastOpenedAt) is only covered via currentIdeaId.
const LEGACY_BOARD_JSON = JSON.stringify({
  version: 1,
  cards: [
    {
      id: 'note-a',
      kind: 'note',
      blocks: [{ id: 'note-a-block', text: 'branch we tried already' }],
      assets: [
        {
          id: 'asset-legacy',
          kind: 'image',
          name: 'old-screenshot.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,abc123',
          size: 4_200_000,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          id: 'asset-compressed',
          kind: 'image',
          name: 'new-reference.png',
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,def456',
          size: 48_000,
          createdAt: '2026-07-01T00:00:00.000Z',
          width: 1280,
          height: 960,
          originalSize: 3_800_000,
          originalMimeType: 'image/png',
          compression: 'compressed',
        },
      ],
      position: { x: 0, y: 0 },
      intentSignal: 'probe',
      intentSignalSetAt: '2025-11-03T08:15:00.000Z',
    },
    {
      id: 'ask-a',
      kind: 'askAi',
      blocks: [{ id: 'ask-a-block', text: 'Find another direction.' }],
      position: { x: 600, y: 0 },
      intentSignal: 'test',
      intentSignalSetAt: '2025-12-14T19:42:30.000Z',
      searchWeb: true,
    },
    {
      id: 'result-a',
      kind: 'result',
      blocks: [{ id: 'result-a-block', text: '' }],
      position: { x: 1200, y: 0 },
      intentSignal: 'crystallize',
      intentSignalSetAt: '2026-02-20T05:05:05.000Z',
    },
  ],
  connections: [
    {
      id: 'note-to-ask',
      from: { cardId: 'note-a' },
      to: { cardId: 'ask-a' },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    },
  ],
  outputs: [
    {
      id: 'output-1',
      resultCardId: 'result-a',
      chosenVersionId: 'version-1',
      versions: [
        {
          id: 'version-1',
          number: 1,
          text: 'Try the other branch.',
          createdAt: '2026-01-01T00:00:00.000Z',
          fromRunId: 'run-1',
        },
      ],
    },
  ],
  runs: [
    {
      id: 'run-1',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:10.000Z',
      askAiCardId: 'ask-a',
      model: 'openai/gpt-4o',
      usedCardIds: ['note-a'],
      usedConnectionIds: ['note-to-ask'],
      modIds: [],
      appliedMods: [],
      intent: {
        signal: 'test',
        label: 'Test',
        directive: 'Pressure-test the idea.',
      },
      compiledInstruction: 'Find another direction.',
      producedVersionId: 'version-1',
      status: 'done',
      webSources: [{ title: 'Electron 40 release notes', url: 'https://example.test/electron-40' }],
    },
  ],
  highlights: [
    {
      id: 'highlight-1',
      cardId: 'note-a',
      tagId: 'tag-1',
      text: 'branch',
      occurrence: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  highlightTags: [{ id: 'tag-1', name: 'Key point', color: 'yellow', createdAt: '2026-01-01T00:00:00.000Z' }],
  intentLog: [
    {
      id: 'event-1',
      at: '2026-01-01T00:00:00.000Z',
      type: 'card.created',
      cardId: 'note-a',
      data: {
        card: {
          id: 'note-a',
          kind: 'note',
          blocks: [{ id: 'note-a-block', text: 'branch we tried already' }],
          position: { x: 0, y: 0 },
          intentSignal: 'probe',
          intentSignalSetAt: '2025-11-03T08:15:00.000Z',
        },
      },
    },
    {
      id: 'event-2',
      at: '2026-01-01T00:00:05.000Z',
      type: 'intent.changed',
      cardId: 'note-a',
      data: {
        previousSignal: 'hold',
        nextSignal: 'probe',
        previousSetAt: '2025-01-01T00:00:00.000Z',
        nextSetAt: '2025-11-03T08:15:00.000Z',
      },
    },
  ],
  visualDecayEnabled: false,
  compactionSummaries: [
    {
      cardId: 'note-a',
      fingerprint: 'fp-1',
      summary: 'A branch that was already tried.',
      model: 'openai/gpt-4o',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  aiSettings: {
    model: 'openai/gpt-4o',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-5'],
    reasoningEffort: 'high',
    chainConfirmThreshold: 7,
    compactionMode: 'eager',
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function stubDiskBackend(board: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/eido/status') {
      return json({ ok: true, dataFile: '/tmp/eido-load-compat-test.json', ideaCount: 1, hasUserContent: true })
    }
    if (url === '/api/eido/ideas/idea-legacy' && method === 'GET') {
      return json({ idea, board })
    }
    if (url === '/api/eido/ideas' && method === 'GET') {
      return json({ ideas: [idea] })
    }

    throw new Error(`Unhandled request: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
}

function stubStatefulDiskBackend(initialBoard: SavedBoard) {
  let persistedBoard = structuredClone(initialBoard)
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/eido/status') {
      return json({ ok: true, dataFile: '/tmp/eido-synthetic-compat.json', ideaCount: 1, hasUserContent: true })
    }
    if (url === '/api/eido/ideas/idea-legacy' && method === 'GET') {
      return json({ idea, board: structuredClone(persistedBoard) })
    }
    if (url === '/api/eido/ideas' && method === 'GET') {
      return json({ ideas: [idea] })
    }
    if (url === '/api/eido/ideas/idea-legacy/board' && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { board: SavedBoard }
      persistedBoard = structuredClone(body.board)
      return json({ idea: { ...idea, updatedAt: persistedBoard.updatedAt } })
    }

    throw new Error(`Unhandled request: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    persistedBoard: () => structuredClone(persistedBoard),
  }
}

describe('SavedBoard load compatibility — retired fields and events', () => {
  beforeEach(() => {
    resetStorageBackendForTests()
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        throw new Error('IndexedDB should not be needed when disk storage is available')
      }),
    })
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      currentIdeaId: null,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetStorageBackendForTests()
  })

  it('loads and re-saves legacy intent data without the retired fields or event', async () => {
    const legacyBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    stubDiskBackend(legacyBoard)

    // The real load seam: loadIdea → replaceBoardWithSettings →
    // normalizeBoardForRuntime. A throw here fails the test by construction.
    await useGraph.getState().loadIdea('idea-legacy')

    const state = useGraph.getState()
    expect(state.currentIdeaId).toBe('idea-legacy')

    // Re-save and compare against the legacy wire format after applying the
    // deletion list from #378 to the fixture itself.
    // snapshot() re-stamps updatedAt, so it is compared for presence only;
    // everything else must round-trip EXACTLY, minus retired data. Any
    // adjacent field dropped or transformed makes this deep equality fail.
    const resaved = state.snapshot()
    const expected = structuredClone(legacyBoard) as SavedBoard & Record<string, unknown>
    delete expected.visualDecayEnabled
    for (const card of expected.cards as Array<Record<string, unknown>>) {
      delete card.intentSignal
      delete card.intentSignalSetAt
      delete card.searchWeb
    }
    for (const run of expected.runs as Array<Record<string, unknown>>) {
      delete run.intent
      delete run.webSources
    }
    expected.aiSettings = {
      ...expected.aiSettings!,
      models: ['openai/gpt-4o'],
      provider: 'openrouter',
      providerModels: {
        openrouter: {
          model: 'openai/gpt-4o',
          models: ['openai/gpt-4o'],
        },
        'claude-code': { model: 'default', models: ['default', 'fable', 'opus', 'sonnet', 'haiku'] },
        codex: { model: 'gpt-5.6-sol', models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] },
        antigravity: { model: 'gemini-3.7-flash', models: ['gemini-3.7-flash', 'gemini-3.1-pro'] },
      },
    } as unknown as SavedBoard['aiSettings']
    expected.intentLog = expected.intentLog
      ?.filter((event) => (event as { type: string }).type !== 'intent.changed')
      .map((event) => {
        if (event.type !== 'card.created' && event.type !== 'group.created' && event.type !== 'card.deleted') {
          return event
        }
        const cleanEvent = structuredClone(event) as typeof event
        const card = cleanEvent.data.card as Card & Record<string, unknown>
        delete card.intentSignal
        delete card.intentSignalSetAt
        return cleanEvent
      })
    const { updatedAt: legacyUpdatedAt, ...expectedRest } = expected
    const { updatedAt: resavedUpdatedAt, ...resavedRest } = resaved

    expect(resavedRest).toEqual(expectedRest)
    // The store mints a fresh updatedAt on snapshot: a valid ISO stamp, not
    // the legacy one.
    expect(new Date(resavedUpdatedAt).toISOString()).toBe(resavedUpdatedAt)
    expect(resavedUpdatedAt).not.toBe(legacyUpdatedAt)
    expect('visualDecayEnabled' in resaved).toBe(false)
    expect(JSON.stringify(resaved)).not.toContain('visualDecayEnabled')
    expect(JSON.stringify(resaved)).not.toContain('intentSignal')
    expect(JSON.stringify(resaved)).not.toContain('intent.changed')
    expect(resaved.runs[0]).not.toHaveProperty('intent')
    // Pre-flight web research is retired (ADR 0033). Its two saved fields are
    // dropped everywhere the strict validators would later reject them: the
    // Card list, the Run list, and the history events that clone both.
    expect(JSON.stringify(resaved)).not.toContain('searchWeb')
    expect(JSON.stringify(resaved)).not.toContain('webSources')
    expect(resaved.runs[0]).not.toHaveProperty('webSources')

    const replayed = createTimelineProjector(resaved).projectAt('2026-01-01T00:00:10.000Z')
    expect(replayed.cards.map((card) => card.id)).toContain('note-a')
    expect(replayed.cards.every((card) => !('intentSignal' in card))).toBe(true)
  })

  it('reads a legacy Note text size name at its ladder step without rewriting the Board', async () => {
    const legacyBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const sized = (id: string, fontSize: unknown): Card => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text: id }],
      position: { x: 0, y: 0 },
      ...(fontSize === undefined ? {} : { fontSize }),
    } as Card)
    legacyBoard.cards.push(
      sized('note-small', 'small'),
      sized('note-medium', 'medium'),
      sized('note-large', 'large'),
      sized('note-unset', undefined),
      // A step from a build whose ladder is longer than this one's rides in the
      // settings envelope, where a value this build cannot place costs a font
      // size and never a Board.
      { ...sized('note-off-ladder', undefined), meta: { noteFontSize: 99 } } as Card,
    )
    stubDiskBackend(legacyBoard)

    await useGraph.getState().loadIdea('idea-legacy')

    const loaded = useGraph.getState().cards
    const stepOf = (id: string) => noteFontSizeOf(loaded.find((card) => card.id === id))
    // The three retired names are the first three steps, in the order they
    // always rendered. This is the whole compatibility promise.
    expect(stepOf('note-small')).toBe(1)
    expect(stepOf('note-medium')).toBe(2)
    expect(stepOf('note-large')).toBe(3)
    // An unset Note, and a step this ladder is too short to place, both read at
    // the default rather than failing anything.
    expect(stepOf('note-unset')).toBe(DEFAULT_NOTE_FONT_SIZE)
    expect(stepOf('note-off-ladder')).toBe(DEFAULT_NOTE_FONT_SIZE)

    // Load is deliberately NOT a migration. The name a Board was written with
    // is the name it keeps until the person changes the scale, and the longer
    // ladder's step stays exactly where the other build put it, so a trip
    // through this build never silently resizes somebody's Note.
    const saved = useGraph.getState().snapshot().cards
    expect(saved.find((card) => card.id === 'note-large')).toHaveProperty('fontSize', 'large')
    expect(saved.find((card) => card.id === 'note-off-ladder')?.meta).toEqual({ noteFontSize: 99 })
  })

  it('drops only legacy Mod payloads while preserving the rest of the SavedBoard', async () => {
    const legacyBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const legacyMod = {
      id: 'legacy-mod-payload',
      label: 'Legacy Mod payload',
      controls: [{
        id: 'legacy-control',
        label: 'Legacy slider',
        kind: 'slider',
        min: 0,
        max: 10,
        step: 1,
        value: 7,
      }],
    }
    const legacyModCard = {
      id: 'legacy-mod-card',
      kind: 'mod' as const,
      title: 'Keep this Card',
      headerColor: '#123456',
      blocks: [{ id: 'legacy-mod-block', text: 'Keep this Block' }],
      position: { x: 900, y: 400 },
      size: { width: 360, height: 280 },
      meta: { preserve: ['all', 7, false, null] },
      mod: legacyMod,
    }
    legacyBoard.cards.push(legacyModCard as Card)
    legacyBoard.connections.push({
      id: 'legacy-mod-to-ask',
      from: { cardId: legacyModCard.id },
      to: { cardId: 'ask-a' },
      strength: 'strong',
      polarity: 'helps',
      role: 'modifies',
    })
    legacyBoard.intentLog?.push({
      id: 'event-legacy-mod-created',
      at: '2026-01-01T00:00:06.000Z',
      type: 'card.created',
      cardId: legacyModCard.id,
      data: { card: structuredClone(legacyModCard) as Card },
    })
    stubDiskBackend(legacyBoard)

    await useGraph.getState().loadIdea('idea-legacy')

    const resaved = useGraph.getState().snapshot()
    const current = resaved.cards.find((card) => card.id === legacyModCard.id)
    expect(current).toEqual({
      id: legacyModCard.id,
      kind: 'mod',
      title: 'Keep this Card',
      headerColor: '#123456',
      blocks: [{ id: 'legacy-mod-block', text: 'Keep this Block' }],
      position: { x: 900, y: 400 },
      size: { width: 360, height: 280 },
      meta: { preserve: ['all', 7, false, null] },
    })
    expect(resaved.connections).toContainEqual({
      id: 'legacy-mod-to-ask',
      from: { cardId: legacyModCard.id },
      to: { cardId: 'ask-a' },
      strength: 'strong',
      polarity: 'helps',
      role: 'modifies',
    })
    expect(resaved.outputs).toEqual(legacyBoard.outputs)
    expect(resaved.highlights).toEqual(legacyBoard.highlights)
    expect(resaved.compactionSummaries).toEqual(legacyBoard.compactionSummaries)
    const historical = resaved.intentLog?.find((event) => event.id === 'event-legacy-mod-created')
    expect(historical).toMatchObject({ data: { card: { id: legacyModCard.id, title: 'Keep this Card' } } })
    expect((historical as { data?: { card?: unknown } } | undefined)?.data?.card).not.toHaveProperty('mod')
    expect(JSON.stringify(resaved)).not.toContain('legacy-mod-payload')
    expect(JSON.stringify(resaved)).not.toContain('legacy-control')
  })

  it('preserves current Mod documents and normalizes only repairable v2 fields', async () => {
    const legacyBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const valid = createSeedMod('slider', {
      createId: (role, ordinal) => `valid-${role}-${ordinal}`,
    })
    const repairable = structuredClone(valid)
    repairable.state.items[0]!.v = 999
    legacyBoard.cards.push(
      {
        id: 'valid-mod-v2-card',
        kind: 'mod',
        blocks: [{ id: 'valid-mod-v2-block', text: '' }],
        position: { x: 900, y: 400 },
        modV2: valid,
      },
      {
        id: 'repairable-mod-v2-card',
        kind: 'mod',
        blocks: [{ id: 'repairable-mod-v2-block', text: '' }],
        position: { x: 1_200, y: 400 },
        modV2: repairable,
      },
    )
    stubDiskBackend(legacyBoard)

    await useGraph.getState().loadIdea('idea-legacy')

    const loadedValid = useGraph.getState().cards.find((card) => card.id === 'valid-mod-v2-card')
    const loadedRepairable = useGraph.getState().cards.find(
      (card) => card.id === 'repairable-mod-v2-card',
    )
    expect(loadedValid?.modV2).toEqual(valid)
    expect(loadedRepairable?.modV2).toMatchObject({
      kind: 'slider',
      state: { items: [{ v: 100 }, { v: valid.state.items[1]!.v }] },
    })
    expect(useGraph.getState().snapshot().cards.find(
      (card) => card.id === 'repairable-mod-v2-card',
    )?.modV2).toEqual(loadedRepairable?.modV2)
  })

  it('normalizes current Mods in every Card-shaped history snapshot without changing adjacent history', async () => {
    const legacyBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const valid = createSeedMod('slider', {
      createId: (role, ordinal) => `history-valid-${role}-${ordinal}`,
    })
    const repairable = structuredClone(valid)
    repairable.state.items[0]!.v = 999
    const invalid = { ...structuredClone(valid), id: 'retired-root-mod-id' }
    const historyCards: Card[] = [
      {
        id: 'history-created-card',
        kind: 'mod',
        title: 'Created Card title',
        headerColor: '#112233',
        blocks: [{ id: 'history-created-block', text: 'Created Card body' }],
        position: { x: 10, y: 20 },
        size: { width: 310, height: 220 },
        zIndex: 7,
        meta: { preserved: ['created', 1] },
        modV2: valid,
      },
      {
        id: 'history-group-card',
        kind: 'group',
        title: 'Group Card title',
        blocks: [{ id: 'history-group-block', text: 'Group Card body' }],
        compressionPrompt: 'Preserve this group prompt.',
        position: { x: 30, y: 40 },
        groupId: 'outer-group',
        meta: { preserved: ['group', 2] },
        modV2: repairable,
      },
      {
        id: 'history-deleted-card',
        kind: 'mod',
        title: 'Deleted Card title',
        blocks: [{ id: 'history-deleted-block', text: 'Deleted Card body' }],
        position: { x: 50, y: 60 },
        meta: { preserved: ['deleted', 3] },
        modV2: invalid as never,
      },
    ]
    const history: NonNullable<SavedBoard['intentLog']> = [
      {
        id: 'history-created-event',
        at: '2026-01-01T00:00:01.000Z',
        type: 'card.created',
        cardId: historyCards[0].id,
        ideaId: 'idea-legacy',
        commitId: 'commit-created',
        actorId: 'actor-created',
        clientTxnId: 'txn-created',
        seq: 11,
        data: {
          card: historyCards[0],
          sourceCardId: 'source-card',
          claimedTransitionEvidence: { version: 1, count: 2, sha256: 'created-sha' },
        },
      },
      {
        id: 'history-group-event',
        at: '2026-01-01T00:00:02.000Z',
        type: 'group.created',
        cardId: historyCards[1].id,
        ideaId: 'idea-legacy',
        commitId: 'commit-group',
        actorId: 'actor-group',
        clientTxnId: 'txn-group',
        seq: 12,
        data: {
          card: historyCards[1],
          memberChanges: {
            'member-a': { to: historyCards[1].id },
            'member-b': { from: 'previous-group', to: historyCards[1].id },
          },
        },
      },
      {
        id: 'history-deleted-event',
        at: '2026-01-01T00:00:03.000Z',
        type: 'card.deleted',
        cardId: historyCards[2].id,
        ideaId: 'idea-legacy',
        commitId: 'commit-deleted',
        actorId: 'actor-deleted',
        clientTxnId: 'txn-deleted',
        seq: 13,
        data: {
          card: historyCards[2],
          connections: [{
            id: 'deleted-connection',
            from: { cardId: historyCards[2].id },
            to: { cardId: 'ask-a' },
            strength: 'weak',
            polarity: 'helps',
            role: 'modifies',
          }],
          memberIds: ['member-a', 'member-b'],
          outputs: [],
          claimedTransitionEvidence: { version: 1, count: 3, sha256: 'deleted-sha' },
        },
      },
    ]
    legacyBoard.intentLog = history
    stubDiskBackend(legacyBoard)

    await useGraph.getState().loadIdea('idea-legacy')

    const expectedHistory = structuredClone(history)
    const repairedEvent = expectedHistory[1]
    if (repairedEvent.type !== 'group.created') throw new Error('Expected group.created fixture')
    const repairedMod = repairedEvent.data.card.modV2
    if (repairedMod?.kind !== 'slider') throw new Error('Expected slider Mod fixture')
    repairedMod.state.items[0]!.v = 100
    const invalidEvent = expectedHistory[2]
    if (invalidEvent.type !== 'card.deleted') throw new Error('Expected card.deleted fixture')
    delete invalidEvent.data.card.modV2

    expect(useGraph.getState().intentLog).toEqual(expectedHistory)
    expect(useGraph.getState().snapshot().intentLog).toEqual(expectedHistory)
    const createdEvent = useGraph.getState().intentLog[0]
    expect(createdEvent.type).toBe('card.created')
    if (createdEvent.type !== 'card.created') throw new Error('Expected card.created fixture')
    expect(createdEvent.data.card.modV2).toEqual(valid)
  })

  it('yields a runnable board: a commit works on the loaded state', async () => {
    stubDiskBackend(JSON.parse(LEGACY_BOARD_JSON))
    await useGraph.getState().loadIdea('idea-legacy')

    useGraph.getState().addCard('note', { x: 200, y: 400 })

    const state = useGraph.getState()
    expect(state.cards).toHaveLength(4)
    expect(state.snapshot().cards).toHaveLength(4)
  })

  it.each([
    ['in the middle', false],
    ['in the middle and at the end', true],
  ])('keeps appended event sequences monotonic when intent.changed was %s', async (_position, trailingIntent) => {
    const legacyBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const note = legacyBoard.cards[0]
    legacyBoard.intentLog = [
      {
        id: 'event-1',
        at: '2026-01-01T00:00:00.000Z',
        type: 'card.created',
        cardId: note.id,
        seq: 1,
        data: { card: structuredClone(note) },
      },
      {
        id: 'event-2',
        at: '2026-01-01T00:00:05.000Z',
        type: 'intent.changed',
        cardId: note.id,
        seq: 2,
        data: { previousSignal: 'hold', nextSignal: 'probe' },
      } as never,
      {
        id: 'event-3',
        at: '2026-01-01T00:00:10.000Z',
        type: 'card.moved',
        cardId: note.id,
        seq: 3,
        data: {
          moves: [{ cardId: note.id, from: { x: 0, y: 0 }, to: { x: 100, y: 50 } }],
        },
      },
      ...(trailingIntent
        ? [
            {
              id: 'event-4',
              at: '2026-01-01T00:00:15.000Z',
              type: 'intent.changed',
              cardId: note.id,
              seq: 4,
              data: { previousSignal: 'probe', nextSignal: 'test' },
            } as never,
          ]
        : []),
    ]
    stubDiskBackend(legacyBoard)

    await useGraph.getState().loadIdea('idea-legacy')
    const retainedSequences = useGraph.getState().intentLog.map((event) => event.seq ?? 0)
    const newCardId = useGraph.getState().addCard('note', { x: 200, y: 400 })

    const state = useGraph.getState()
    const appended = state.intentLog[state.intentLog.length - 1]
    expect(appended.seq).toBeGreaterThan(Math.max(...retainedSequences))
    expect(state.intentLog.map((event) => event.seq)).toEqual([1, 3, 4])

    const replayed = createTimelineProjector(state.snapshot()).projectAt(appended.at)
    expect(replayed.cards.find((card) => card.id === note.id)?.position).toEqual({ x: 100, y: 50 })
    expect(replayed.cards.map((card) => card.id)).toContain(newCardId)
  })

  it('loads, changes, saves, reloads, and exports one synthetic Board without changing its authority', async () => {
    const backend = stubStatefulDiskBackend(JSON.parse(LEGACY_BOARD_JSON) as SavedBoard)

    await useGraph.getState().loadIdea('idea-legacy')
    useGraph.getState().setCardText('note-a', 'A newly saved thought with its authoritative image references intact.')
    const saved = useGraph.getState().snapshot()
    await saveIdeaBoard('idea-legacy', saved)

    expect(backend.persistedBoard()).toEqual(saved)

    resetStorageBackendForTests()
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      highlights: [],
      highlightTags: [],
      intentLog: [],
      compactionSummaries: [],
      currentIdeaId: null,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      settings: {
        apiKey: 'local-only-sentinel',
        model: 'sentinel/model',
        models: ['sentinel/model'],
        reasoningEffort: 'low',
        systemPrompt: 'Stale runtime settings must not survive reload.',
        chainConfirmThreshold: 99,
        compactionMode: 'never',
      },
    })

    await useGraph.getState().loadIdea('idea-legacy')
    const reloaded = useGraph.getState().snapshot()
    const { updatedAt: savedAt, ...savedBoard } = saved
    const { updatedAt: reloadedAt, ...reloadedBoard } = reloaded

    expect(reloadedBoard).toEqual(savedBoard)
    expect(new Date(savedAt).toISOString()).toBe(savedAt)
    expect(new Date(reloadedAt).toISOString()).toBe(reloadedAt)

    const exported = (() => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime('2026-07-19T00:00:00.000Z')
        return JSON.parse(serializeIdeaExport(idea, reloaded)) as IdeaExport
      } finally {
        vi.useRealTimers()
      }
    })()
    const exportedAssets = exported.board.cards.flatMap((card) => card.assets ?? [])

    expect(exported).toMatchObject({
      version: 1,
      exportedAt: '2026-07-19T00:00:00.000Z',
      idea,
    })
    expect(exported.board).toEqual(reloaded)
    expect(exportedAssets.map((asset) => asset.dataUrl)).toEqual([
      'data:image/png;base64,abc123',
      'data:image/jpeg;base64,def456',
    ])
    for (const asset of exportedAssets) {
      expect(asset.dataUrl.startsWith('data:image/')).toBe(true)
      expect(asset).not.toHaveProperty('objectUrl')
      expect(asset).not.toHaveProperty('rendition')
      expect(asset).not.toHaveProperty('thumbnail')
    }
  })

  // The settings envelope's rule 1 at the runtime seam. A Board written by a
  // NEWER build carries settings this build has never heard of; loading it,
  // changing a setting this build does own, saving, and reloading must give
  // the newer build every one of its keys back byte-for-byte. Anything less
  // and a person who opens an older Eido once loses preferences silently.
  it('carries settings from a newer build verbatim through load, a settings write, save, and reload', async () => {
    const futureBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const foreignEnvelope = {
      // A key no build in this tree defines.
      linkPreviewDismissedUrl: 'https://example.invalid/dismissed',
      // A known key holding a value from a build that added a third mode.
      reachMode: 'exhaustive',
      // A setting whose value shape is a structure, not a scalar.
      futurePanel: { collapsed: true, order: ['a', 'b'], weight: 0.5, absent: null },
    }
    const askCard = futureBoard.cards.find((card) => card.id === 'ask-a')!
    askCard.meta = structuredClone(foreignEnvelope)
    const backend = stubStatefulDiskBackend(futureBoard)

    await useGraph.getState().loadIdea('idea-legacy')

    // normalizeBoardForRuntime is an identity on the envelope: no key is read,
    // rewritten, or dropped on the way in.
    expect(useGraph.getState().cards.find((card) => card.id === 'ask-a')?.meta).toEqual(foreignEnvelope)
    // Rule 2 at the same seam: the foreign reach mode substitutes this build's
    // documented default instead of failing anything.
    expect(reachModeOf(useGraph.getState().cards.find((card) => card.id === 'ask-a'))).toBe('web')

    // This build now writes a setting it does own, into the same envelope.
    useGraph.getState().setCardResearchDepth('ask-a', 'L')
    await saveIdeaBoard('idea-legacy', useGraph.getState().snapshot())

    const persistedAsk = backend.persistedBoard().cards.find((card) => card.id === 'ask-a')
    expect(persistedAsk?.meta).toEqual({ ...foreignEnvelope, researchDepth: 'L' })

    resetStorageBackendForTests()
    useGraph.setState({ cards: [], currentIdeaId: null, hydrated: false })
    await useGraph.getState().loadIdea('idea-legacy')

    const reloadedAsk = useGraph.getState().cards.find((card) => card.id === 'ask-a')
    expect(reloadedAsk?.meta).toEqual({ ...foreignEnvelope, researchDepth: 'L' })
    expect(researchDepthOf(reloadedAsk)).toBe('L')
    expect(reachModeOf(reloadedAsk)).toBe('web')

    // Going back to the default deletes the key rather than storing it, so a
    // Card that never left the cheapest depth is byte-identical to one written
    // before the choice existed. The newer build's keys are still untouched.
    useGraph.getState().setCardResearchDepth('ask-a', DEFAULT_RESEARCH_DEPTH)
    await saveIdeaBoard('idea-legacy', useGraph.getState().snapshot())
    expect(backend.persistedBoard().cards.find((card) => card.id === 'ask-a')?.meta)
      .toEqual(foreignEnvelope)
  })

  // The same rule at BOARD level (#1307). The store does not hold a Board's
  // settings as a bag: it decomposes `aiSettings` into its own typed Settings
  // shape and rebuilds the bag on every save, so a key it has no field for
  // would be deleted the first time this build saved a Board a newer build
  // wrote. The Board's own `settings` envelope has no field at all. Both must
  // come back out byte for byte.
  it('carries Board-level settings from a newer build verbatim through load, a change, save, and reload', async () => {
    const futureBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const foreignAiSettings = {
      // A reasoning rung and a compaction mode from a build that added one.
      reasoningEffort: 'ultra',
      compactionMode: 'obsessive',
      // A whole AI setting no build in this tree defines.
      futureRunKnob: { retries: 3, backoff: 'linear' },
      // The case that hides one level down: a provider catalog entry naming a
      // tool this build does not have. The key is one this build owns, and the
      // store rebuilds the map from its OWN provider list on every save, so
      // this entry is the one a naive rewrite deletes without noticing.
      providerModels: { futureprovider: { model: 'future/one', models: ['future/one'] } },
    }
    const boardSettings = { futureBoardPanel: { collapsed: true, order: ['a', 'b'] }, gridSnap: 12 }
    Object.assign(futureBoard.aiSettings!, foreignAiSettings)
    futureBoard.settings = structuredClone(boardSettings)
    const backend = stubStatefulDiskBackend(futureBoard)

    await useGraph.getState().loadIdea('idea-legacy')

    // Rule 2 at the runtime seam: the rungs this build cannot act on read as
    // this build's documented defaults instead of failing the load.
    expect(useGraph.getState().settings.reasoningEffort).toBe('medium')
    expect(useGraph.getState().settings.compactionMode).toBe('when-needed')

    // This build now changes a setting it does own, and saves.
    useGraph.getState().setCardText('note-a', 'A change that forces a Board save.')
    await saveIdeaBoard('idea-legacy', useGraph.getState().snapshot())

    const persisted = backend.persistedBoard()
    expect(persisted.settings).toEqual(boardSettings)
    expect(persisted.aiSettings).toMatchObject({ futureRunKnob: foreignAiSettings.futureRunKnob })
    // Rule 1 for a KEY THIS BUILD OWNS. The runtime read this build's default,
    // but reading is not choosing: nobody touched these settings, so what a
    // newer build stored is still what stands on disk. Writing the substituted
    // default here is how a downgrade destroys a setting for good, because the
    // stored value is gone even after the person upgrades again.
    expect(persisted.aiSettings?.reasoningEffort).toBe('ultra')
    expect(persisted.aiSettings?.compactionMode).toBe('obsessive')
    // The same rule one level down: the entry for a provider this build does
    // not have survives beside the entries for the providers it does.
    expect(persisted.aiSettings?.providerModels)
      .toMatchObject(foreignAiSettings.providerModels)
    expect(persisted.aiSettings?.providerModels?.openrouter?.models.length).toBeGreaterThan(0)

    resetStorageBackendForTests()
    useGraph.setState({ cards: [], currentIdeaId: null, hydrated: false })
    await useGraph.getState().loadIdea('idea-legacy')

    expect(useGraph.getState().snapshot().settings).toEqual(boardSettings)
    // And the reload reads the same defaults again, so the person sees one
    // consistent answer while the stored choice waits for a build that has it.
    expect(useGraph.getState().settings.reasoningEffort).toBe('medium')
    expect(useGraph.getState().settings.compactionMode).toBe('when-needed')
  })

  // The other half of that promise, which is what keeps it from being a trap: a
  // preserved value is preserved only until the person chooses. The moment this
  // build writes its own answer for a key, that answer is what reaches disk.
  it('lets this build overwrite a newer build value once someone actually changes the setting', async () => {
    const futureBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    Object.assign(futureBoard.aiSettings!, { reasoningEffort: 'ultra', compactionMode: 'obsessive' })
    const backend = stubStatefulDiskBackend(futureBoard)

    await useGraph.getState().loadIdea('idea-legacy')
    useGraph.getState().setReasoningEffort('high')
    await saveIdeaBoard('idea-legacy', useGraph.getState().snapshot())

    const persisted = backend.persistedBoard()
    expect(persisted.aiSettings?.reasoningEffort).toBe('high')
    // The setting nobody touched is still the newer build's.
    expect(persisted.aiSettings?.compactionMode).toBe('obsessive')
  })

  // The bag's TYPES are no longer guaranteed either. `validateBoardSettings`
  // used to require a non-empty `model` string and a `models` string array, so
  // the store's normaliser could dereference both; it now checks the container
  // and nothing else, and every one of these bags reaches the load path intact.
  // Each must cost a default and nothing more. `model is a number` is the one
  // that actually threw: `saved.model?.trim()` is not a function, and a throw
  // inside the normaliser fails the whole Board load, which is precisely the
  // failure ADR 0040 exists to prevent.
  const ENVELOPE_LEGAL_BUT_UNREADABLE: Record<string, unknown> = {
    'model is a number': { model: 42, models: ['a/b'], reasoningEffort: 'medium' },
    'models is a number': { model: 'a/b', models: 7, reasoningEffort: 'medium' },
    'models holds a number': { model: 'a/b', models: [7], reasoningEffort: 'medium' },
    'providerModels holds a number': { model: 'a/b', models: ['a/b'], providerModels: { openrouter: 42 } },
    'providerModels entry has no models': {
      model: 'a/b', models: ['a/b'], providerModels: { openrouter: { model: 'a/b' } },
    },
    'systemPrompt is a number': { model: 'a/b', models: ['a/b'], systemPrompt: 5 },
    'chainConfirmThreshold is a string': { model: 'a/b', models: ['a/b'], chainConfirmThreshold: 'lots' },
    'reasoningEffort is missing': { model: 'a/b', models: ['a/b'] },
    'the bag is empty': {},
  }
  for (const [shape, aiSettings] of Object.entries(ENVELOPE_LEGAL_BUT_UNREADABLE)) {
    it(`opens a Board whose aiSettings ${shape}, and falls back to a usable model`, async () => {
      const board = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
      board.aiSettings = aiSettings as never
      stubStatefulDiskBackend(board)

      await useGraph.getState().loadIdea('idea-legacy')

      expect(useGraph.getState().currentIdeaId).toBe('idea-legacy')
      expect(useGraph.getState().settings.model.length).toBeGreaterThan(0)
      expect(useGraph.getState().settings.models).toContain(useGraph.getState().settings.model)
      // The same bag must not throw on the way into an execution plan either.
      expect(effectiveExecutionModel(useGraph.getState().snapshot()).length).toBeGreaterThan(0)
      expect(effectiveExecutionModel({ ...board, aiSettings } as SavedBoard).length).toBeGreaterThan(0)
    })
  }

  // The Note body scale is the one setting that MIGRATED into the envelope
  // (#1308), so it owes both directions. A Board an OLDER build wrote still
  // carries the scale as the retired top-level `fontSize` field, and the
  // person must see the size they picked, unchanged, on load.
  it('shows the scale an older build saved as a top-level field, and migrates it into the envelope on the next change', async () => {
    const legacyBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const legacyNote = legacyBoard.cards.find((card) => card.id === 'note-a')!
    ;(legacyNote as { fontSize?: unknown }).fontSize = 'large'
    const backend = stubStatefulDiskBackend(legacyBoard)

    await useGraph.getState().loadIdea('idea-legacy')

    const loaded = useGraph.getState().cards.find((card) => card.id === 'note-a')
    expect(noteFontSizeOf(loaded)).toBe(3)
    // Load is deliberately NOT a migration. Nothing is rewritten until the
    // person changes the scale, so a Board they only ever opened still holds
    // the field a build that predates the envelope reads.
    expect(loaded).toHaveProperty('fontSize', 'large')

    // Changing the scale writes the envelope and deletes the legacy field in
    // the same update, so a Card never carries two answers.
    useGraph.getState().setCardFontSize('note-a', 1)
    await saveIdeaBoard('idea-legacy', useGraph.getState().snapshot())

    const persistedNote = backend.persistedBoard().cards.find((card) => card.id === 'note-a')
    expect(persistedNote?.meta).toEqual({ noteFontSize: 1 })
    expect(persistedNote).not.toHaveProperty('fontSize')

    resetStorageBackendForTests()
    useGraph.setState({ cards: [], currentIdeaId: null, hydrated: false })
    await useGraph.getState().loadIdea('idea-legacy')

    const reloadedNote = useGraph.getState().cards.find((card) => card.id === 'note-a')
    expect(noteFontSizeOf(reloadedNote)).toBe(1)
    expect(reloadedNote).not.toHaveProperty('fontSize')
  })

  // Back to the default is the case that could quietly leave a Card holding
  // both answers: the envelope stores the default as an ABSENT key, so the
  // legacy field has to go on its own or the old value would come back.
  it('clears the legacy scale even when the new scale is the default', async () => {
    const legacyBoard = JSON.parse(LEGACY_BOARD_JSON) as SavedBoard
    const legacyNote = legacyBoard.cards.find((card) => card.id === 'note-a')!
    ;(legacyNote as { fontSize?: unknown }).fontSize = 'large'
    const backend = stubStatefulDiskBackend(legacyBoard)

    await useGraph.getState().loadIdea('idea-legacy')
    useGraph.getState().setCardFontSize('note-a', DEFAULT_NOTE_FONT_SIZE)
    await saveIdeaBoard('idea-legacy', useGraph.getState().snapshot())

    const persistedNote = backend.persistedBoard().cards.find((card) => card.id === 'note-a')
    expect(persistedNote).not.toHaveProperty('fontSize')
    expect(persistedNote).not.toHaveProperty('meta')
    expect(noteFontSizeOf(persistedNote)).toBe(DEFAULT_NOTE_FONT_SIZE)
  })
})
