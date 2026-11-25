import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nearestReasoningEffort, type IdeaExport, type IdeaSummary, type SavedBoard } from './types'
import { DEFAULT_MODEL_SLUGS } from '../brain/models'
import { createSourceContextSnapshot } from '../brain/sourceContext'
import { PROFILE_REVIEW_MODEL } from '../shared/profileReviewPolicy'
import { serializeIdeaExport } from './ideaExport'

const saveMocks = vi.hoisted(() => ({
  ideas: [] as IdeaSummary[],
  boards: {} as Record<string, SavedBoard>,
  loadInitialIdea: vi.fn(),
  loadIdea: vi.fn(),
  listIdeas: vi.fn(),
  saveIdeaBoard: vi.fn(),
  createIdea: vi.fn(),
  deleteIdea: vi.fn(),
  renameIdea: vi.fn(),
}))

vi.mock('./save', () => ({
  emptyBoard: () => makeBoard('empty'),
  makeSavedBoard: (partial: Partial<import('./types').SavedBoard> = {}) => ({
    version: 1 as const,
    cards: partial.cards ?? [],
    connections: partial.connections ?? [],
    outputs: partial.outputs ?? [],
    runs: partial.runs ?? [],
    highlights: Array.isArray(partial.highlights) ? partial.highlights : [],
    highlightTags: Array.isArray(partial.highlightTags) ? partial.highlightTags : [],
    intentLog: Array.isArray(partial.intentLog) ? partial.intentLog : [],
    compactionSummaries: Array.isArray(partial.compactionSummaries) ? partial.compactionSummaries : [],
    ...(partial.aiSettings !== undefined ? { aiSettings: partial.aiSettings } : {}),
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  }),
  loadInitialIdea: saveMocks.loadInitialIdea,
  loadIdea: saveMocks.loadIdea,
  listIdeas: saveMocks.listIdeas,
  saveIdeaBoard: saveMocks.saveIdeaBoard,
  createIdea: saveMocks.createIdea,
  deleteIdea: saveMocks.deleteIdea,
  renameIdea: saveMocks.renameIdea,
  currentStorageStatus: () => ({ backend: 'disk', dataFile: '/tmp/eido-v3-ideas.json' }),
  makeDebouncedSaver: (
    _delayMs: number,
    onState: (s: 'saving' | 'saved' | 'failed') => void,
    save: (board: SavedBoard) => Promise<void>,
  ) => {
    const schedule = ((source: SavedBoard | (() => SavedBoard)) => {
      const board = typeof source === 'function' ? source() : source
      onState('saving')
      void save(board).then(
        () => onState('saved'),
        () => onState('failed'),
      )
    }) as ((source: SavedBoard | (() => SavedBoard)) => void) & { flush: () => Promise<void> }
    schedule.flush = async () => {}
    return schedule
  },
}))

import { useGraph } from './store'

function idea(id: string, name: string): IdeaSummary {
  return {
    id,
    name,
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
    lastOpenedAt: '2026-06-16T00:00:00.000Z',
  }
}

function makeBoard(id: string, aiSettings?: SavedBoard['aiSettings']): SavedBoard {
  return {
    version: 1,
    cards: [
      {
        id: `note-${id}`,
        kind: 'note',
        blocks: [{ id: `block-${id}`, text: id }],
        position: { x: 0, y: 0 },
      },
    ],
    connections: [],
    outputs: [],
    runs: [],
    aiSettings,
    updatedAt: '2026-06-16T00:00:00.000Z',
  }
}

const firstIdea = idea('idea-one', 'One')
const secondIdea = idea('idea-two', 'Two')
const retiredProviderIdea = idea('idea-gemini', 'Gemini')
const firstBoard = makeBoard('one', {
  model: 'openai/gpt-4o-mini',
  models: ['openai/gpt-4o-mini'],
  reasoningEffort: 'low',
})
const secondBoard = makeBoard('two', {
  model: 'anthropic/claude-3.5-sonnet',
  models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'],
  reasoningEffort: 'high',
  systemPrompt: 'Use the context of a neighborhood bakery launching in winter.',
})

// An Idea saved before the Gemini CLI was retired. Cast because the provider
// union no longer carries that word; a Board already on disk still does.
const retiredProviderBoard = makeBoard('gemini', {
  provider: 'gemini',
  model: 'gemini-3-pro-preview',
  models: ['auto', 'gemini-3-pro-preview', 'gemini-3-flash-preview'],
  providerModels: {
    openrouter: { model: 'openai/gpt-4o-mini', models: ['openai/gpt-4o-mini'] },
    'claude-code': { model: 'sonnet', models: ['sonnet', 'opus', 'haiku'] },
    codex: { model: 'default', models: ['default'] },
    gemini: { model: 'gemini-3-pro-preview', models: ['auto', 'gemini-3-pro-preview'] },
    antigravity: { model: 'auto', models: ['auto', 'pro', 'flash'] },
  },
  reasoningEffort: 'minimal',
} as unknown as SavedBoard['aiSettings'])

describe('per-Idea AI settings', () => {
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => {
    vi.clearAllMocks()
    saveMocks.ideas = [firstIdea, secondIdea, retiredProviderIdea]
    saveMocks.boards = {
      [firstIdea.id]: firstBoard,
      [secondIdea.id]: secondBoard,
      [retiredProviderIdea.id]: retiredProviderBoard,
    }
    saveMocks.loadInitialIdea.mockResolvedValue({ idea: firstIdea, board: firstBoard, ideas: saveMocks.ideas })
    saveMocks.loadIdea.mockImplementation(async (id: string) => {
      const found = saveMocks.ideas.find((item) => item.id === id)
      const board = saveMocks.boards[id]
      return found && board ? { idea: found, board } : null
    })
    saveMocks.listIdeas.mockResolvedValue(saveMocks.ideas)
    saveMocks.saveIdeaBoard.mockImplementation(async (id: string, board: SavedBoard) => {
      saveMocks.boards[id] = board
      return saveMocks.ideas.find((item) => item.id === id) ?? firstIdea
    })

    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      ideas: [],
      currentIdeaId: null,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      ideaManagerOpen: false,
      settings: {
        apiKey: 'local-secret-key',
        model: 'legacy/default',
        models: ['legacy/default'],
        reasoningEffort: 'medium',
      },
    })
  })

  it('applies each loaded board settings while preserving the local API key', async () => {
    await useGraph.getState().loadIdea(secondIdea.id)

    expect(useGraph.getState().settings).toMatchObject({
      apiKey: 'local-secret-key',
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      models: [...DEFAULT_MODEL_SLUGS, 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'],
      reasoningEffort: 'high',
      systemPrompt: 'Use the context of a neighborhood bakery launching in winter.',
      chainConfirmThreshold: 2,
      compactionMode: 'when-needed',
    })
  })

  it('saves model and reasoning edits back through the current board', async () => {
    await useGraph.getState().hydrate()
    saveMocks.saveIdeaBoard.mockClear()

    const providerModels = useGraph.getState().settings.providerModels!
    useGraph.getState().setProvider('openrouter', {
      ...providerModels,
      openrouter: {
        model: 'anthropic/claude-3.5-sonnet',
        models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
      },
    })
    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalled())
    let savedBoard = saveMocks.saveIdeaBoard.mock.calls[saveMocks.saveIdeaBoard.mock.calls.length - 1][1] as SavedBoard
    expect(savedBoard.aiSettings?.model).toBe('anthropic/claude-3.5-sonnet')
    // The editable catalog is device-local. A Board keeps only the active
    // slug needed for Idea/run compatibility, never the whole catalog.
    expect(savedBoard.aiSettings?.models).toEqual(['anthropic/claude-3.5-sonnet'])
    expect(savedBoard.aiSettings?.providerModels?.openrouter).toEqual({
      model: 'anthropic/claude-3.5-sonnet',
      models: ['anthropic/claude-3.5-sonnet'],
    })
    expect(savedBoard.aiSettings?.reasoningEffort).toBe('low')

    useGraph.getState().setReasoningEffort('xhigh')
    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalledTimes(2))
    savedBoard = saveMocks.saveIdeaBoard.mock.calls[saveMocks.saveIdeaBoard.mock.calls.length - 1][1] as SavedBoard
    expect(savedBoard.aiSettings?.reasoningEffort).toBe('xhigh')
  })

  it('does not persist an exact OpenRouter selection twice', async () => {
    await useGraph.getState().hydrate()
    saveMocks.saveIdeaBoard.mockClear()
    const selected = useGraph.getState().settings.providerModels!.openrouter.model

    useGraph.getState().setOpenRouterModel(selected)

    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()
  })

  it('persists an edited selected identity through restart without exporting the device catalog', async () => {
    await useGraph.getState().hydrate()
    const catalog = ['vendor/old', 'vendor/other']
    const current = useGraph.getState().settings
    useGraph.setState({
      settings: {
        ...current,
        provider: 'openrouter',
        model: 'vendor/old',
        models: catalog,
        providerModels: {
          ...current.providerModels!,
          openrouter: { model: 'vendor/old', models: catalog },
        },
        recommendedModelCatalog: catalog,
        recommendedModelCatalogExplicit: true,
      },
    })
    saveMocks.saveIdeaBoard.mockClear()

    expect(useGraph.getState().replaceRecommendedModel('vendor/old', 'vendor/new')).toBe(true)
    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalledOnce())

    const persisted = saveMocks.saveIdeaBoard.mock.calls[0]![1] as SavedBoard
    expect(persisted.aiSettings?.model).toBe('vendor/new')
    expect(persisted.aiSettings?.providerModels?.openrouter?.model).toBe('vendor/new')
    expect(persisted.aiSettings).not.toHaveProperty('recommendedModelCatalog')
    expect(persisted.aiSettings).not.toHaveProperty('openrouterModelListFormat')
    expect(JSON.stringify(serializeIdeaExport(firstIdea, persisted))).not.toContain('recommendedModelCatalog')

    // Simulate a restart: the next hydration reads the Board just persisted,
    // while the device catalog remains in its independent settings seam.
    saveMocks.loadInitialIdea.mockImplementation(async () => ({
      idea: firstIdea,
      board: saveMocks.boards[firstIdea.id]!,
      ideas: saveMocks.ideas,
    }))
    useGraph.setState({ currentIdeaId: null, hydrated: false })
    await useGraph.getState().hydrate()
    const reloaded = useGraph.getState().settings
    expect(reloaded.model).toBe('vendor/new')
    expect(reloaded.providerModels?.openrouter.model).toBe('vendor/new')
    expect(reloaded.recommendedModelCatalog).toEqual(['vendor/new', 'vendor/other'])
    expect(reloaded.models).toEqual(['vendor/new', 'vendor/other'])
    expect(reloaded.models).not.toContain('vendor/old')
  })

  it('keeps nonselected catalog edits out of the Board/Profile save funnel', async () => {
    await useGraph.getState().hydrate()
    const current = useGraph.getState().settings
    useGraph.setState({
      settings: {
        ...current,
        provider: 'openrouter',
        model: 'vendor/selected',
        models: ['vendor/old', 'vendor/other', 'vendor/selected'],
        providerModels: {
          ...current.providerModels!,
          openrouter: {
            model: 'vendor/selected',
            models: ['vendor/old', 'vendor/other', 'vendor/selected'],
          },
        },
        recommendedModelCatalog: ['vendor/old', 'vendor/other'],
        recommendedModelCatalogExplicit: true,
      },
    })
    saveMocks.saveIdeaBoard.mockClear()

    expect(useGraph.getState().replaceRecommendedModel('vendor/old', 'vendor/new')).toBe(true)
    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()
    expect(useGraph.getState().settings.model).toBe('vendor/selected')
    expect(useGraph.getState().settings.recommendedModelCatalog)
      .toEqual(['vendor/new', 'vendor/other'])
  })

  it('migrates legacy multi-entry OpenRouter Board lists into the device catalog by union', async () => {
    const deviceStorage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => deviceStorage.get(key) ?? null,
        setItem: (key: string, value: string) => { deviceStorage.set(key, value) },
        removeItem: (key: string) => { deviceStorage.delete(key) },
      },
    })
    await useGraph.getState().hydrate()
    const current = useGraph.getState().settings
    const legacyList = ['vendor/legacy-one', 'not-a-slug', 'vendor/legacy-two']
    saveMocks.boards[firstIdea.id] = makeBoard('legacy-union', {
      provider: 'claude-code',
      model: 'sonnet',
      models: ['sonnet'],
      providerModels: {
        ...current.providerModels!,
        openrouter: {
          model: legacyList[0]!,
          models: legacyList,
        },
        'claude-code': { model: 'sonnet', models: ['sonnet'] },
      },
      reasoningEffort: 'medium',
    })
    useGraph.setState({
      currentIdeaId: null,
      settings: {
        ...current,
        recommendedModelCatalog: ['vendor/device-choice'],
        recommendedModelCatalogExplicit: false,
      },
    })
    saveMocks.saveIdeaBoard.mockClear()

    await useGraph.getState().loadIdea(firstIdea.id)

    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual([
      'vendor/device-choice',
      'vendor/legacy-one',
          'vendor/legacy-two',
    ])
    expect(useGraph.getState().settings.recommendedModelCatalogExplicit).toBe(false)
    expect(JSON.parse(deviceStorage.get('eido-v3-settings') ?? '{}'))
      .toMatchObject({ recommendedModelCatalog: [
        'vendor/device-choice',
        'vendor/legacy-one',
        'vendor/legacy-two',
      ], recommendedModelCatalogExplicit: false })
    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()
  })

  it('does not migrate absent, selected-only, or explicitly owned Board catalog data', async () => {
    const deviceStorage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => deviceStorage.get(key) ?? null,
        setItem: (key: string, value: string) => { deviceStorage.set(key, value) },
        removeItem: (key: string) => { deviceStorage.delete(key) },
      },
    })
    await useGraph.getState().hydrate()
    const current = useGraph.getState().settings
    const legacy = ['vendor/legacy-one', 'vendor/legacy-two']
    const boardWith = (aiSettings?: SavedBoard['aiSettings']): SavedBoard => makeBoard('compatibility', aiSettings)

    for (const [label, board] of [
      ['absent', boardWith()],
      ['selected-only', boardWith({
        provider: 'openrouter',
        model: 'vendor/selected',
        models: ['vendor/selected'],
        reasoningEffort: 'medium',
        providerModels: {
          ...current.providerModels!,
          openrouter: { model: 'vendor/selected', models: ['vendor/selected'] },
        },
      })],
      ['explicit-device', boardWith({
        provider: 'claude-code',
        model: 'sonnet',
        models: ['sonnet'],
        reasoningEffort: 'medium',
        providerModels: {
          ...current.providerModels!,
          openrouter: { model: legacy[0]!, models: legacy },
        },
      })],
    ] as const) {
      saveMocks.boards[firstIdea.id] = board
      useGraph.setState({
        currentIdeaId: null,
        settings: {
          ...useGraph.getState().settings,
          recommendedModelCatalog: label === 'explicit-device'
            ? ['vendor/explicit-choice']
            : ['vendor/device-choice'],
          recommendedModelCatalogExplicit: label === 'explicit-device',
        },
      })
      deviceStorage.set('eido-v3-settings', JSON.stringify({
        recommendedModelCatalog: label === 'explicit-device'
          ? ['vendor/explicit-choice']
          : ['vendor/device-choice'],
        recommendedModelCatalogExplicit: label === 'explicit-device',
      }))

      await useGraph.getState().loadIdea(firstIdea.id)

      expect(useGraph.getState().settings.recommendedModelCatalog).toEqual(
        label === 'explicit-device'
          ? ['vendor/explicit-choice']
          : ['vendor/device-choice'],
      )
      expect(JSON.parse(deviceStorage.get('eido-v3-settings') ?? '{}'))
        .not.toHaveProperty('recommendedModelCatalog', expect.arrayContaining(legacy))
    }
  })

  it('switches the Idea and its existing Ask cards to the harness model list', async () => {
    await useGraph.getState().hydrate()
    useGraph.setState({
      cards: [
        {
          id: 'ask-one',
          kind: 'askAi',
          blocks: [{ id: 'ask-one-block', text: 'Ask' }],
          position: { x: 0, y: 0 },
          model: 'openai/gpt-4o-mini',
        },
        {
          id: 'group-one',
          kind: 'group',
          blocks: [{ id: 'group-one-block', text: 'Group' }],
          position: { x: 160, y: 0 },
          model: 'openai/gpt-4o-mini',
        },
      ],
    })
    saveMocks.saveIdeaBoard.mockClear()

    useGraph.getState().setProvider('claude-code')

    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalled())
    const state = useGraph.getState()
    const savedBoard = saveMocks.saveIdeaBoard.mock.calls[0]![1] as SavedBoard
    expect(state.settings).toMatchObject({
      provider: 'claude-code',
      model: 'default',
      models: ['default', 'fable', 'opus', 'sonnet', 'haiku'],
    })
    expect(state.cards[0]?.model).toBe('default')
    expect(state.cards[1]?.model).toBe('default')
    expect(savedBoard.aiSettings?.provider).toBe('claude-code')
    expect(savedBoard.aiSettings?.model).toBe('default')
  })

  it('keeps the device OpenRouter catalog out of local-provider snapshots and exports', async () => {
    await useGraph.getState().hydrate()
    const deviceCatalog = ['openai/gpt-5.6-luna', 'vendor/private-device-choice']
    const localModels = ['default', 'claude-fable-5']
    const current = useGraph.getState().settings
    useGraph.setState({
      settings: {
        ...current,
        provider: 'claude-code',
        model: 'claude-fable-5',
        models: localModels,
        providerModels: {
          ...current.providerModels!,
          openrouter: { model: deviceCatalog[0]!, models: deviceCatalog },
          'claude-code': { model: localModels[1]!, models: localModels },
        },
        recommendedModelCatalog: deviceCatalog,
        recommendedModelCatalogExplicit: true,
      },
    })

    const snapshot = useGraph.getState().snapshot()
    expect(snapshot.aiSettings?.models).toEqual(localModels)
    expect(snapshot.aiSettings?.providerModels?.['claude-code']).toEqual({
      model: localModels[1],
      models: localModels,
    })
    expect(snapshot.aiSettings?.providerModels?.openrouter).toEqual({
      model: deviceCatalog[0],
      models: [deviceCatalog[0]],
    })
    expect(snapshot.aiSettings).not.toHaveProperty('openrouterModelListFormat')

    const exported = JSON.parse(serializeIdeaExport(firstIdea, snapshot)) as IdeaExport
    expect(exported.board.aiSettings?.providerModels?.openrouter).toEqual({
      model: deviceCatalog[0],
      models: [deviceCatalog[0]],
    })
  })

  it('keeps an explicit reset to release defaults after legacy Board hydration', async () => {
    await useGraph.getState().hydrate()
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        recommendedModelCatalog: [...DEFAULT_MODEL_SLUGS],
        recommendedModelCatalogExplicit: true,
      },
    })
    saveMocks.boards[firstIdea.id] = makeBoard('reset-legacy', {
      model: 'vendor/legacy-choice',
      models: ['vendor/legacy-choice', 'vendor/older-choice'],
      reasoningEffort: 'medium',
    })

    await useGraph.getState().loadIdea(secondIdea.id)
    useGraph.setState({ currentIdeaId: null })
    await useGraph.getState().loadIdea(firstIdea.id)

    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual(DEFAULT_MODEL_SLUGS)
    expect(useGraph.getState().settings.recommendedModelCatalogExplicit).toBe(true)
    expect(useGraph.getState().settings.models).toEqual([
      ...DEFAULT_MODEL_SLUGS,
      'vendor/legacy-choice',
    ])
  })

  it('migrates a legacy local-provider Idea catalog while preserving its selected identity', async () => {
    await useGraph.getState().hydrate()
    const legacyCatalog = [
      'vendor/legacy-openrouter-one',
      'vendor/legacy-openrouter-two',
    ]
    const current = useGraph.getState().settings
    useGraph.setState({
      settings: {
        ...current,
        recommendedModelCatalog: [...DEFAULT_MODEL_SLUGS],
        recommendedModelCatalogExplicit: false,
      },
    })
    saveMocks.boards[firstIdea.id] = makeBoard('fresh-local-legacy', {
      provider: 'claude-code',
      model: 'claude-fable-5',
      models: ['default', 'claude-fable-5'],
      reasoningEffort: 'medium',
      providerModels: {
        ...current.providerModels!,
        openrouter: {
          model: legacyCatalog[0]!,
          models: legacyCatalog,
        },
        'claude-code': {
          model: 'claude-fable-5',
          models: ['default', 'claude-fable-5'],
        },
      },
    })

    // Start from a genuinely fresh renderer so another Idea cannot perform a
    // legacy migration before this local-provider Board is hydrated.
    useGraph.setState({ currentIdeaId: null })
    await useGraph.getState().loadIdea(firstIdea.id)

    expect(useGraph.getState().settings.provider).toBe('claude-code')
    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual([
      ...DEFAULT_MODEL_SLUGS,
      ...legacyCatalog,
    ])
    expect(useGraph.getState().settings.recommendedModelCatalogExplicit).toBe(false)
    expect(useGraph.getState().settings.providerModels?.openrouter).toEqual({
      model: legacyCatalog[0],
      models: [...DEFAULT_MODEL_SLUGS, ...legacyCatalog],
    })
  })

  it('migrates a structurally valid legacy OpenRouter Board model array', async () => {
    await useGraph.getState().hydrate()
    const current = useGraph.getState().settings
    useGraph.setState({
      settings: {
        ...current,
        recommendedModelCatalog: [...DEFAULT_MODEL_SLUGS],
        recommendedModelCatalogExplicit: false,
      },
    })
    saveMocks.boards[firstIdea.id] = makeBoard('legacy-board-list', {
      provider: 'claude-code',
      model: 'claude-fable-5',
      models: ['default', 'claude-fable-5'],
      providerModels: {
        ...current.providerModels!,
        openrouter: {
          model: 'vendor/profile-selected',
          models: ['vendor/profile-selected', 'vendor/profile-only-list'],
        },
        'claude-code': { model: 'claude-fable-5', models: ['default', 'claude-fable-5'] },
      },
      reasoningEffort: 'medium',
    })

    useGraph.setState({ currentIdeaId: null })
    await useGraph.getState().loadIdea(firstIdea.id)

    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual([
      ...DEFAULT_MODEL_SLUGS,
      'vendor/profile-selected',
      'vendor/profile-only-list',
    ])
    expect(useGraph.getState().settings.providerModels?.openrouter).toEqual({
      model: 'vendor/profile-selected',
      models: [...DEFAULT_MODEL_SLUGS, 'vendor/profile-selected', 'vendor/profile-only-list'],
    })
  })

  it('keeps a current selected-identity snapshot from becoming a device catalog on a fresh device', async () => {
    await useGraph.getState().hydrate()
    const selectedModel = 'vendor/current-format-selection'
    useGraph.setState({
      settings: {
        ...useGraph.getState().settings,
        recommendedModelCatalog: [...DEFAULT_MODEL_SLUGS],
        recommendedModelCatalogExplicit: false,
      },
      currentIdeaId: null,
    })
    saveMocks.boards[firstIdea.id] = makeBoard('fresh-current-format', {
      provider: 'openrouter',
      model: selectedModel,
      models: [selectedModel],
      openrouterModelListFormat: 'selected-identity',
      providerModels: {
        ...useGraph.getState().settings.providerModels!,
        openrouter: { model: selectedModel, models: [selectedModel] },
      },
      reasoningEffort: 'medium',
    } as unknown as SavedBoard['aiSettings'])

    await useGraph.getState().loadIdea(firstIdea.id)

    expect(useGraph.getState().settings.model).toBe(selectedModel)
    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual(DEFAULT_MODEL_SLUGS)
    expect(useGraph.getState().settings.recommendedModelCatalogExplicit).toBe(false)
    expect(useGraph.getState().settings.models).toEqual([
      ...DEFAULT_MODEL_SLUGS,
      selectedModel,
    ])
  })

  it('restores each provider model catalog after switching away and back', async () => {
    await useGraph.getState().hydrate()

    const providerModels = useGraph.getState().settings.providerModels!
    useGraph.getState().setProvider('claude-code', {
      ...providerModels,
      'claude-code': {
        model: 'claude-fable-5',
        models: ['sonnet', 'opus', 'haiku', 'claude-fable-5'],
      },
    })
    useGraph.getState().setProvider('codex')
    useGraph.getState().setProvider('claude-code')

    expect(useGraph.getState().settings).toMatchObject({
      provider: 'claude-code',
      model: 'claude-fable-5',
      models: ['sonnet', 'opus', 'haiku', 'claude-fable-5'],
    })
  })

  it('reloads every provider catalog from the saved Idea, including a hand-built OpenRouter list', async () => {
    await useGraph.getState().hydrate()

    const providerModels = useGraph.getState().settings.providerModels!
    useGraph.getState().setProvider('openrouter', {
      ...providerModels,
      openrouter: {
        model: 'anthropic/claude-3.5-sonnet',
        models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
      },
      'claude-code': { model: 'claude-fable-5', models: ['default', 'claude-fable-5'] },
    })
    useGraph.getState().setProvider('claude-code')
    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalled())

    // Leave the Idea entirely and come back: settings are read off the saved
    // board, not out of the state the editing session left behind.
    await useGraph.getState().loadIdea(secondIdea.id)
    await useGraph.getState().loadIdea(firstIdea.id)

    const reloaded = useGraph.getState().settings
    expect(reloaded).toMatchObject({
      provider: 'claude-code',
      model: 'claude-fable-5',
      models: ['default', 'claude-fable-5'],
    })
    // The list the user built is their data. A release that ships new default
    // slugs must not write itself over it.
    expect(reloaded.providerModels?.openrouter).toEqual({
      model: 'anthropic/claude-3.5-sonnet',
      models: [
        ...DEFAULT_MODEL_SLUGS,
        'anthropic/claude-3.5-sonnet',
        'openai/gpt-4o-mini',
      ],
    })
    expect(reloaded.providerModels?.openrouter.models).toContain(DEFAULT_MODEL_SLUGS[0])
  })

  it('defaults a legacy Idea without a provider to OpenRouter instead of leaking the previous Idea', async () => {
    await useGraph.getState().hydrate()
    useGraph.getState().setProvider('claude-code')

    await useGraph.getState().loadIdea(secondIdea.id)

    expect(useGraph.getState().settings.provider).toBe('openrouter')
    expect(useGraph.getState().settings.model).toBe('anthropic/claude-3.5-sonnet')
  })

  it('opens an Idea saved with the retired Gemini provider on Antigravity', async () => {
    await useGraph.getState().hydrate()

    await useGraph.getState().loadIdea(retiredProviderIdea.id)

    const settings = useGraph.getState().settings
    // Same vendor, still a local CLI, and a model list that means something to
    // the tool that is actually there.
    expect(settings.provider).toBe('antigravity')
    expect(settings.models).toEqual(['gemini-3.7-flash', 'gemini-3.1-pro'])
    expect(settings.model).toBe('gemini-3.7-flash')
    expect(settings.models).not.toContain('gemini-3-pro-preview')
    // The saved rung has no place on the provider this Idea now opens on, so
    // it is stepped where the provider is settled rather than only where it is
    // drawn. What Settings reads is what a run sends.
    expect(settings.reasoningEffort).toBe('low')
    expect(nearestReasoningEffort('antigravity', settings.reasoningEffort)).toBe('low')
  })

  it('commits the stepped reasoning rung when the provider drops the stored one', async () => {
    await useGraph.getState().hydrate()
    useGraph.getState().setReasoningEffort('none')
    saveMocks.saveIdeaBoard.mockClear()

    // Codex has no 'none' rung. Settings used to draw the stepped value while
    // the store, the saved Idea and every run kept the old one.
    useGraph.getState().setProvider('codex')

    const settings = useGraph.getState().settings
    expect(settings.reasoningEffort).toBe('low')
    expect(nearestReasoningEffort('codex', settings.reasoningEffort)).toBe(settings.reasoningEffort)

    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalled())
    const calls = saveMocks.saveIdeaBoard.mock.calls
    const savedBoard = calls[calls.length - 1][1] as SavedBoard
    expect(savedBoard.aiSettings?.reasoningEffort).toBe('low')
  })

  it('leaves a stored rung alone when the new provider still shows it', async () => {
    await useGraph.getState().hydrate()
    useGraph.getState().setReasoningEffort('high')

    useGraph.getState().setProvider('claude-code')

    expect(useGraph.getState().settings.reasoningEffort).toBe('high')
  })

  it('saves the Idea system prompt without changing AI card source identity', async () => {
    await useGraph.getState().hydrate()
    saveMocks.saveIdeaBoard.mockClear()
    const sourceBefore = createSourceContextSnapshot(useGraph.getState().snapshot(), [
      { cardId: 'note-one' },
    ])

    useGraph.getState().setSystemPrompt('Write for a non-technical founder.\nUse Australian English.')

    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalled())
    const savedBoard = saveMocks.saveIdeaBoard.mock.calls[saveMocks.saveIdeaBoard.mock.calls.length - 1][1] as SavedBoard
    const sourceAfter = createSourceContextSnapshot(useGraph.getState().snapshot(), [
      { cardId: 'note-one' },
    ])
    expect(savedBoard.aiSettings?.systemPrompt).toBe(
      'Write for a non-technical founder.\nUse Australian English.',
    )
    expect(sourceAfter).toEqual(sourceBefore)
  })

  it('keeps API key edits local without saving the current board', async () => {
    await useGraph.getState().hydrate()
    saveMocks.saveIdeaBoard.mockClear()

    useGraph.getState().setApiKey('new-local-secret')

    expect(useGraph.getState().settings.apiKey).toBe('new-local-secret')
    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()
  })

  it('saves the chain confirm threshold and compaction mode back through the current board', async () => {
    await useGraph.getState().hydrate()
    saveMocks.saveIdeaBoard.mockClear()

    useGraph.getState().setChainConfirmThreshold(5)
    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalled())
    let savedBoard = saveMocks.saveIdeaBoard.mock.calls[saveMocks.saveIdeaBoard.mock.calls.length - 1][1] as SavedBoard
    expect(savedBoard.aiSettings?.chainConfirmThreshold).toBe(5)
    expect(savedBoard.aiSettings?.compactionMode).toBe('when-needed')

    useGraph.getState().setCompactionMode('eager')
    await vi.waitFor(() => expect(saveMocks.saveIdeaBoard).toHaveBeenCalledTimes(2))
    savedBoard = saveMocks.saveIdeaBoard.mock.calls[saveMocks.saveIdeaBoard.mock.calls.length - 1][1] as SavedBoard
    expect(savedBoard.aiSettings?.compactionMode).toBe('eager')
    expect(savedBoard.aiSettings?.chainConfirmThreshold).toBe(5)
  })

  it('never saves a negative or fractional chain confirm threshold', async () => {
    await useGraph.getState().hydrate()

    useGraph.getState().setChainConfirmThreshold(-3)
    expect(useGraph.getState().settings.chainConfirmThreshold).toBe(0)

    useGraph.getState().setChainConfirmThreshold(2.7)
    expect(useGraph.getState().settings.chainConfirmThreshold).toBe(2)
  })

  it('loads old boards without AI settings using sane defaults', async () => {
    saveMocks.boards[secondIdea.id] = makeBoard('old-board')

    await useGraph.getState().loadIdea(secondIdea.id)

    expect(useGraph.getState().settings.apiKey).toBe('local-secret-key')
    expect(useGraph.getState().settings.provider).toBe('openrouter')
    expect(useGraph.getState().settings.model).toBeTruthy()
    expect(useGraph.getState().settings.models.length).toBeGreaterThan(0)
    expect(useGraph.getState().settings.models).toContain(useGraph.getState().settings.model)
    expect(useGraph.getState().settings.reasoningEffort).toBe('medium')
  })

  it('does not migrate a legacy list that collapses below two unique valid slugs', async () => {
    const deviceStorage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => deviceStorage.get(key) ?? null,
        setItem: (key: string, value: string) => { deviceStorage.set(key, value) },
        removeItem: (key: string) => { deviceStorage.delete(key) },
      },
    })
    await useGraph.getState().hydrate()
    const current = useGraph.getState().settings
    saveMocks.boards[secondIdea.id] = makeBoard('legacy-duplicate-only', {
      provider: 'claude-code',
      model: 'sonnet',
      models: ['sonnet'],
      providerModels: {
        ...current.providerModels!,
        openrouter: {
          model: 'vendor/only',
          models: ['vendor/only', 'vendor/only', 'not-a-slug'],
        },
      },
      reasoningEffort: 'medium',
    })
    useGraph.setState({
      currentIdeaId: null,
      settings: {
        ...current,
        recommendedModelCatalog: ['vendor/device-choice'],
        recommendedModelCatalogExplicit: false,
      },
    })

    await useGraph.getState().loadIdea(secondIdea.id)

    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual(['vendor/device-choice'])
    expect(deviceStorage.has('eido-v3-settings')).toBe(false)
  })

  it('keeps legacy catalog migration a no-op during synthetic Profile Review', async () => {
    const deviceStorage = new Map<string, string>()
    vi.stubGlobal('window', {
      eidoDesktop: true,
      eidoProfileReview: true,
      localStorage: {
        getItem: (key: string) => deviceStorage.get(key) ?? null,
        setItem: (key: string, value: string) => { deviceStorage.set(key, value) },
        removeItem: (key: string) => { deviceStorage.delete(key) },
      },
    })
    await useGraph.getState().hydrate()
    const current = useGraph.getState().settings
    saveMocks.boards[secondIdea.id] = makeBoard('review-legacy-list', {
      provider: 'claude-code',
      model: 'sonnet',
      models: ['sonnet'],
      providerModels: {
        ...current.providerModels!,
        openrouter: {
          model: 'vendor/review-one',
          models: ['vendor/review-one', 'vendor/review-two'],
        },
      },
      reasoningEffort: 'medium',
    })
    useGraph.setState({
      currentIdeaId: null,
      settings: {
        ...current,
        recommendedModelCatalog: ['vendor/device-choice'],
        recommendedModelCatalogExplicit: false,
      },
    })

    await useGraph.getState().loadIdea(secondIdea.id)

    expect(useGraph.getState().settings.model).toBe(PROFILE_REVIEW_MODEL)
    expect(useGraph.getState().settings.recommendedModelCatalog).toEqual(['vendor/device-choice'])
    expect(deviceStorage.has('eido-v3-settings')).toBe(false)
  })

  it('projects one review model and fails closed on credential or model edits', async () => {
    vi.stubGlobal('window', {
      eidoDesktop: true,
      eidoProfileReview: true,
    })

    await useGraph.getState().loadIdea(secondIdea.id)
    useGraph.setState({
      cards: [{
        id: 'ask-review',
        kind: 'askAi',
        blocks: [{ id: 'ask-review-block', text: 'Review this.' }],
        position: { x: 0, y: 0 },
        model: 'historical/override',
      }],
    })
    saveMocks.saveIdeaBoard.mockClear()

    expect(useGraph.getState().settings).toMatchObject({
      model: PROFILE_REVIEW_MODEL,
      models: [PROFILE_REVIEW_MODEL],
    })
    await expect(useGraph.getState().setApiKey('attempted-change')).rejects.toThrow(
      'Development Profile review credential is read-only',
    )
    useGraph.getState().setProvider('claude-code')
    useGraph.getState().setCardModel('ask-review', 'another/card-model')

    expect(useGraph.getState().settings).toMatchObject({
      model: PROFILE_REVIEW_MODEL,
      models: [PROFILE_REVIEW_MODEL],
    })
    expect(useGraph.getState().cards[0]?.model).toBe('historical/override')
    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()
  })
})
