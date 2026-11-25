// Read-only walks over the one graph. No canvas library here.

import type { Card, Connection, Output, OutputVersion, SavedBoard } from './types'

export function cardById(board: Pick<SavedBoard, 'cards'>, id: string): Card | undefined {
  return board.cards.find((c) => c.id === id)
}

// Connections pointing INTO a card (someone feeds/modifies this card).
export function incomingConnections(board: Pick<SavedBoard, 'connections'>, cardId: string): Connection[] {
  return board.connections.filter((c) => c.to.cardId === cardId)
}

// Connections leaving a card.
export function outgoingConnections(board: Pick<SavedBoard, 'connections'>, cardId: string): Connection[] {
  return board.connections.filter((c) => c.from.cardId === cardId)
}

// Cards that belong to a group, in saved-board order. Groups do not nest.
export function membersOf(board: SavedBoard, groupId: string): Card[] {
  return board.cards.filter((c) => c.groupId === groupId && c.kind !== 'group' && c.kind !== 'title')
}

// The result card a given Ask AI card feeds (if any).
export function resultCardFor(
  board: Pick<SavedBoard, 'cards' | 'connections'>,
  askAiCardId: string,
): Card | undefined {
  const out = outgoingConnections(board, askAiCardId)
  for (const conn of out) {
    const target = cardById(board, conn.to.cardId)
    if (target?.kind === 'result') return target
  }
  return undefined
}

// The Ask AI card that produces a given result card (the reverse walk).
export function producingAskFor(board: SavedBoard, resultCardId: string): Card | undefined {
  for (const conn of incomingConnections(board, resultCardId)) {
    const source = cardById(board, conn.from.cardId)
    if (source?.kind === 'askAi') return source
  }
  return undefined
}

// The version currently visible on an output. Outputs without an explicit
// choice show their latest version; a stale explicit choice resolves to none.
export function chosenVersion(output: Output | undefined): OutputVersion | undefined {
  if (!output) return undefined
  const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
  return output.versions.find((version) => version.id === chosenId)
}

// All text of a card, joined as the user wrote it.
export function cardText(card: Card): string {
  return cardTextFromBlocks(card.blocks).trim()
}

let cardTextProjectionBuildCount = 0
const cardTextProjectionCache = new WeakMap<Card['blocks'], string>()
let textHasContentScanCount = 0

// Callers keep this predicate behind immutable semantic identity (a blocks
// array, OutputVersion, transcript projection, or memoized text). The counter
// proves shell/selection renders do not rescan a complete string.
export function textHasContent(text: string): boolean {
  textHasContentScanCount += 1
  return Boolean(text.trim())
}

export function textHasContentScanCountForTests(): number {
  return textHasContentScanCount
}

export function resetTextHasContentScanCountForTests(): void {
  textHasContentScanCount = 0
}

/**
 * The untrimmed text projection used by native Card readers and editors.
 * The counter is content-free test evidence for whether a semantic projection
 * was rebuilt; production callers observe only the text.
 */
export function cardTextFromBlocks(blocks: Card['blocks']): string {
  const cached = cardTextProjectionCache.get(blocks)
  if (cached !== undefined) return cached
  cardTextProjectionBuildCount += 1
  const text = blocks.map((block) => block.text).join('\n')
  cardTextProjectionCache.set(blocks, text)
  return text
}

export function cardTextProjectionBuildCountForTests(): number {
  return cardTextProjectionBuildCount
}

export function resetCardTextProjectionBuildCountForTests(): void {
  cardTextProjectionBuildCount = 0
}

type CardLabelCacheEntry = {
  modTitle: string | undefined
  cardTitle: string | undefined
  label: string
}
type CardLabelCacheByKind = Map<Card['kind'], CardLabelCacheEntry>

// Geometry commits replace the Card record but preserve its immutable semantic
// fields (especially `blocks`). Keep the derived label behind that semantic
// identity so a million-character body is not joined and split once per move.
// The WeakMap key means this cache cannot retain a deleted Card's content after
// the corresponding blocks array is no longer reachable by the graph.
const cardLabelCache = new WeakMap<Card['blocks'], CardLabelCacheByKind>()

let cardLabelBodyScanCount = 0

export function cardLabelBodyScanCountForTests(): number {
  return cardLabelBodyScanCount
}

export function resetCardLabelBodyScanCountForTests(): void {
  cardLabelBodyScanCount = 0
}

function firstBodyLineLabel(blocks: Card['blocks']): string | null {
  cardLabelBodyScanCount += 1
  let started = false
  let line = ''
  let lineLength = 0

  const hasNonWhitespace = (text: string, start = 0): boolean => {
    for (let offset = start; offset < text.length;) {
      const codePoint = text.codePointAt(offset)
      if (codePoint === undefined) break
      const character = String.fromCodePoint(codePoint)
      if (!/\s/u.test(character)) return true
      offset += character.length
    }
    return false
  }

  const hasLaterContent = (blockIndex: number, offset: number): boolean =>
    hasNonWhitespace(blocks[blockIndex]?.text ?? '', offset) ||
    blocks.slice(blockIndex + 1).some((later) => hasNonWhitespace(later.text))

  // The label itself is bounded to the first line and 61 UTF-16 units. A
  // terminal-whitespace parity check may inspect the cold tail to distinguish
  // internal spaces from globally trimmed spaces; the result is cached by the
  // immutable blocks array, so geometry records never revisit that tail.
  for (const [blockIndex, block] of blocks.entries()) {
    for (let offset = 0; offset < block.text.length;) {
      const codePoint = block.text.codePointAt(offset)
      if (codePoint === undefined) break
      const character = String.fromCodePoint(codePoint)
      if (!started) {
        if (/\s/u.test(character)) {
          offset += character.length
          continue
        }
        started = true
      } else if (character === '\n') {
        // `cardText(...).trim().split('\n')[0]` trims terminal whitespace
        // after the newline, but preserves spaces when later content makes
        // them internal to the body. This scan is cold and cached by blocks;
        // geometry records never revisit it.
        return hasLaterContent(blockIndex, offset + character.length)
          ? line
          : line.trimEnd()
      }

      if (lineLength < 61) line += character
      lineLength += character.length
      offset += character.length
      if (lineLength >= 61) return `${line.slice(0, 57)}…`
    }
    if (started) {
      // `cardText` joins blocks with a newline. The next block therefore
      // starts a new line once the current block has produced content. Global
      // trim removes trailing spaces only when every later block is blank.
      return hasLaterContent(blockIndex, block.text.length + 1) ? line : line.trimEnd()
    }
  }

  return started ? line.trimEnd() : null
}

// A short label for a card, for provenance lists.
export function cardLabel(card: Card): string {
  const byKind = cardLabelCache.get(card.blocks) ?? new Map<Card['kind'], CardLabelCacheEntry>()
  cardLabelCache.set(card.blocks, byKind)

  // Compare the immutable title strings by identity/value without trimming on
  // the hot path. A Mod's title has always taken precedence when non-blank,
  // otherwise its Card title remains the fallback.
  const modTitle = card.kind === 'mod' ? card.modV2?.title : undefined
  const cardTitle = card.title
  const cached = byKind.get(card.kind)
  if (cached && cached.modTitle === modTitle && cached.cardTitle === cardTitle) return cached.label

  const explicitLabel = modTitle?.trim() || cardTitle?.trim()
  const label = explicitLabel || firstBodyLineLabel(card.blocks) || (() => {
    switch (card.kind) {
      case 'note':
        return 'Untitled note'
      case 'askAi':
        return 'Ask AI'
      case 'result':
        return 'Result'
      case 'mod':
        return 'Mod'
      case 'group':
        return 'Group'
      case 'conversation':
        return 'Conversation'
      case 'title':
        return 'Title'
    }
  })()
  byKind.set(card.kind, { modTitle, cardTitle, label })
  return label
}
