import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentStorageStatus, listIdeas, loadInitialIdea, resetStorageBackendForTests, saveIdeaBoard } from './save'
import type { IdeaSummary, SavedBoard } from './types'

const board: SavedBoard = {
  version: 1,
  cards: [
    {
      id: 'note-1',
      kind: 'note',
      title: 'Eido Main Idea',
      blocks: [{ id: 'block-1', text: 'The saved board lives on disk.' }],
      position: { x: 0, y: 0 },
    },
  ],
  connections: [],
  outputs: [],
  runs: [],
  updatedAt: '2026-06-16T00:00:00.000Z',
}

const idea: IdeaSummary = {
  id: 'idea-main',
  name: 'Eido Main Idea',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
  lastOpenedAt: '2026-06-16T00:00:00.000Z',
}

describe('saved Ideas storage', () => {
  beforeEach(() => {
    resetStorageBackendForTests()
    const indexedOpen = vi.fn(() => {
      throw new Error('IndexedDB should not be needed when disk storage is available')
    })
    vi.stubGlobal('indexedDB', { open: indexedOpen })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetStorageBackendForTests()
  })

  it('lists and saves through the local disk API instead of origin-scoped IndexedDB', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === '/api/eido/status') {
        return json({ ok: true, dataFile: '/tmp/eido-v3-ideas.json', ideaCount: 1, hasUserContent: true })
      }
      if (url === '/api/eido/ideas' && method === 'GET') {
        return json({ ideas: [idea] })
      }
      if (url === '/api/eido/ideas/idea-main/board' && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { board: SavedBoard }
        return json({
          idea: {
            ...idea,
            updatedAt: body.board.updatedAt,
          },
        })
      }

      throw new Error(`Unhandled request: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(listIdeas()).resolves.toEqual([idea])
    await expect(saveIdeaBoard('idea-main', board)).resolves.toMatchObject({ id: 'idea-main' })
    expect(indexedDB.open).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/eido/ideas/idea-main/board', expect.objectContaining({ method: 'PUT' }))
  })

  it('does not fall back to IndexedDB after disk storage has been selected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === '/api/eido/status') {
        return json({ ok: true, dataFile: '/tmp/eido-v3-ideas.json', ideaCount: 1, hasUserContent: true })
      }
      if (url === '/api/eido/initial') {
        return json({ idea, board, ideas: [idea] })
      }
      if (url === '/api/eido/ideas/idea-main/board' && method === 'PUT') {
        return json({ error: 'disk unavailable' }, 500)
      }

      throw new Error(`Unhandled request: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadInitialIdea()).resolves.toEqual({ idea, board, ideas: [idea] })
    const indexedOpenMock = indexedDB.open as unknown as { mock: { calls: unknown[] } }
    const indexedOpenCallsAfterHydrate = indexedOpenMock.mock.calls.length
    await expect(saveIdeaBoard('idea-main', board)).rejects.toThrow('Eido storage request failed: 500')

    expect(currentStorageStatus()?.backend).toBe('disk')
    expect(indexedDB.open).toHaveBeenCalledTimes(indexedOpenCallsAfterHydrate)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('still loads the disk file if browser migration is unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/eido/status') {
        return json({ ok: true, dataFile: '/tmp/eido-v3-ideas.json', ideaCount: 1, hasUserContent: true })
      }
      if (url === '/api/eido/initial') {
        return json({ idea, board, ideas: [idea] })
      }
      throw new Error(`Unhandled request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadInitialIdea()).resolves.toEqual({ idea, board, ideas: [idea] })
  })

  it('uses browser storage when disk storage is unavailable at startup', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/eido/status') return json({ error: 'missing disk api' }, 404)
      throw new Error(`Unhandled request: ${url}`)
    })
    const indexedOpen = installFakeIndexedDb()
    vi.stubGlobal('fetch', fetchMock)

    const loaded = await loadInitialIdea()

    expect(currentStorageStatus()).toMatchObject({ backend: 'browser' })
    expect(loaded.idea.name).toBe('Untitled idea')
    expect(loaded.ideas).toHaveLength(1)
    expect(loaded.board.cards).toEqual([])
    expect(indexedOpen).toHaveBeenCalled()
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type FakeStore = {
  keyPath?: string
  values: Map<IDBValidKey, unknown>
}

function installFakeIndexedDb() {
  const stores = new Map<string, FakeStore>()
  const open = vi.fn(() => {
    const db = makeDb(stores)
    const req = { result: db } as IDBOpenDBRequest
    queueMicrotask(() => {
      req.onupgradeneeded?.({ target: req } as unknown as IDBVersionChangeEvent)
      queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event))
    })
    return req
  })
  vi.stubGlobal('indexedDB', { open })
  return open
}

function makeDb(stores: Map<string, FakeStore>): IDBDatabase {
  return {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string, options?: IDBObjectStoreParameters) => {
      const store = { keyPath: typeof options?.keyPath === 'string' ? options.keyPath : undefined, values: new Map() }
      stores.set(name, store)
      return makeObjectStore(store)
    },
    transaction: (names: string | string[]) => makeTransaction(stores, Array.isArray(names) ? names : [names]),
    close: () => {},
  } as IDBDatabase
}

function makeTransaction(stores: Map<string, FakeStore>, names: string[]): IDBTransaction {
  const tx = {
    error: null,
    objectStore: (name: string) => {
      if (!names.includes(name)) throw new Error(`Store ${name} is not in this transaction`)
      const store = stores.get(name)
      if (!store) throw new Error(`Missing store ${name}`)
      return makeObjectStore(store)
    },
  } as IDBTransaction
  Object.defineProperty(tx, 'oncomplete', {
    set(handler: ((this: IDBTransaction, ev: Event) => unknown) | null) {
      if (handler) queueMicrotask(() => handler.call(tx, new Event('complete')))
    },
  })
  return tx
}

function makeObjectStore(store: FakeStore): IDBObjectStore {
  return {
    get: (key: IDBValidKey) => request(store.values.get(key)),
    getAll: () => request([...store.values.values()]),
    put: (value: Record<string, unknown>, key?: IDBValidKey) => {
      const resolvedKey = key ?? (store.keyPath ? (value[store.keyPath] as IDBValidKey) : undefined)
      if (resolvedKey === undefined) throw new Error('Missing key')
      store.values.set(resolvedKey, value)
      return request(resolvedKey)
    },
    delete: (key: IDBValidKey) => {
      store.values.delete(key)
      return request(undefined)
    },
  } as IDBObjectStore
}

function request<T>(result: T): IDBRequest<T> {
  const req = { result } as IDBRequest<T>
  queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event))
  return req
}
