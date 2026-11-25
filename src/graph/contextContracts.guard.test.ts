// Guard for the ADR 0017 seam: the consumers of connection behavior must read
// the context-contract registry, never compare card kinds directly. This test
// fails when someone reintroduces a `kind === 'note'`-style branch into a
// scoped file, pointing them at src/graph/contextContracts.ts instead.

import { describe, expect, it } from 'vitest'

// Comparisons against a card-kind literal ('askAi', 'title', …). Constructing
// a card (kind: 'result') and non-card kinds (asset.kind, step.kind 'ask')
// stay legal; only equality checks against card kinds are branching.
const CARD_KIND_COMPARISON = /kind\s*(===|!==)\s*'(note|askAi|result|mod|group|conversation|title)'/

// Raw sources, not executed — vite's ?raw import keeps this free of node APIs.
const WHOLE_FILES = import.meta.glob(
  [
    '../graph/contextQuery.ts',
    '../graph/resultRouting.ts',
    '../brain/compiler.ts',
    '../brain/conversationCompiler.ts',
    '../canvas/connections/ConnectionEdge.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const STORE = import.meta.glob('../graph/store.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('connection behavior branches only inside the contract registry', () => {
  it('covers every scoped consumer file', () => {
    expect(Object.keys(WHOLE_FILES)).toHaveLength(5)
    expect(Object.keys(STORE)).toHaveLength(1)
  })

  it.each(Object.entries(WHOLE_FILES))('%s has no direct card-kind comparison', (_file, text) => {
    expect(text).not.toMatch(CARD_KIND_COMPARISON)
  })

  it('the store connection actions have no direct card-kind comparison', () => {
    const text = Object.values(STORE)[0]!
    const start = text.indexOf('// ---- connections ----')
    const end = text.indexOf('// ---- undo/redo ----')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(text.slice(start, end)).not.toMatch(CARD_KIND_COMPARISON)
  })
})
