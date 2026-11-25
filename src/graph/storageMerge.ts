import type { IdeaSummary, SavedBoard } from './types'

export type IdeaStore = {
  version: 1
  ideas: IdeaSummary[]
  boards: Record<string, SavedBoard>
  activeIdeaId: string | null
}

export type BrowserImportSummary = {
  imported: number
  replaced: number
  skipped: number
  recoveredConflicts: number
}

export type BrowserImportMergeResult = {
  store: IdeaStore
  summary: BrowserImportSummary
  replacedIds: string[]
}

export function preserveAssetDataUrls(nextBoard: SavedBoard, previousBoard?: SavedBoard): SavedBoard {
  if (!previousBoard) return nextBoard

  const previousDataUrls = new Map<string, string>()
  for (const card of previousBoard.cards) {
    for (const asset of card.assets ?? []) {
      if (asset.dataUrl) previousDataUrls.set(asset.id, asset.dataUrl)
    }
  }
  if (!previousDataUrls.size) return nextBoard

  let changed = false
  const cards = nextBoard.cards.map((card) => {
    if (!card.assets?.length) return card
    let cardChanged = false
    const assets = card.assets.map((asset) => {
      if (asset.dataUrl) return asset
      const previousDataUrl = previousDataUrls.get(asset.id)
      if (!previousDataUrl) return asset
      cardChanged = true
      changed = true
      return { ...asset, dataUrl: previousDataUrl }
    })
    return cardChanged ? { ...card, assets } : card
  })

  return changed ? { ...nextBoard, cards } : nextBoard
}

export function mergeBrowserStore(
  baseStore: IdeaStore,
  browserStore: IdeaStore,
  opts: { makeRecoveredId?: () => string } = {},
): BrowserImportMergeResult {
  const makeRecoveredId = opts.makeRecoveredId ?? (() => `idea-recovered-${Date.now()}`)
  const ideas = [...baseStore.ideas]
  const boards = { ...baseStore.boards }
  const replacedIds: string[] = []
  const summary: BrowserImportSummary = {
    imported: 0,
    replaced: 0,
    skipped: 0,
    recoveredConflicts: 0,
  }
  let activeIdeaId = baseStore.activeIdeaId

  for (const browserIdea of browserStore.ideas) {
    const browserBoard = browserStore.boards[browserIdea.id]
    if (!browserBoard) {
      summary.skipped += 1
      continue
    }

    const existingIndex = ideas.findIndex((idea) => idea.id === browserIdea.id)
    if (existingIndex === -1) {
      ideas.push(browserIdea)
      boards[browserIdea.id] = browserBoard
      summary.imported += 1
      if (browserStore.activeIdeaId === browserIdea.id) activeIdeaId = browserIdea.id
      continue
    }

    const diskIdea = ideas[existingIndex]
    const diskBoard = boards[diskIdea.id]
    if (!diskBoard) {
      ideas[existingIndex] = browserIdea
      boards[browserIdea.id] = browserBoard
      summary.replaced += 1
      replacedIds.push(browserIdea.id)
      if (browserStore.activeIdeaId === browserIdea.id) activeIdeaId = browserIdea.id
      continue
    }

    const browserTime = contentTime(browserIdea, browserBoard)
    const diskTime = contentTime(diskIdea, diskBoard)
    if (browserTime > diskTime) {
      ideas[existingIndex] = browserIdea
      boards[browserIdea.id] = preserveAssetDataUrls(browserBoard, diskBoard)
      summary.replaced += 1
      replacedIds.push(browserIdea.id)
      if (browserStore.activeIdeaId === browserIdea.id) activeIdeaId = browserIdea.id
      continue
    }

    if (browserTime < diskTime) {
      summary.skipped += 1
      if (browserStore.activeIdeaId === browserIdea.id) activeIdeaId = browserIdea.id
      continue
    }

    if (contentSignature(diskIdea, diskBoard) === contentSignature(browserIdea, browserBoard)) {
      summary.skipped += 1
      if (browserStore.activeIdeaId === browserIdea.id) activeIdeaId = browserIdea.id
      continue
    }

    const recoveredId = makeRecoveredId()
    const recoveredIdea: IdeaSummary = {
      ...browserIdea,
      id: recoveredId,
      name: recoveredName(browserIdea.name),
    }
    ideas.push(recoveredIdea)
    boards[recoveredId] = browserBoard
    summary.recoveredConflicts += 1
    if (browserStore.activeIdeaId === browserIdea.id) activeIdeaId = recoveredId
  }

  return {
    store: {
      version: 1,
      ideas,
      boards,
      activeIdeaId: activeIdeaId && ideas.some((idea) => idea.id === activeIdeaId) ? activeIdeaId : ideas[0]?.id ?? null,
    },
    summary,
    replacedIds,
  }
}

function contentTime(idea: IdeaSummary, board: SavedBoard): number {
  return Math.max(dateTime(idea.updatedAt), dateTime(board.updatedAt))
}

function dateTime(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function contentSignature(idea: IdeaSummary, board: SavedBoard): string {
  const { lastOpenedAt: _lastOpenedAt, ...contentIdea } = idea
  return stableStringify({ idea: contentIdea, board })
}

function recoveredName(name: string): string {
  const trimmed = name.trim() || 'Untitled idea'
  return trimmed.startsWith('Recovered - ') ? trimmed : `Recovered - ${trimmed}`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}
