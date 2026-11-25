import type { IdeaSummary, SavedBoard } from './types'

export type IdeaWithBoard = {
  idea: IdeaSummary
  board: SavedBoard
}

export type BrowserStoreSnapshot = {
  version: 1
  ideas: IdeaSummary[]
  boards: Record<string, SavedBoard>
  activeIdeaId: string | null
}

export type DiskStorageStatus = {
  ok: true
  dataFile: string
  ideaCount: number
  hasUserContent: boolean
}

export type BrowserImportResult = {
  imported: number
  replaced: number
  skipped: number
  recoveredConflicts: number
  backupFile?: string | null
  ideas: IdeaSummary[]
}

const API_BASE = '/api/eido'

export async function diskStorageStatus(): Promise<DiskStorageStatus | null> {
  try {
    return await request<DiskStorageStatus>('/status')
  } catch {
    return null
  }
}

export async function diskListIdeas(): Promise<IdeaSummary[]> {
  const result = await request<{ ideas: IdeaSummary[] }>('/ideas')
  return result.ideas
}

export async function diskLoadIdea(id: string): Promise<IdeaWithBoard | null> {
  try {
    return await request<IdeaWithBoard>(`/ideas/${encodeURIComponent(id)}`)
  } catch {
    return null
  }
}

export async function diskLoadInitialIdea(): Promise<IdeaWithBoard & { ideas: IdeaSummary[] }> {
  return request<IdeaWithBoard & { ideas: IdeaSummary[] }>('/initial')
}

export async function diskCreateIdea(name: string, board: SavedBoard): Promise<IdeaWithBoard> {
  return request<IdeaWithBoard>('/ideas', jsonRequest('POST', { name, board }))
}

export async function diskSaveIdeaBoard(id: string, board: SavedBoard): Promise<IdeaSummary> {
  const result = await request<{ idea: IdeaSummary }>(
    `/ideas/${encodeURIComponent(id)}/board`,
    jsonRequest('PUT', { board }),
  )
  return result.idea
}

export async function diskRenameIdea(id: string, name: string): Promise<IdeaSummary | null> {
  try {
    const result = await request<{ idea: IdeaSummary }>(
      `/ideas/${encodeURIComponent(id)}`,
      jsonRequest('PATCH', { name }),
    )
    return result.idea
  } catch {
    return null
  }
}

export async function diskDeleteIdea(id: string): Promise<string | null> {
  const result = await request<{ nextId: string | null }>(
    `/ideas/${encodeURIComponent(id)}`,
    jsonRequest('DELETE', {}),
  )
  return result.nextId
}

export async function diskImportBrowserStore(snapshot: BrowserStoreSnapshot): Promise<BrowserImportResult> {
  return request<BrowserImportResult>(
    '/import-browser-store',
    jsonRequest('POST', snapshot),
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`Eido storage request failed: ${response.status}`)
  }
  return (await response.json()) as T
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
  }
}
