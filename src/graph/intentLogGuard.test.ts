// Bypass guard for the commit funnel (ADR 0016, issue #188).
//
// The funnel in store.ts is the ONLY writer to the live GraphState Intent Log.
// Persistence hydrators may reconstruct read-only SavedBoard snapshots; this
// guard makes bypassing the live funnel trip a test, in four layers:
//
//   1. Mutator calls on any `intentLog` (.push/.splice/.concat/…) are banned
//      outright, everywhere.
//   2. Assignments to an `intentLog` property (s.intentLog = …, draft
//      mutation) are banned outright, everywhere. Local reads like
//      `const intentLog = useGraph(…)` are fine.
//   3. Spread-appends (`[...s.intentLog, …]`) may exist only in store.ts, and
//      their count is pinned to the single funnel append (appendStampedEvents).
//   4. Every `intentLog:`/`intentLog?:` property occurrence in non-test
//      source is pinned per file — covering `intentLog: events`-style
//      replacement writes inside set()/produce object literals. The allowed
//      occurrences are type declarations, board load/normalize/fixtures, and
//      store.ts's pinned appends; anything new trips the exact-match pin.
//
// If this test fails because you added a write: don't update the pins —
// route your events through commit(label, updater, events) instead.

import { describe, expect, it } from 'vitest'

// Layer 1: array mutators on an intentLog value.
const MUTATOR_PATTERN =
  /\bintentLog\s*\.\s*(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|concat)\s*\(/

// Layer 2: assignment to an intentLog property. Declarations (const/let/var
// intentLog = …) are reads of the store, not writes to it.
const ASSIGN_PATTERN = /(?<!\b(?:const|let|var)\s{1,4})\bintentLog\s*=(?![=>])/

// Layer 3: spread-append onto the log (`[...s.intentLog, …]` in any variant).
const APPEND_PATTERN = /\.\.\.[A-Za-z_$][\w$]*\.intentLog/

const STORE_APPEND_COUNT = 1

// Layer 4: every `intentLog:` / `intentLog?:` property in non-test source,
// pinned per file (glob keys are relative to this file's directory):
//   store.ts   = GraphState field type + initial state + SavedBoard load
//                normalization + replaceBoard hydration + authoritative
//                Profile apply + the funnel append (6 total)
//   types.ts   = the SavedBoard schema field
//   save.ts    = makeSavedBoard constructor default + perf fixtures
// No whitespace before the colon: that is how a property key is written in
// this codebase, while a ternary's colon (`x.intentLog : []`) has a space —
// which is a read, not a write.
const PROPERTY_PATTERN = /\bintentLog\??:/
const PROPERTY_PINS: Record<string, number> = {
  './store.ts': 6,
  './save.ts': 1,
  './types.ts': 1,
  '../performance/browserInteraction.perf.ts': 2,
  '../performance/browserPerformanceRuntime.ts': 1,
  // dragEventStorm seeds its storm board with an empty intentLog via the dev
  // store setState — a fixture reset, not a funnel bypass.
  '../performance/dragEventStorm.perf.ts': 1,
  // Resize replay copies the log into an identity/counting probe; it never
  // writes graph state or appends an event.
  '../performance/resizePainterReplay.perf.ts': 3,
  '../performance/storePerformance.ts': 1,
  // The synthetic Profile corpus exercises populated and empty durable Board
  // logs plus its read-only structural validator; it never mutates a log.
  '../persistence/fixtures/profileFixtureCorpus.ts': 3,
  // #594's complete read-only projection fixture carries current and historical
  // Intent state into persistence tests; it never writes live GraphState.
  '../persistence/fixtures/profileLogicalProjectionFixture.ts': 2,
  // #459 reconstructs a read-only SavedBoard from independently persisted
  // Intent-event records; it does not append to the live GraphState log.
  '../persistence/profileRevisionKernel.ts': 1,
  // #463 immutably remaps a detached SavedBoard's historical Intent records;
  // it never writes live GraphState or appends a new semantic event.
  '../persistence/profileIdeaIdentityRemap.ts': 1,
  // Agent Idea creation plans a canonical, detached empty Board before the
  // revision store commits it. It does not write live GraphState or append an
  // event; later hydration still enters through the authoritative funnel.
  '../persistence/profileAgentCommandPlan.ts': 1,
}

const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const nonTestSources = Object.entries(sources).filter(
  ([path]) => !/\.test\.(ts|tsx)$/.test(path),
)

// This test lives in src/graph, so the store resolves as './store.ts'.
const STORE_PATH = './store.ts'

function countMatches(source: string, pattern: RegExp): number {
  return source.match(new RegExp(pattern.source, 'g'))?.length ?? 0
}

describe('commit funnel bypass guard', () => {
  it('no source file mutates an intentLog array in place', () => {
    const offenders = nonTestSources
      .filter(([, source]) => MUTATOR_PATTERN.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('no source file assigns to an intentLog property', () => {
    const offenders = nonTestSources
      .filter(([, source]) => ASSIGN_PATTERN.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('no file outside store.ts appends to the Intent Log', () => {
    const offenders = nonTestSources
      .filter(([path]) => path !== STORE_PATH)
      .filter(([, source]) => APPEND_PATTERN.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('store.ts direct appends only ever decrease (migrate through commit(), then lower the pin)', () => {
    const [, store] = nonTestSources.find(([path]) => path === STORE_PATH) ?? []
    expect(store).toBeTruthy()
    expect(countMatches(store ?? '', APPEND_PATTERN)).toBe(STORE_APPEND_COUNT)
  })

  it('every intentLog property occurrence is accounted for, per file', () => {
    const actual: Record<string, number> = {}
    for (const [path, source] of nonTestSources) {
      const count = countMatches(source, PROPERTY_PATTERN)
      if (count > 0) actual[path] = count
    }
    expect(actual).toEqual(PROPERTY_PINS)
  })
})
