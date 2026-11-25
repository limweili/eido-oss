import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import type { Connect, Plugin } from 'vite'
import {
  mergeBrowserStore,
  preserveAssetDataUrls,
  type IdeaStore,
} from '../../src/graph/storageMerge'
import type { IdeaSummary, SavedBoard } from '../../src/graph/types'

type DiskStore = IdeaStore

type JsonBody = Record<string, unknown>

const API_PREFIX = '/api/eido'
const DEFAULT_DATA_FILE = path.join(os.homedir(), '.eido', 'eido-v3-ideas.json')
const RECOVERY_BACKUP_LIMIT = 20

export function eidoStoragePlugin(): Plugin {
  return {
    name: 'eido-storage',
    configureServer(server) {
      server.middlewares.use(createStorageHandler())
    },
    configurePreviewServer(server) {
      server.middlewares.use(createStorageHandler())
    },
  }
}

function createStorageHandler(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://eido.local')
    if (!url.pathname.startsWith(API_PREFIX)) {
      next()
      return
    }

    try {
      await routeRequest(req, res, url)
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Couldn't save",
      })
    }
  }
}

async function routeRequest(req: IncomingMessage, res: ServerResponse, url: URL) {
  const method = req.method ?? 'GET'
  const route = url.pathname.slice(API_PREFIX.length) || '/'
  const idMatch = route.match(/^\/ideas\/([^/]+)(?:\/board)?$/)

  if (method === 'GET' && route === '/status') {
    const store = await readStore()
    sendJson(res, 200, {
      ok: true,
      dataFile: dataFilePath(),
      ideaCount: store.ideas.length,
      hasUserContent: storeHasUserContent(store),
    })
    return
  }

  if (method === 'POST' && route === '/import-browser-store') {
    const body = await readJsonBody(req)
    const imported = await importBrowserStore(body)
    sendJson(res, 200, imported)
    return
  }

  if (method === 'GET' && route === '/ideas') {
    const store = await readStore()
    sendJson(res, 200, { ideas: sortIdeas(store.ideas) })
    return
  }

  if (method === 'GET' && route === '/initial') {
    const loaded = await loadInitialIdea()
    sendJson(res, 200, loaded)
    return
  }

  if (method === 'POST' && route === '/ideas') {
    const body = await readJsonBody(req)
    const name = typeof body.name === 'string' ? body.name : 'Untitled idea'
    const board = isSavedBoard(body.board) ? body.board : emptyBoard()
    const created = await createIdea(name, board)
    sendJson(res, 200, created)
    return
  }

  if (idMatch && method === 'GET' && !route.endsWith('/board')) {
    const loaded = await openIdea(decodeURIComponent(idMatch[1]))
    if (!loaded) {
      sendJson(res, 404, { error: 'Idea not found' })
      return
    }
    sendJson(res, 200, loaded)
    return
  }

  if (idMatch && method === 'PUT' && route.endsWith('/board')) {
    const body = await readJsonBody(req)
    if (!isSavedBoard(body.board)) {
      sendJson(res, 400, { error: 'Invalid board' })
      return
    }
    const idea = await saveIdeaBoard(decodeURIComponent(idMatch[1]), body.board)
    sendJson(res, 200, { idea })
    return
  }

  if (idMatch && method === 'PATCH' && !route.endsWith('/board')) {
    const body = await readJsonBody(req)
    const name = typeof body.name === 'string' ? body.name : ''
    const idea = await renameIdea(decodeURIComponent(idMatch[1]), name)
    if (!idea) {
      sendJson(res, 404, { error: 'Idea not found' })
      return
    }
    sendJson(res, 200, { idea })
    return
  }

  if (idMatch && method === 'DELETE' && !route.endsWith('/board')) {
    const nextId = await deleteIdea(decodeURIComponent(idMatch[1]))
    sendJson(res, 200, { nextId })
    return
  }

  sendJson(res, 404, { error: 'Unknown Eido storage route' })
}

async function readStore(): Promise<DiskStore> {
  try {
    const raw = await fs.readFile(dataFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<DiskStore>
    return normalizeStore(parsed)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return emptyStore()
    throw error
  }
}

async function writeStore(store: DiskStore) {
  const file = dataFilePath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await fs.rename(tempFile, file)
}

function dataFilePath() {
  return process.env.EIDO_DATA_FILE ? path.resolve(process.env.EIDO_DATA_FILE) : DEFAULT_DATA_FILE
}

function emptyStore(): DiskStore {
  return { version: 1, ideas: [], boards: {}, activeIdeaId: null }
}

function normalizeStore(value: Partial<DiskStore>): DiskStore {
  const boards = value.boards && typeof value.boards === 'object' ? value.boards : {}
  const ideas = Array.isArray(value.ideas)
    ? value.ideas.filter((idea): idea is IdeaSummary => isIdeaSummary(idea) && isSavedBoard(boards[idea.id]))
    : []
  const activeIdeaId =
    typeof value.activeIdeaId === 'string' && ideas.some((idea) => idea.id === value.activeIdeaId)
      ? value.activeIdeaId
      : ideas[0]?.id ?? null

  return {
    version: 1,
    ideas,
    boards: Object.fromEntries(ideas.map((idea) => [idea.id, boards[idea.id]])),
    activeIdeaId,
  }
}

async function loadInitialIdea() {
  const store = await readStore()
  if (store.ideas.length === 0) {
    const created = await createIdea('Untitled idea', emptyBoard())
    return { ...created, ideas: [created.idea] }
  }

  const preferredId =
    store.activeIdeaId && store.ideas.some((idea) => idea.id === store.activeIdeaId)
      ? store.activeIdeaId
      : sortIdeas(store.ideas)[0].id
  const loaded = await openIdea(preferredId)
  if (!loaded) throw new Error('Active idea could not be loaded')
  const nextStore = await readStore()
  return { ...loaded, ideas: sortIdeas(nextStore.ideas) }
}

async function openIdea(id: string) {
  const store = await readStore()
  const idea = store.ideas.find((item) => item.id === id)
  const board = store.boards[id]
  if (!idea || !board) return null

  const opened = { ...idea, lastOpenedAt: new Date().toISOString() }
  const nextStore: DiskStore = {
    ...store,
    activeIdeaId: id,
    ideas: store.ideas.map((item) => (item.id === id ? opened : item)),
  }
  await writeStore(nextStore)
  return { idea: opened, board }
}

async function createIdea(name: string, board: SavedBoard) {
  const store = await readStore()
  const now = new Date().toISOString()
  const id = newId('idea')
  const idea: IdeaSummary = {
    id,
    name: name.trim() || 'Untitled idea',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  }
  const savedBoard = { ...board, updatedAt: now }
  const nextStore: DiskStore = {
    ...store,
    activeIdeaId: id,
    ideas: [...store.ideas, idea],
    boards: { ...store.boards, [id]: savedBoard },
  }
  await writeStore(nextStore)
  return { idea, board: savedBoard }
}

async function saveIdeaBoard(id: string, board: SavedBoard) {
  const store = await readStore()
  const now = new Date().toISOString()
  const savedBoard = { ...preserveAssetDataUrls(board, store.boards[id]), updatedAt: now }
  const existing = store.ideas.find((idea) => idea.id === id)
  const idea: IdeaSummary = {
    id,
    name: existing?.name ?? ideaNameFromBoard(savedBoard),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastOpenedAt: existing?.lastOpenedAt ?? now,
  }
  const ideas = existing
    ? store.ideas.map((item) => (item.id === id ? idea : item))
    : [...store.ideas, idea]
  await writeStore({
    ...store,
    ideas,
    boards: { ...store.boards, [id]: savedBoard },
    activeIdeaId: store.activeIdeaId ?? id,
  })
  return idea
}

async function renameIdea(id: string, name: string) {
  const store = await readStore()
  const existing = store.ideas.find((idea) => idea.id === id)
  if (!existing) return null
  const idea = { ...existing, name: name.trim() || existing.name, updatedAt: new Date().toISOString() }
  await writeStore({
    ...store,
    ideas: store.ideas.map((item) => (item.id === id ? idea : item)),
  })
  return idea
}

async function deleteIdea(id: string) {
  const store = await readStore()
  const remainingIdeas = store.ideas.filter((idea) => idea.id !== id)
  const { [id]: _deleted, ...remainingBoards } = store.boards
  let nextStore: DiskStore = {
    ...store,
    ideas: remainingIdeas,
    boards: remainingBoards,
    activeIdeaId: store.activeIdeaId === id ? remainingIdeas[0]?.id ?? null : store.activeIdeaId,
  }

  if (nextStore.ideas.length === 0) {
    await writeStore(nextStore)
    const created = await createIdea('Untitled idea', emptyBoard())
    return created.idea.id
  }

  await writeStore(nextStore)
  if (nextStore.activeIdeaId) await openIdea(nextStore.activeIdeaId)
  nextStore = await readStore()
  return nextStore.activeIdeaId
}

async function importBrowserStore(body: JsonBody) {
  const incomingIdeas = Array.isArray(body.ideas)
    ? body.ideas.filter((idea): idea is IdeaSummary => isIdeaSummary(idea))
    : []
  const incomingBoards =
    body.boards && typeof body.boards === 'object' ? (body.boards as Record<string, unknown>) : {}
  const activeIdeaId = typeof body.activeIdeaId === 'string' ? body.activeIdeaId : null
  const meaningfulIdeas = incomingIdeas.filter((idea) => isMeaningfulIdea(idea, incomingBoards[idea.id]))
  if (meaningfulIdeas.length === 0) {
    return {
      imported: 0,
      replaced: 0,
      skipped: 0,
      recoveredConflicts: 0,
      ideas: (await readStore()).ideas,
    }
  }

  const store = await readStore()
  const baseStore = storeHasUserContent(store) ? store : emptyStore()
  const browserStore: DiskStore = {
    version: 1,
    ideas: meaningfulIdeas,
    boards: Object.fromEntries(
      meaningfulIdeas.map((idea) => [idea.id, incomingBoards[idea.id] as SavedBoard]),
    ),
    activeIdeaId: activeIdeaId && meaningfulIdeas.some((idea) => idea.id === activeIdeaId) ? activeIdeaId : null,
  }

  const merged = mergeBrowserStore(baseStore, browserStore, { makeRecoveredId: () => newId('idea') })
  const backupFile = merged.summary.replaced > 0 ? await backupCurrentStore() : null
  const nextStore = merged.store
  await writeStore(nextStore)
  return {
    ...merged.summary,
    backupFile,
    ideas: sortIdeas(nextStore.ideas),
  }
}

async function backupCurrentStore(): Promise<string | null> {
  const file = dataFilePath()
  try {
    await fs.access(file)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }

  const backupDir = path.join(path.dirname(file), 'backups')
  await fs.mkdir(backupDir, { recursive: true })
  const backupFile = path.join(
    backupDir,
    `${path.basename(file)}.recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`,
  )
  await fs.copyFile(file, backupFile)
  await pruneRecoveryBackups(backupDir, path.basename(file))
  return backupFile
}

async function pruneRecoveryBackups(backupDir: string, dataFileName: string) {
  const entries = await fs.readdir(backupDir, { withFileTypes: true })
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${dataFileName}.recovery-`))
      .map(async (entry) => {
        const file = path.join(backupDir, entry.name)
        const stat = await fs.stat(file)
        return { file, mtimeMs: stat.mtimeMs }
      }),
  )
  const oldBackups = backups
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(RECOVERY_BACKUP_LIMIT)

  await Promise.all(oldBackups.map((backup) => fs.unlink(backup.file)))
}

async function readJsonBody(req: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonBody
}

function sendJson(res: ServerResponse, status: number, body: JsonBody) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function emptyBoard(): SavedBoard {
  return {
    version: 1,
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: new Date().toISOString(),
  }
}

function ideaNameFromBoard(board: SavedBoard): string {
  const firstNamedCard = board.cards.find((card) => card.title?.trim() || card.blocks.some((b) => b.text.trim()))
  const raw = firstNamedCard?.title?.trim() || firstNamedCard?.blocks.find((b) => b.text.trim())?.text.trim()
  return raw ? raw.slice(0, 48) : 'Untitled idea'
}

function sortIdeas(ideas: IdeaSummary[]): IdeaSummary[] {
  return [...ideas].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt) || b.updatedAt.localeCompare(a.updatedAt))
}

function newId(prefix: string) {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function isIdeaSummary(value: unknown): value is IdeaSummary {
  if (!value || typeof value !== 'object') return false
  const idea = value as Partial<IdeaSummary>
  return (
    typeof idea.id === 'string' &&
    typeof idea.name === 'string' &&
    typeof idea.createdAt === 'string' &&
    typeof idea.updatedAt === 'string' &&
    typeof idea.lastOpenedAt === 'string'
  )
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

function storeHasUserContent(store: DiskStore) {
  return store.ideas.some((idea) => isMeaningfulIdea(idea, store.boards[idea.id]))
}

function isMeaningfulIdea(idea: IdeaSummary, board: unknown) {
  if (!isSavedBoard(board)) return false
  if (idea.name.trim() && idea.name.trim() !== 'Untitled idea') return true
  return board.cards.length > 0 || board.connections.length > 0 || board.outputs.length > 0 || board.runs.length > 0
}
