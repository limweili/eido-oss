// Whitespace-tolerant text matching. Highlights remember the exact text the user
// selected, but the same text can render with different whitespace (markdown joins
// lines, trims indents). Matching collapses whitespace on both sides and maps the
// match back to raw indices, so a highlight survives cosmetic re-rendering.

export type TextRange = {
  start: number
  end: number
}

type NormalizedText = {
  normalized: string
  // rawIndexAt[i] = index in the raw string of the character behind normalized[i]
  rawIndexAt: number[]
}

function normalizeWithMap(raw: string): NormalizedText {
  let normalized = ''
  const rawIndexAt: number[] = []
  let pendingSpace = false

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]
    if (/\s/.test(char)) {
      if (normalized.length > 0) pendingSpace = true
      continue
    }
    if (pendingSpace) {
      normalized += ' '
      rawIndexAt.push(i)
      pendingSpace = false
    }
    normalized += char
    rawIndexAt.push(i)
  }

  return { normalized, rawIndexAt }
}

export function normalizeMatchText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

// Finds the nth (0-based) whitespace-tolerant match of `needle` in `raw` and
// returns raw-string indices, or null when there aren't that many matches.
export function findNthMatch(raw: string, needle: string, occurrence: number): TextRange | null {
  const target = normalizeMatchText(needle)
  if (!target || occurrence < 0) return null

  const { normalized, rawIndexAt } = normalizeWithMap(raw)
  let from = 0
  for (let found = 0; ; found += 1) {
    const at = normalized.indexOf(target, from)
    if (at === -1) return null
    if (found === occurrence) {
      return { start: rawIndexAt[at], end: rawIndexAt[at + target.length - 1] + 1 }
    }
    from = at + 1
  }
}

// How many whitespace-tolerant matches of `needle` start before `rawIndex`.
// Used when creating a highlight: it pins the selection to the right repeat.
export function countMatchesBefore(raw: string, needle: string, rawIndex: number): number {
  const target = normalizeMatchText(needle)
  if (!target) return 0

  const { normalized, rawIndexAt } = normalizeWithMap(raw)
  let count = 0
  let from = 0
  for (;;) {
    const at = normalized.indexOf(target, from)
    if (at === -1 || rawIndexAt[at] >= rawIndex) return count
    count += 1
    from = at + 1
  }
}
