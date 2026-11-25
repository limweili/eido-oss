# 02 — Data Model

The one property graph (Concept 1), shaped to carry meaning (Concept 2), Mods (Concept 4), and versioned outputs (Concept 5) — while staying small enough to throw away. Plain-language names everywhere a plain word exists; the user never sees any of these words ([06 rule in 04](04-canvas-language-and-feel.md)).

> These are intent sketches to guide implementation, not final code. Generous where it costs nothing to leave room; we are not building everything below in the first slices.

## The whole saved board

```ts
type SavedBoard = {
  version: 1
  cards: Card[]
  connections: Connection[]
  outputs: Output[]          // versioned artifacts (Concept 5)
  runs: RunRecord[]          // what happened when AI ran (authored graph vs run state)
  updatedAt: string
}
```

The split between `connections` (what you authored) and `runs` (what happened) is research 2's clearest borrow from n8n: *the board is what you made; a run is what happened when you pressed Run.*

## Card — the thing on the board

```ts
type CardKind = 'note' | 'askAi' | 'result' | 'mod'   // mod = the wireframe's MOD

type Card = {
  id: string
  kind: CardKind
  title?: string
  blocks: Block[]            // note/ask/result text; line identity is best-effort until rich text
  mod?: ModSpec              // mod cards use structured controls, not just prose
  position: { x: number; y: number }
  size?: { width: number; height: number }
  groupId?: string          // a Thought container, when we add them (left as room)
  meta?: Record<string, unknown>   // escape hatch; unused at first
}
```

- **note** — a card the user writes in (the raw thought).
- **askAi** — holds an instruction; when run, it's combined with compiled context and sent to AI.
- **result** — shows what AI wrote; backed by an `Output` with versions.
- **mod** — a crystallised modifier: sliders/ranges/toggles and JSON-shaped prompt rules that change how context is used (Concept 4).

### Block — why content is a list, not a string

```ts
type Block = {
  id: string                // target for future line-level connections
  text: string
  kind?: 'line' | 'heading' | 'bullet' | 'generated'
}
```

A note's content is an **ordered list of blocks**, even though v3's first editor may still feel like a plain text area. This leaves room for line-level connections (the wireframe shows arrows leaving individual lines), but v3 should treat line identity as **best-effort** until the editor preserves blocks across split/merge/reorder operations. Do not promise precise line anchors until the editor earns it.

## Mod — structured prompt modifiers (Concept 4)

```ts
type ModSpec = {
  id: string
  label: string
  description?: string
  controls: ModControl[]
  rules: ModRule[]
}

type ModControl =
  | {
      id: string
      label: string
      kind: 'slider'
      min: number
      max: number
      step: number
      value: number
    }
  | {
      id: string
      label: string
      kind: 'range'
      min: number
      max: number
      step: number
      value: { min: number; max: number }
    }
  | {
      id: string
      label: string
      kind: 'toggle'
      value: boolean
    }
  | {
      id: string
      label: string
      kind: 'choice'
      options: string[]
      value: string
    }

type ModRule = {
  when?: Record<string, unknown>      // simple JSON predicate over control values
  target: 'context' | 'constraints' | 'approach' | 'output'
  instruction: string                 // template may reference control ids
}
```

A Mod is JSON prompt engineering with a UI. The user moves controls; the compiler turns those control values into extra instructions or changes to the context sections. Example: a "Novelty" Mod might expose `safe ↔ wild` and write: *"Prefer uncommon variations; tolerate unresolved ideas"* only when the slider is high. Text may explain the Mod, but text is not the Mod.

## Connection — where the meaning lives (Concept 2)

```ts
type Connection = {
  id: string
  from: Anchor              // directed: from feeds/modifies to
  to: Anchor
  strength: 'strong' | 'weak'          // magnitude (refinement)
  polarity: 'helps' | 'pushesAgainst'  // tension (the non-negotiable one)
  role: 'feeds' | 'modifies'           // plain arrow vs the wireframe's coil/MOD edge
  meta?: Record<string, unknown>
}

type Anchor = {
  cardId: string
  blockId?: string         // absent = whole card (v3 default); present = a specific line (later)
}
```

- **strength** drives connection thickness and ordering in the compiler. Strong leads.
- **polarity** is the differentiator: `helps` → context; `pushesAgainst` → a constraint the output must respect. Ships with the first AI run.
- **role** separates two relationships the wireframe draws differently: a note *feeds* an Ask-AI card (plain arrow); a Mod *modifies* a run (the coil). Keeping them distinct is what stops Eido becoming "every card is a workflow node."
- **direction** (`from → to`) is used by the run engine for flow and by the compiler to find "what feeds this."

> Deferred edge ideas (true signed/numeric weight, more polarities, per-line endpoints) are additive `strength`/`polarity`/`role`/`blockId` values — the record already holds them.

## Output & versions — the idea is never final (Concept 5)

```ts
type Output = {
  id: string
  resultCardId: string      // the result card that shows this output
  versions: OutputVersion[] // the wireframe's v1/v2/v3 stack
  chosenVersionId?: string  // the top of the stack; what the user accepted
}

type OutputVersion = {
  id: string
  number: number            // v1, v2, v3…
  text: string
  createdAt: string
  fromRunId: string         // which run made it
  accepted?: boolean
}
```

A result card never just holds a string — it holds an `Output` with a stack of versions you pick between. Choosing is lighter than auditing; this is the anti-slop mechanism.

## Run record — what happened, and from what (Concept 5)

```ts
type RunRecord = {
  id: string
  startedAt: string
  finishedAt?: string
  askAiCardId: string
  usedCardIds: string[]        // exactly what the compiler included
  usedConnectionIds: string[]
  modIds: string[]             // which Mods shaped it
  appliedMods: AppliedMod[]    // exact Mod control values used for this run
  compiledInstruction: string  // the EXACT text sent — powers "show me what AI used" (Concept 3)
  producedVersionId?: string
  status: 'running' | 'done' | 'failed'
  errorMessage?: string
}

type AppliedMod = {
  modCardId: string
  controlValues: Record<string, unknown>
  appliedInstructions: string[]
}
```

Storing `compiledInstruction` and `usedCardIds` is what makes provenance real: every version can explain its sources, and "show me what AI used" reads straight off the last run. It also captures the **timeline of transformation** you asked for — the run history *is* the evolution of the idea.

## What we deliberately do NOT model yet

Designed-for but not built (no reshape required when they arrive): Thought containers as full objects (`groupId` is the only hook now), live line-level editing (blocks are ready but not yet stable enough for precise anchors), Mod libraries across boards, semantic/embedding ranking, collaboration/sync records, native packaging. Each is a new field or kind, not a redesign — see [05](05-build-path-and-open-questions.md).

## Why this shape

It's a genuine property graph, so the compiler and run engine traverse it the way a graph database would — in memory, deterministically. The connection carries strength + polarity + role, which *is* Eido's differentiator even at prototype crudeness. And every concept we're strict about has a home here, while every concept we're relaxed about has a seam, not a wall.
