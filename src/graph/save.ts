// Local-first Ideas database. Each Idea is a named workspace with one full
// board snapshot. The old single-board store remains readable for migration.

import { newId } from '../shared/ids'
import {
  diskCreateIdea,
  diskDeleteIdea,
  diskImportBrowserStore,
  diskListIdeas,
  diskLoadIdea,
  diskLoadInitialIdea,
  diskRenameIdea,
  diskSaveIdeaBoard,
  diskStorageStatus,
  type BrowserStoreSnapshot,
} from './diskApi'
import type { Card, IdeaSummary, IntentLogEvent, RunRecord, SavedBoard } from './types'

const DB_NAME = 'eido-v3'
const LEGACY_STORE = 'board'
const LEGACY_KEY = 'current'
const IDEA_STORE = 'ideas'
const BOARD_STORE = 'ideaBoards'
const META_STORE = 'meta'
const ACTIVE_IDEA_KEY = 'activeIdeaId'

export type IdeaWithBoard = {
  idea: IdeaSummary
  board: SavedBoard
}

export type StorageBackend = 'disk' | 'browser'

export type StorageStatus =
  | {
      backend: 'disk'
      dataFile: string
      warning?: undefined
    }
  | {
      backend: 'browser'
      dataFile?: undefined
      warning: string
    }

const BROWSER_STORAGE_WARNING =
  'Saved in this browser for this address only. Use the same host and port to see this work.'

// Fields Eido used to write and no longer understands. They are dropped here
// rather than preserved, because the persistence validators reject keys that
// are not on the current allowlist, and the intent log clones whole Cards and
// Runs into its events. A retired field must therefore leave every one of those
// places at once or the next load fails.
type RetiredCard = Card & {
  intentSignal?: unknown
  intentSignalSetAt?: unknown
  mod?: unknown
  // Retired with pre-flight web research (ADR 0033). Its replacement is a
  // different question ("may this run use tools?") so it is dropped, not
  // renamed.
  searchWeb?: unknown
}
type RetiredRun = RunRecord & { intent?: unknown; webSources?: unknown }

function stripRetiredCardFields(card: Card): Card {
  const {
    intentSignal: _intentSignal,
    intentSignalSetAt: _intentSignalSetAt,
    mod: _legacyMod,
    searchWeb: _searchWeb,
    ...clean
  } = card as RetiredCard
  return clean
}

function stripRetiredRunFields(run: RunRecord): RunRecord {
  const { intent: _intent, webSources: _webSources, ...clean } = run as RetiredRun
  if (!clean.conversation) return clean

  const { intent: _conversationIntent, ...conversation } = clean.conversation as typeof clean.conversation & {
    intent?: unknown
  }
  return {
    ...clean,
    conversation: {
      ...conversation,
      participants: conversation.participants.map((participant) => {
        const { intent: _participantIntent, ...rest } = participant as typeof participant & { intent?: unknown }
        return rest
      }),
      sharedContext: conversation.sharedContext.map((entry) => {
        const { intent: _entryIntent, ...rest } = entry as typeof entry & { intent?: unknown }
        return rest
      }),
    },
  }
}

function stripRetiredFieldsFromEvent(event: IntentLogEvent): IntentLogEvent | null {
  if ((event as { type: string }).type === 'intent.changed') return null

  if (event.type === 'card.created' || event.type === 'group.created' || event.type === 'card.deleted') {
    return {
      ...event,
      data: { ...event.data, card: stripRetiredCardFields(event.data.card) },
    } as IntentLogEvent
  }

  if (
    event.type === 'run.started' ||
    event.type === 'run.continued' ||
    event.type === 'run.completed' ||
    event.type === 'run.failed' ||
    event.type === 'run.canceled' ||
    event.type === 'group.compression.started' ||
    event.type === 'group.compression.completed' ||
    event.type === 'group.compression.failed' ||
    event.type === 'group.compression.canceled'
  ) {
    return { ...event, data: { ...event.data, run: stripRetiredRunFields(event.data.run) } }
  }

  return event
}

let selectedStorage: StorageStatus | null = null

export function makeSavedBoard(partial: Partial<SavedBoard> = {}): SavedBoard {
  // Pure shape defaulting + retired-field stripping. Legacy highlight
  // migration is NOT run here — that belongs only on the load path
  // (normalizeBoardForRuntime in store.ts) so that snapshot() never strips
  // user-typed ==marks== or mints stale highlight IDs against live state.
  return {
    version: 1,
    cards: (partial.cards ?? []).map(stripRetiredCardFields),
    connections: partial.connections ?? [],
    outputs: partial.outputs ?? [],
    runs: (partial.runs ?? []).map(stripRetiredRunFields),
    highlights: Array.isArray(partial.highlights) ? partial.highlights : [],
    highlightTags: Array.isArray(partial.highlightTags) ? partial.highlightTags : [],
    intentLog: Array.isArray(partial.intentLog)
      ? partial.intentLog.flatMap((event) => stripRetiredFieldsFromEvent(event) ?? [])
      : [],
    compactionSummaries: Array.isArray(partial.compactionSummaries) ? partial.compactionSummaries : [],
    ...(partial.aiSettings !== undefined ? { aiSettings: partial.aiSettings } : {}),
    // The Board's settings envelope (ADR 0040) is copied through verbatim and
    // never inspected. This function is the load path's normaliser, so reading
    // or rewriting a key here is exactly how an older build would destroy a
    // newer build's Board-level preference. Absent stays absent.
    ...(partial.settings !== undefined ? { settings: partial.settings } : {}),
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  }
}

export function emptyBoard(): SavedBoard {
  return makeSavedBoard({ updatedAt: new Date().toISOString() })
}

export function currentStorageStatus(): StorageStatus | null {
  return selectedStorage
}

export function resetStorageBackendForTests() {
  selectedStorage = null
}

async function chooseStorage(): Promise<StorageStatus> {
  if (selectedStorage) return selectedStorage
  const status = await diskStorageStatus()
  selectedStorage = status
    ? { backend: 'disk', dataFile: status.dataFile }
    : { backend: 'browser', warning: BROWSER_STORAGE_WARNING }
  return selectedStorage
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE)
      if (!db.objectStoreNames.contains(IDEA_STORE)) db.createObjectStore(IDEA_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BOARD_STORE)) db.createObjectStore(BOARD_STORE)
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function ideaNameFromBoard(board: SavedBoard): string {
  const firstNamedCard = board.cards.find((card) => card.title?.trim() || card.blocks.some((b) => b.text.trim()))
  const raw = firstNamedCard?.title?.trim() || firstNamedCard?.blocks.find((b) => b.text.trim())?.text.trim()
  return raw ? raw.slice(0, 48) : 'Untitled idea'
}

function sortIdeas(ideas: IdeaSummary[]): IdeaSummary[] {
  return [...ideas].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt) || b.updatedAt.localeCompare(a.updatedAt))
}

async function loadLegacyBoard(db: IDBDatabase): Promise<SavedBoard | null> {
  if (!db.objectStoreNames.contains(LEGACY_STORE)) return null
  try {
    const tx = db.transaction(LEGACY_STORE, 'readonly')
    const board = await reqToPromise(tx.objectStore(LEGACY_STORE).get(LEGACY_KEY))
    return (board as SavedBoard) ?? null
  } catch {
    return null
  }
}

async function browserListIdeas(): Promise<IdeaSummary[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(IDEA_STORE, 'readonly')
    const ideas = await reqToPromise(tx.objectStore(IDEA_STORE).getAll())
    return sortIdeas(ideas as IdeaSummary[])
  } finally {
    db.close()
  }
}

async function browserLoadIdea(id: string): Promise<IdeaWithBoard | null> {
  const db = await openDb()
  try {
    const readTx = db.transaction([IDEA_STORE, BOARD_STORE], 'readonly')
    const ideaReq = readTx.objectStore(IDEA_STORE).get(id)
    const boardReq = readTx.objectStore(BOARD_STORE).get(id)
    const [idea, board] = (await Promise.all([reqToPromise(ideaReq), reqToPromise(boardReq)])) as [
      IdeaSummary | undefined,
      SavedBoard | undefined,
    ]
    if (!idea || !board) return null

    const opened: IdeaSummary = { ...idea, lastOpenedAt: new Date().toISOString() }
    const writeTx = db.transaction([IDEA_STORE, META_STORE], 'readwrite')
    writeTx.objectStore(IDEA_STORE).put(opened)
    writeTx.objectStore(META_STORE).put(id, ACTIVE_IDEA_KEY)
    await txDone(writeTx)
    return { idea: opened, board }
  } finally {
    db.close()
  }
}

async function browserLoadInitialIdea(): Promise<IdeaWithBoard & { ideas: IdeaSummary[] }> {
  const db = await openDb()
  try {
    const ideasTx = db.transaction([IDEA_STORE, META_STORE], 'readonly')
    const ideasReq = ideasTx.objectStore(IDEA_STORE).getAll()
    const activeReq = ideasTx.objectStore(META_STORE).get(ACTIVE_IDEA_KEY)
    const [rawIdeas, activeId] = (await Promise.all([reqToPromise(ideasReq), reqToPromise(activeReq)])) as [
      IdeaSummary[],
      string | undefined,
    ]
    const ideas = sortIdeas(rawIdeas)

    if (ideas.length > 0) {
      const preferred = activeId && ideas.some((idea) => idea.id === activeId) ? activeId : ideas[0].id
      const loaded = await browserLoadIdea(preferred)
      if (loaded) {
        const latestIdeas = await browserListIdeas()
        return { ...loaded, ideas: latestIdeas }
      }
    }

    const legacyBoard = (await loadLegacyBoard(db)) ?? emptyBoard()
    const created = await browserCreateIdea(ideaNameFromBoard(legacyBoard), legacyBoard)
    return { ...created, ideas: [created.idea] }
  } finally {
    db.close()
  }
}

async function browserCreateIdea(name: string, board: SavedBoard = emptyBoard()): Promise<IdeaWithBoard> {
  const db = await openDb()
  const now = new Date().toISOString()
  const id = newId('idea')
  const idea: IdeaSummary = {
    id,
    name: name.trim() || 'Untitled idea',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  }
  const savedBoard: SavedBoard = { ...board, updatedAt: now }
  try {
    const tx = db.transaction([IDEA_STORE, BOARD_STORE, META_STORE], 'readwrite')
    tx.objectStore(IDEA_STORE).put(idea)
    tx.objectStore(BOARD_STORE).put(savedBoard, id)
    tx.objectStore(META_STORE).put(id, ACTIVE_IDEA_KEY)
    await txDone(tx)
    return { idea, board: savedBoard }
  } finally {
    db.close()
  }
}

async function browserSaveIdeaBoard(id: string, board: SavedBoard): Promise<IdeaSummary> {
  const db = await openDb()
  const now = new Date().toISOString()
  const savedBoard: SavedBoard = { ...board, updatedAt: now }
  try {
    const readTx = db.transaction(IDEA_STORE, 'readonly')
    const existing = (await reqToPromise(readTx.objectStore(IDEA_STORE).get(id))) as IdeaSummary | undefined
    const idea: IdeaSummary = {
      id,
      name: existing?.name ?? ideaNameFromBoard(savedBoard),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastOpenedAt: existing?.lastOpenedAt ?? now,
    }
    const writeTx = db.transaction([IDEA_STORE, BOARD_STORE], 'readwrite')
    writeTx.objectStore(IDEA_STORE).put(idea)
    writeTx.objectStore(BOARD_STORE).put(savedBoard, id)
    await txDone(writeTx)
    return idea
  } finally {
    db.close()
  }
}

async function browserRenameIdea(id: string, name: string): Promise<IdeaSummary | null> {
  const db = await openDb()
  try {
    const readTx = db.transaction(IDEA_STORE, 'readonly')
    const existing = (await reqToPromise(readTx.objectStore(IDEA_STORE).get(id))) as IdeaSummary | undefined
    if (!existing) return null
    const idea: IdeaSummary = {
      ...existing,
      name: name.trim() || existing.name,
      updatedAt: new Date().toISOString(),
    }
    const writeTx = db.transaction(IDEA_STORE, 'readwrite')
    writeTx.objectStore(IDEA_STORE).put(idea)
    await txDone(writeTx)
    return idea
  } finally {
    db.close()
  }
}

async function browserDeleteIdea(id: string): Promise<string | null> {
  let activeId: string | undefined
  const db = await openDb()
  try {
    const readTx = db.transaction(META_STORE, 'readonly')
    activeId = (await reqToPromise(readTx.objectStore(META_STORE).get(ACTIVE_IDEA_KEY))) as string | undefined
    const writeTx = db.transaction([IDEA_STORE, BOARD_STORE, META_STORE], 'readwrite')
    writeTx.objectStore(IDEA_STORE).delete(id)
    writeTx.objectStore(BOARD_STORE).delete(id)
    if (activeId === id) writeTx.objectStore(META_STORE).delete(ACTIVE_IDEA_KEY)
    await txDone(writeTx)
  } finally {
    db.close()
  }

  const remaining = await browserListIdeas()
  if (activeId && activeId !== id && remaining.some((idea) => idea.id === activeId)) return activeId
  if (remaining.length === 0) {
    const created = await browserCreateIdea('Untitled idea')
    return created.idea.id
  }
  const nextId = remaining[0].id
  await browserLoadIdea(nextId)
  return nextId
}

async function browserGetActiveIdeaId(): Promise<string | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(META_STORE, 'readonly')
    return ((await reqToPromise(tx.objectStore(META_STORE).get(ACTIVE_IDEA_KEY))) as string | undefined) ?? null
  } finally {
    db.close()
  }
}

// One seam owns persistence (#153). Both backends implement this interface, the
// chooser picks one, and every public function below delegates to it — no call
// site (and none of these functions) branches on which backend it hit. A future
// backend is a third implementation registered in resolveStore(), nothing else.
export interface IdeaStore {
  listIdeas(): Promise<IdeaSummary[]>
  loadIdea(id: string): Promise<IdeaWithBoard | null>
  loadInitialIdea(): Promise<IdeaWithBoard & { ideas: IdeaSummary[] }>
  createIdea(name: string, board: SavedBoard): Promise<IdeaWithBoard>
  saveIdeaBoard(id: string, board: SavedBoard): Promise<IdeaSummary>
  renameIdea(id: string, name: string): Promise<IdeaSummary | null>
  deleteIdea(id: string): Promise<string | null>
  getActiveIdeaId(): Promise<string | null>
}

// The local disk API (the /api/eido server). On first load it migrates any
// meaningful origin-scoped browser store into the disk store, best-effort.
const diskIdeaStore: IdeaStore = {
  listIdeas: diskListIdeas,
  loadIdea: diskLoadIdea,
  async loadInitialIdea() {
    try {
      const browserStore = await readMeaningfulBrowserStore()
      if (browserStore) await diskImportBrowserStore(browserStore)
    } catch {
      /* Migration is best-effort; the disk store is still the source of truth. */
    }
    return diskLoadInitialIdea()
  },
  createIdea: diskCreateIdea,
  saveIdeaBoard: diskSaveIdeaBoard,
  renameIdea: diskRenameIdea,
  deleteIdea: diskDeleteIdea,
  async getActiveIdeaId() {
    return (await diskLoadInitialIdea()).idea.id
  },
}

// Origin-scoped IndexedDB, the fallback when the disk API is unreachable.
const browserIdeaStore: IdeaStore = {
  listIdeas: browserListIdeas,
  loadIdea: browserLoadIdea,
  loadInitialIdea: browserLoadInitialIdea,
  createIdea: browserCreateIdea,
  saveIdeaBoard: browserSaveIdeaBoard,
  renameIdea: browserRenameIdea,
  deleteIdea: browserDeleteIdea,
  getActiveIdeaId: browserGetActiveIdeaId,
}

async function resolveStore(): Promise<IdeaStore> {
  return (await chooseStorage()).backend === 'disk' ? diskIdeaStore : browserIdeaStore
}

export async function listIdeas(): Promise<IdeaSummary[]> {
  return (await resolveStore()).listIdeas()
}

export async function loadIdea(id: string): Promise<IdeaWithBoard | null> {
  return (await resolveStore()).loadIdea(id)
}

export async function loadInitialIdea(): Promise<IdeaWithBoard & { ideas: IdeaSummary[] }> {
  return (await resolveStore()).loadInitialIdea()
}

export async function createIdea(name: string, board: SavedBoard = emptyBoard()): Promise<IdeaWithBoard> {
  return (await resolveStore()).createIdea(name, board)
}

export async function saveIdeaBoard(id: string, board: SavedBoard): Promise<IdeaSummary> {
  return (await resolveStore()).saveIdeaBoard(id, board)
}

export async function renameIdea(id: string, name: string): Promise<IdeaSummary | null> {
  return (await resolveStore()).renameIdea(id, name)
}

export async function deleteIdea(id: string): Promise<string | null> {
  return (await resolveStore()).deleteIdea(id)
}

export async function getActiveIdeaId(): Promise<string | null> {
  return (await resolveStore()).getActiveIdeaId()
}

async function readMeaningfulBrowserStore(): Promise<BrowserStoreSnapshot | null> {
  const db = await openDb()
  try {
    const tx = db.transaction([IDEA_STORE, BOARD_STORE, META_STORE], 'readonly')
    const ideasReq = tx.objectStore(IDEA_STORE).getAll()
    const activeReq = tx.objectStore(META_STORE).get(ACTIVE_IDEA_KEY)
    const [rawIdeas, activeId] = (await Promise.all([reqToPromise(ideasReq), reqToPromise(activeReq)])) as [
      IdeaSummary[],
      string | undefined,
    ]
    const boards: Record<string, SavedBoard> = {}
    if (rawIdeas.length > 0) {
      const boardTx = db.transaction(BOARD_STORE, 'readonly')
      const boardStore = boardTx.objectStore(BOARD_STORE)
      await Promise.all(
        rawIdeas.map(async (idea) => {
          const board = (await reqToPromise(boardStore.get(idea.id))) as SavedBoard | undefined
          if (board) boards[idea.id] = board
        }),
      )
    }

    const meaningfulIdeas = rawIdeas.filter((idea) => isMeaningfulIdea(idea, boards[idea.id]))
    if (meaningfulIdeas.length > 0) {
      return {
        version: 1,
        ideas: meaningfulIdeas,
        boards: Object.fromEntries(meaningfulIdeas.map((idea) => [idea.id, boards[idea.id]])),
        activeIdeaId: activeId && meaningfulIdeas.some((idea) => idea.id === activeId) ? activeId : meaningfulIdeas[0].id,
      }
    }

    const legacyBoard = await loadLegacyBoard(db)
    if (legacyBoard && boardHasContent(legacyBoard)) {
      const now = new Date().toISOString()
      const idea: IdeaSummary = {
        id: newId('idea'),
        name: ideaNameFromBoard(legacyBoard),
        createdAt: now,
        updatedAt: legacyBoard.updatedAt || now,
        lastOpenedAt: now,
      }
      return {
        version: 1,
        ideas: [idea],
        boards: { [idea.id]: legacyBoard },
        activeIdeaId: idea.id,
      }
    }

    return null
  } finally {
    db.close()
  }
}

function isMeaningfulIdea(idea: IdeaSummary, board?: SavedBoard): boolean {
  if (!board) return false
  if (idea.name.trim() && idea.name.trim() !== 'Untitled idea') return true
  return boardHasContent(board)
}

function boardHasContent(board: SavedBoard): boolean {
  return board.cards.length > 0 || board.connections.length > 0 || board.outputs.length > 0 || board.runs.length > 0
}

/**
 * A pending browser-development save can carry either an already-built value
 * or a lazy source for one. The latter is important for the high-frequency
 * path: scheduling a save must not walk/clone a large Board (or construct a
 * compound `{ ideaId, board }` request) just to replace it again on the next
 * keystroke or gesture frame.
 */
export type DebouncedSaveSource<T = SavedBoard> = T | (() => T)

export type DebouncedSaver<T = SavedBoard> = ((source: DebouncedSaveSource<T>) => void) & {
  flush: () => Promise<void>
}

export function makeDebouncedSaver<T>(
  delayMs: number,
  onState: (s: 'saving' | 'saved' | 'failed') => void,
  save: (value: T) => Promise<void>,
): DebouncedSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let latest: DebouncedSaveSource<T> | null = null
  let failedSource: DebouncedSaveSource<T> | null = null
  let lastError: unknown = null
  let drainPromise: Promise<void> | null = null
  let flushActive = false

  const drain = async () => {
    // Keep one writer in flight. If more work arrives while the previous
    // write is awaiting disk, the loop consumes the newest pending source
    // afterwards instead of starting concurrent writes that can land out of
    // order.
    // A source scheduled while another write is in flight still owns its
    // quiet-period timer. Do not let the older write's completion pull that
    // source forward; the timer callback will start the next drain at the
    // intended deadline (or an explicit flush may cancel it deliberately).
    while (latest && (!timer || flushActive)) {
      const source = latest
      latest = null

      let toSave: T
      try {
        toSave = typeof source === 'function' ? (source as () => T)() : source
      } catch (error) {
        if (!latest) failedSource = source
        lastError = error
        onState('failed')
        return
      }

      onState('saving')
      try {
        await save(toSave)
        failedSource = null
        lastError = null
        // Keep the status dirty while a newer source is pending. In
        // particular, an older write must not briefly claim "saved" during a
        // three-second quiet period for newer edits.
        if (!latest) onState('saved')
      } catch (error) {
        // Retain the exact failed source when no newer state supersedes it.
        // Timer drains report the failure without creating an unhandled
        // rejection; an explicit lifecycle flush retries it and rejects if
        // durability still cannot be established.
        if (!latest) failedSource = source
        lastError = error
        onState('failed')
        return
      }
    }
  }

  const startDrain = () => {
    if (!drainPromise) {
      const promise = drain()
      // Keep the tracked promise itself responsible for clearing the active
      // barrier before it resolves. This lets an explicit flush observe a
      // source scheduled during the final write without racing a detached
      // `finally()` callback.
      const tracked = promise.finally(() => {
        if (drainPromise === tracked) drainPromise = null
      })
      drainPromise = tracked
    }
    return drainPromise
  }

  const schedule = ((source: DebouncedSaveSource<T>) => {
    latest = source
    failedSource = null
    if (timer) clearTimeout(timer)
    timer = null
    if (flushActive) {
      // A checkpoint/lifecycle flush is a hard durability barrier. New work
      // arriving while its writer is in flight joins that drain immediately;
      // it must not acquire a quiet timer that could outlive the flush.
      void startDrain()
      return
    }
    timer = setTimeout(() => {
      timer = null
      void startDrain()
    }, delayMs)
  }) as DebouncedSaver<T>

  schedule.flush = async () => {
    flushActive = true
    if (timer) clearTimeout(timer)
    timer = null
    try {
      if (!latest && failedSource) {
        latest = failedSource
        failedSource = null
      }
      // Await the current writer and any sources scheduled while it is in
      // flight. `schedule()` above starts those sources immediately, while
      // this loop also covers a source arriving between drain completion and
      // the flush continuation.
      while (latest || drainPromise) await startDrain()
      if (lastError) throw lastError
    } finally {
      flushActive = false
    }
  }

  return schedule
}
