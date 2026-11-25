# 04 — Canvas, Language & Feel

How the wireframe becomes a screen (Concept 1, 2), and the binding rule that it must **feel like thinking, not operating a graph** (Concept 6). Aggressive simplicity outranks everything in this doc.

---

## The wireframe, mapped element by element

Your sketch is the source of truth for *feel*. Every element has a home — some built now, some left as room.

| Wireframe element | What it is | v3 treatment |
|---|---|---|
| **THOUGHT** (big outer frame) | A bounded working context | *Room.* `groupId` exists in the model; the frame UI comes when boards get busy. Not built first. |
| **NOTE** card with lines | A card you write in; lines matter | Built. Card with text; content stored as block records with best-effort line identity (precise line connecting comes later). |
| **"strong"** thick arrow | An important, directed connection | Built. Thick line = strong. |
| **"weak"** dashed arrow | A lighter, directed connection | Built. Thin/dashed line = weak. |
| Arrows leaving **specific lines** | Line-level connection | *Room.* Model ready (`blockId` anchor); v3 connects whole cards first. |
| **✕ / "negative"** mark | A connection that pushes against | Built as **"pushes against"** — the constraint. Ships with the first AI run. |
| **MOD** circle on a **coil** | A structured thought-operator, attached differently | Built crude. A **Mod card** with sliders/ranges/toggles connected with `role: 'modifies'` (drawn distinct from plain arrows). |
| **OUTPUT** card with **v3** stack | A versioned result | Built. Result card backed by a version stack you pick from. |
| **□ → ○ =** (top of sketch) | Thought transforms into output | The whole loop: connected thought compiles into an instruction that produces a chosen output. |

---

## The screen

One board. No landing page, no onboarding tour.

```
┌──────────────────────────────────────────────────────────────┐
│  Add note   Ask AI   Run        thinking: quick·balanced·thorough   Saved │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                      THE BOARD (infinite)                    │
│            pan · zoom · drag cards · draw connections         │
│                                                              │
│                                        ┌───────────────────┐ │
│                                        │ side panel (right) │ │
│                                        │ shows only when a  │ │
│                                        │ card/connection is │ │
│                                        │ selected           │ │
│                                        └───────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

Empty state: **"Start with a note."** One primary action: **Add note.**

## The cards (what the user sees)

- **Note** — a title-optional card with a text area. Controls: delete, duplicate, connect handle.
- **Ask AI** — *"What should AI do?"* + a text area + **Run**. Placeholder: *"Summarise the connected notes."* Shows a small state: *Ready / Running… / Done / Couldn't run*. Has a **"Show what AI used"** affordance (see below).
- **Result** — shows the chosen version of what AI wrote. Controls: copy, **turn into a note**, **make variations**, and a small **version switcher** (v1 · v2 · v3 …) to flip between and **keep** one.
- **Mod** — a small control card with sliders, ranges, toggles, or choices. Visually distinct (the wireframe's circle/coil feel). Connect it to an Ask-AI card to tune how the run uses context.

## The connections

- Drag from one card to another to connect. Default: **strong · helps**.
- A selected connection shows in the side panel:
  - **Strength:** Strong / Weak
  - **Use as:** Helps / Pushes against
- Drawn so meaning is visible without reading: **thick = strong, thin/dashed = weak; "pushes against" is clearly marked** (e.g. a distinct colour/symbol). The Mod connection (coil) looks different from a plain arrow.

> If two controls feel like too much at first, **strength can hide and "Use as" stays** — because tension is the differentiator (Concept 2). This is the opposite of v2's instinct, and it's deliberate.

## "Show what AI used" — the trust surface (Concept 3)

On an Ask-AI or Result card: a quiet **"Show what AI used."** Opening it shows the **real compiled instruction** — your connected notes sorted into *Important / Also consider / Constraints*, plus the task. Not a count. This is the single most important non-obvious feature in v3: it's what turns the output from a black box into *visibly your own thinking*.

## Versions you pick, not slop you weed (Concept 5)

**Make variations** produces a small stack on the result card. The user flips through and **keeps one** (or rejects all and edits the board). The interaction is *choosing*, never *reading a wall*. If a variation feature ever produces more to review than it saves, it's wrong.

## Saving & key (plain words only)

- Saves automatically; top bar shows **Saved / Saving… / Couldn't save**. Never mention storage internals.
- No key set + press Run → *"Add your AI key to run this card."* → **Add key**, with *"Your key stays on this computer."*
- Errors are human: *"AI could not run. Check your key or try again."* No stack traces. An Ask AI card can run from its own task text; connected notes are optional context.

---

## The binding language rule (Concept 6)

Backend may be sophisticated; **the user never meets a word they'd have to translate** — not in the UI, and not in how we talk about Eido.

**User-facing words:** board, card, note, Ask AI, result, connection, strong, weak, helps, pushes against, Mod, slider, range, version, Run, make variations, Saved.

**Never shown to the user:** node, edge, graph, property graph, compiler, semantic, execution, topological, vector, embedding, database, persistence, hydrate, provenance, workflow, node-graph.

**In code:** prefer self-describing names — `gatherConnectedThought` not `compileContext`, `runCard` not `executeNode`, `saveBoard` not `persistGraph`, `connectionStrength` not `edgeWeight`. React Flow's "nodes/edges" get translated to "cards/connections" at the canvas boundary so the jargon never spreads.

**Translation table (binding for anything seen or heard):**

| Internal | User sees / we say |
|---|---|
| canvas | the board |
| node | card |
| note node | note |
| askAi node | Ask AI card |
| output / result node | result |
| mod / MOD node | Mod |
| Thought container | a group |
| connection strength (weight) | strong / weak |
| connection polarity | helps / pushes against |
| compiler / compiled context | "what AI used" / "the notes you connected" |
| run engine / execute | Run |
| output version stack | versions (keep one) |
| run record / provenance | *(never said)* — "what AI used" |
| local persistence | "saves automatically, still here when you come back" |
| model / token / inference | AI |

## The smell test (apply to every label, control, and feature)

1. Would a non-technical friend understand this word instantly? If not, replace it.
2. Does it tell the user what it *does for them*, or what it *is*? Prefer the former.
3. Can the app decide this automatically? Then don't ask.
4. **Does this accelerate creating, or add to reviewing?** If it adds review load without paying it back, cut it (Concept 6).
