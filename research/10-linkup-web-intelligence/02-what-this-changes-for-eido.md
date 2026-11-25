# 02: What Linkup Changes For Eido

Status: current as of 2026-08-18. Written against head `afa1c12f` on
`claude/eido-web-search-688819`, which is [PR #955](https://github.com/limweili/eido/pull/955),
the Agentic Runs epic (#931). Facts about Linkup are in
[01-api-surface.md](01-api-surface.md).

## The one sentence

Linkup replaces a capability Eido cannot see into with one it runs itself, and
that single structural difference is what buys the tool trail, the depth, and
the markdown.

## Why this is not a preference

The Agentic Runs epic shipped OpenRouter server tools, then measured them. The
measurement is the reason this document exists.

A live capture of 290 SSE lines from a real Eido run, taken 2026-08-18, found
every delta key OpenRouter emitted across a whole streamed completion:
`content`, `role`, `reasoning`, `reasoning_details`. No `annotations`. No
`url_citation`. No `tool_calls`. The model had fetched a specific page and
described it accurately in its answer, and the address of that page appeared
nowhere in the response. The only caller-visible evidence that a tool ran at
all was `usage.server_tool_use_details.tool_calls_executed: 1`.

So on OpenRouter today:

- `openrouter:web_search` surfaces its results as `url_citation` annotations,
  which Eido can and does draw.
- `openrouter:web_fetch` surfaces **nothing at all** to the caller. The page
  enters the model's context and the caller never learns which page it was.

That is not a bug to file. It is the shape of the arrangement: OpenRouter runs
the tools inside its own completion, and what it chooses to report back is the
whole of what a caller can know. ADR 0033 bought simplicity ("Eido never runs a
tool loop") and the price turned out to be provenance. Provenance is the thing
the Card exists to show.

Linkup inverts it. Eido makes the call, so Eido holds the request and the
response. Every search query, every URL, every source name, every snippet, and
a markdown body Eido can put on the Board. There is nothing to infer.

## What actually changes: who runs the loop

Today, on OpenRouter:

```
Eido -> OpenRouter (tools declared) -> [OpenRouter runs them, silently] -> one answer
```

With Linkup:

```
Eido -> OpenRouter (tools declared as ordinary functions)
     <- tool_calls
Eido -> Linkup                      (Eido sees the query and the result)
Eido -> OpenRouter (tool results appended)
     <- answer, or more tool_calls
```

This is a **client-side tool loop**, and ADR 0033 forbids it in as many words:
"Eido never runs a tool loop." Reversing that is the load-bearing decision of
this work and must be recorded as its own ADR, not slipped in.

The reversal is earned, and specifically:

- ADR 0033 rejected the loop as "a client-side tool loop in Eido, **over a text
  protocol**": the model writes a structured block and Eido parses it. That
  option deserved rejection. It is not the option here. OpenRouter speaks
  OpenAI-compatible function calling natively, so the loop rides a typed
  protocol the model was trained on, not a prose convention.
- ADR 0033 also assumed the loop bought nothing OpenRouter did not already
  provide. The capture disproves that. The loop buys the trail.

The costs of the loop are real and should be stated plainly: more round trips,
higher token spend (every tool result re-enters the prompt), and a new class of
failure between the two calls. Those are the same costs OpenRouter was already
paying invisibly on Eido's behalf; the difference is that Eido now owns them
and can show them.

## What stays exactly as it is

This is the part that makes the work tractable, and it is a direct dividend of
ADR 0035.

`RunToolStep` is `{kind: string, detail: string, title?: string}` with an
**open** `kind`. The persistence validator checks shape, never membership. The
presentation registry (`runToolVocabulary`) is the one place a kind acquires an
icon, a label, and a link rule. Nothing that renders a step reads `step.kind`.

So a new step kind (`research`, or a Linkup-flavoured `search`) costs:

- one entry in the presentation registry, plus its words in `words.ts`;
- zero changes to `RunToolStep`, to the persistence validator, to
  `RunToolTrail`, to `ResultCard`, or to any test that pins them.

The trail component itself is finished work and should not be touched: it
already streams open while a run works, folds on landing, shows five steps then
offers the rest, opens links away from the Board, and rides follow-ups. Steps
arriving from a different executor are the same steps.

Also unchanged: the context compiler stays deterministic, provenance keeps one
shape whoever ran the tool, and the Board still only grows Cards the user makes.

## The seams

| Seam | Change | Size |
| --- | --- | --- |
| `src/brain/linkup.ts` (new) | the only module that names Linkup. Typed error codes, never message parsing, mirroring `webRetrieval.ts`. | the bulk of the new code |
| `src/brain/agenticRun.ts` | `DECLARED_SERVER_TOOLS` splits into provider-executed and Eido-executed sets, selected by which credentials exist. | moderate |
| `src/brain/openRouter.ts` | `streamCompletion` gains the loop: detect `tool_calls`, execute, append `role: "tool"` messages, re-request, keep streaming. | the riskiest change |
| `src/canvas/cards/runToolVocabulary.ts` | one entry per new kind. | trivial |
| `src/shared/words.ts` | words for the new kinds and the new failures. Watch `FORBIDDEN_SAAS_WORDS`: `configure`, `manage`, `enable`, `workspace`, `preferences`, `optimize`, `leverage`, `seamless` are all banned in user-visible copy and `words.test.ts` enforces it. | trivial |
| `electron/keychainBridgeContract.ts` | add a `linkup` credential slot. | one line, by design |
| Settings | a second key field, its cost sentence, and the fallback explanation. | small |
| `src/brain/webRetrieval.ts` | Jina Reader stays for keyless Web Notes, or is reconsidered against Linkup `/fetch`. See the open questions. | decision, not code |

ADR 0034's own words on the keychain, written before Linkup existed: "It was
built to hold more than one credential and still can; it simply holds one
today. Removing the routing would be the expensive mistake, because the next
credential is a matter of when, not whether." This is the when.

## Fallback ordering

The founder's direction is Linkup primary, OpenRouter fallback. Concretely:

1. **Linkup key present, provider is OpenRouter.** Eido declares Linkup tools
   as ordinary functions and runs the loop. Full trail.
2. **No Linkup key, provider is OpenRouter.** Eido declares
   `openrouter:web_search` and `openrouter:web_fetch` as today. Partial trail
   (citations only). This is exactly what PR #955 ships, unchanged, so the
   fallback is proven code and not a dormant branch.
3. **Provider is a local harness** (`claude-code`, `codex`, `gemini`,
   `antigravity`). The harness owns its own loop and its own tools. Eido
   asserts nothing over the bridge, per ADR 0033, which is undisturbed here.
   Linkup's MCP server is the user's own option to add, and it is worth
   documenting rather than automating.

Selection is never a run-time choice on the Card face. ADR 0034 settles that
and this work does not reopen it: the globe toggle stays one toggle.

## Cost, and the one number that breaks the current rule

Linkup search is cheaper than OpenRouter's server search per call. Fetch is
close to free. Those fit the existing disclosure model without strain.

Research does not.

| Call | Price | Time |
| --- | --- | --- |
| search standard, sourced answer | $0.006 | 1 to 3s |
| search deep, sourced answer | $0.055 | 5 to 30s |
| fetch, standard, no JS | $0.001 | ~1s |
| research S | $0.25 | 2 to 5 min |
| research L (default) | $1.50 | 5 to 10 min |
| research XL | $2.50 | 10 to 20 min |

ADR 0034 decided: "Cost is disclosed once, in Settings, not per run. The card
does not price each run, because a per-run price tag would make people avoid
the feature rather than understand it."

That reasoning holds at $0.006. It does not obviously hold at $2.50. A control
that can spend two and a half dollars on one press, silently, is a different
object from a control that can spend half a cent. This is a founder decision,
not an engineering one, and it is listed in the open questions below.

## Spikes, ordered by how much they can wreck the plan

**S1. Does `api.linkup.so` allow a browser-origin request? RESOLVED: yes.**

Probed 2026-08-18. A CORS preflight against `POST /v1/search` from origin
`http://localhost:5311` returns `204` with:

```
access-control-allow-origin: http://localhost:5311
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
access-control-allow-headers: authorization,content-type
access-control-allow-credentials: true
vary: Origin, Access-Control-Request-Headers
```

Linkup reflects the requesting origin and permits both headers Eido needs. So
Linkup can be called from the renderer, exactly like OpenRouter and Jina
Reader, and **no main-process IPC bridge is required**. This is the single
biggest de-risking in this document: it removes a whole slice from the plan.

Two extra facts fell out of the same probe.

*Undocumented rate-limit headers.* Every response carries
`x-ratelimit-limit: 10`, `x-ratelimit-remaining`, and `x-ratelimit-reset`,
which is a better backoff signal than the docs promise. Worth reading, worth
not depending on.

*A missing key is 402, not 401.* The error reference says 401 for a missing
key. Reality, with no `Authorization` header at all, is:

```json
{"error":{"code":"X402_PAYMENT_REQUIRED","details":[],"message":"Payment required"},"statusCode":402}
```

plus a `payment-required` header carrying an x402 challenge. Eido's error
mapping must key on the body's `code`, never on the status alone, or "you have
not pasted a key" will surface as a payment failure.

**S1b. The packaged app's own CSP blocks it, and that is a separate change.**

Renderer reachability is necessary but not sufficient. The packaged desktop app
serves the renderer with a fixed Content Security Policy whose network clause is
exactly `connect-src 'self' https://openrouter.ai`, and that string is pinned in
four places: the policy itself, the protocol test, an expected-value constant in
the main process, and a packaged-proof gate that **fails the proof** if the value
differs.

Adding `https://api.linkup.so` is therefore a deliberate, reviewed widening of
Eido's network boundary, not an incidental edit. It is small, it is well
guarded, and it deserves its own slice so the widening is visible in one diff.

**S1c. A live bug this probe surfaced: Web Notes are probably broken when packaged.**

`readPage` fetches `https://r.jina.ai/`. That host is not in `connect-src`.
Pasting a URL onto the canvas to make a Web Note (#938) therefore works against
the dev server, where no such policy applies, and should fail in the packaged
build. Nothing in the current test suite would catch it, because the Web Note
tests stub `fetch` and the packaged proof never exercises the paste path.

This predates Linkup and is not caused by this work. It is recorded here
because this is the work that has to touch that policy anyway, and because it
is evidence for a general point: a renderer-side network boundary is only
proven by a packaged run, never by a dev one.

**S2. Does the loop actually behave on OpenRouter, on the models Eido ships?**

Client-executed function calling is standard, but "standard" and "works on this
model at this reasoning effort with streaming on" are different claims. The
prior epic's whole lesson was that unverified provider behaviour costs a
rewrite. One live capture settles it.

**S3. What does a 20-minute Research job do to a Run?**

Every Run in Eido today streams and finishes in seconds. Research submits,
polls, and returns nothing until it is done. That touches cancel, persistence
across an app restart, what the Card shows for ten minutes, and what happens if
the user quits mid-job. It is the single biggest behavioural change in this
work and it is a strong candidate for a later wave rather than the first.

**S4. SDK or plain fetch?**

`linkup-sdk` is a thin wrapper over the same JSON, with no streaming and no
partial results. The renderer bundle budget is 491 KiB and PR #955 landed at
490.7. Plain `fetch` costs about a hundred lines and zero bundle. Recommend
plain fetch, consistent with how `webRetrieval.ts` and `openRouter.ts` already
talk to their providers.

## Open questions for the founder

1. **Does a Card get a price tag when the press can cost $2.50?** See the cost
   section. Options: keep Settings-only disclosure and cap Research depth to S
   or M; price Research on the card face only; or put Research behind its own
   explicit Card kind so the expensive thing is never the accidental thing.
2. **Does Research ship in the first wave, or the second?** S3 is the reason to
   ask. Search plus Fetch is a complete, shippable, visibly better product on
   its own.
3. **Does Jina Reader survive?** Linkup `/fetch` is better (PDF, JS rendering,
   pro mode) but costs a key, and today's Web Note paste works on a fresh
   install with no key at all. Recommendation: keep Jina as the keyless
   default for pasted URLs, and use Linkup `/fetch` inside runs where a key is
   already present. Two readers for two jobs, not a fallback chain.
4. **Is a second signup acceptable?** ADR 0034 chose one key deliberately, and
   partly because Eido's monetisation work is being built on the OpenRouter
   key. A Linkup key is a second credential outside that path. The founder has
   directed it; this records that the tension is understood, not overlooked.

## What to read next

- [ADR 0033](../../docs/adr/0033-agentic-runs-delegate-tool-use-to-the-provider.md), whose "Eido never runs a tool loop" this supersedes.
- [ADR 0034](../../docs/adr/0034-one-provider-key-is-the-product-default.md), whose "one key is the only key" this supersedes.
- [ADR 0035](../../docs/adr/0035-the-tool-vocabulary-is-open-the-declared-set-is-closed.md), which this work leans on and does not change.
