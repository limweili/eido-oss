# ADR 0033: Agentic Runs Delegate Tool Use To The Provider

Status: accepted

Amended by: [ADR 0035](0035-the-tool-vocabulary-is-open-the-declared-set-is-closed.md), [ADR 0036](0036-eido-runs-the-tool-loop.md)

## Context

Epic #925 shipped web reach as *pre-flight research*: when a switch on an Ask
AI card was on, Eido searched the web on the card's own task text before the
run, read the top pages, and appended them to the compiled instruction. A
separate Web panel let the user search by hand and drop chosen pages onto the
Board as Notes. Both are now retired; this ADR records why and what replaces
them.

Pre-flight research was chosen under one belief: that Eido has no tool-calling
loop and cannot get one cheaply. `streamCompletion` sends one block of text and
streams one answer back. Four of Eido's five providers (`claude-code`, `codex`,
`gemini`, `antigravity`) are local CLIs reached through
`electron/aiHarnessBridgeContract.ts`, which accepts a prompt string and
nothing else. A tool definition cannot cross that boundary. Pre-flight
retrieval was therefore the only mechanism that behaved identically on all
five.

Two facts, both established after that epic landed, invalidate the belief:

1. **OpenRouter executes tools server-side.** `openrouter:web_search` and
   `openrouter:web_fetch` are passed in the `tools` array of an ordinary chat
   completion. The model decides whether and how often to call them; OpenRouter
   runs them and feeds the results back to the model inside the same request.
   The client sends one request and receives one answer. There is no loop for
   Eido to run, and no second round trip to implement.
2. **The local harnesses are already agents.** Eido launches Claude Code with
   `--permission-mode dontAsk` and Gemini CLI with its own tool surface intact.
   Those processes already own web search, already run their own loops, and
   already do it well. Building a second loop beside them would duplicate
   working software.

Founder direction (2026-08-16) also rejected the shape of the shipped feature
independently of the mechanism: an Ask AI card should run like an Ask AI card,
with the model deciding when to look something up, rather than the user
pre-declaring that a lookup will happen.

## Decision

An **Agentic Run** is an ordinary Run in which the model may call tools. It is
requested by a single toggle on the Ask AI card, labelled **Agent**, off by
default. Everything else about the run is unchanged: the same context compiler,
the same result card, the same output versions, the same provenance.

**Eido never runs a tool loop.** Tool execution belongs to the provider:

- On **OpenRouter**, Eido adds `openrouter:web_search` and
  `openrouter:web_fetch` to the request's `tools` array. OpenRouter executes
  them and returns the answer with `url_citation` annotations naming what was
  read.
- On the **local harnesses**, Eido asserts nothing new over the bridge. Those
  CLIs use the tools they already have. The bridge contract does not change.

The card is honest about this difference rather than hiding it: the Agent
toggle states which tools the currently selected provider can reach, because
the answer genuinely differs by provider and a silently weaker run is worse
than a visibly different one.

**There is no client-side cap on tool calls.** Modern models stop when they
have enough. A ceiling chosen by Eido would truncate exactly the long
investigations the feature exists to enable, and would do so invisibly. Cancel
remains, unchanged and immediate. The cost of a runaway run is bounded by the
user's own provider spend, which they can already see and cap at the provider.

**Tool activity is visible while it happens.** The result card streams a step
strip: each search and each page read appears as it occurs, and the strip
collapses into the saved version once the run finishes. An answer that cannot
show what it read is indistinguishable from an answer that read nothing.

**Naming.** In Eido, *Agent* already means an external AI reaching in through
the Agent Gateway (ADR 0026, ADR 0031). That meaning is unchanged. The new
concept is an **Agentic Run**, and the word "agent" never appears bare in code
or documentation: it is either an Agentic Run or the Agent Gateway. The Ask AI
card's button is still labelled **Agent**, because that is the word users think
in, and the two concepts never meet on the same surface.

**Retired.** The Web panel, its top bar entry, and pre-flight web research are
removed outright, and so is `searchWeb` in `src/brain/webRetrieval.ts`, which
loses its last caller with them (ADR 0034). `readPage` stays, because it is not
a leftover: it is the engine behind the one capability kept for its own sake,
which is that pasting a URL onto the canvas creates a Note holding that page.
Handing the model a specific page you already found needs no search, no key,
and no panel.

## Considered Options

- **A client-side tool loop in Eido, over a text protocol.** The model writes a
  structured block, Eido parses it, runs the tool, and feeds the result back on
  a second request. Works identically on all five providers. Rejected: it
  reimplements, worse, what OpenRouter and the CLIs already do, it multiplies
  token cost and failure modes, and text protocols degrade badly on models that
  did not train on them.
- **Keep pre-flight research and add tool calling beside it.** Rejected: two
  mechanisms for one job, with the user forced to understand which is running.
  Pre-flight research also cannot answer a follow-up question the model only
  discovers halfway through thinking, which is the whole point.
- **Agentic Runs on OpenRouter only, disabled elsewhere.** Rejected: the local
  harnesses are the strongest agents available and disabling them there would
  be false.
- **A fixed cap on tool calls.** Rejected per founder direction; recorded here
  as the known live risk of this ADR. The reversal condition is a real runaway:
  if a user reports a run that spent materially more than they expected, a
  `max_uses` bound on the OpenRouter side is the cheapest correction and does
  not require this ADR to be superseded.

## Consequences

- The run engine's pre-flight retrieval step is deleted. The context compiler
  stays deterministic for the reason it always was, and nothing is appended
  after the compile any more, so the "same graph, same instruction" property is
  now clean rather than qualified.
- Web material no longer enters the graph automatically. What the model read is
  recorded as run provenance and shown on the result card; it does not become
  Cards unless the user makes it so. This reverses a property of #925 and is
  the point: the Board is the user's thinking, not the model's scratch space.
- Provider capability becomes user-visible for the first time. This is a
  precedent: any future tool will differ by provider too.
- The OpenRouter boundary (`src/brain/openRouter.ts`) grows tool declarations
  and must parse `tool_calls` and `annotations` from the stream. Whether those
  arrive as streaming deltas or only on completion is unverified in
  OpenRouter's documentation and must be established by a spike before the
  step strip is designed against it.
- This is the first tool surface in Eido. It is deliberately two tools wide and
  provider-owned, so that a future third tool is an addition to a proven seam
  rather than a new architecture. It is not a general agent harness and must
  not grow into one without a further ADR.
  [ADR 0035](0035-the-tool-vocabulary-is-open-the-declared-set-is-closed.md)
  is that ADR, and it splits the clause in two: the set Eido *declares* stays
  closed and small for exactly the reason given here, while the vocabulary Eido
  *records* is open, because a Run written by a later build must still open in
  an older one.
