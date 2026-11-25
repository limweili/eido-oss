# Two modes, dynamic tools, and no caps

Founder direction, 2026-08-18, superseding the depth-menu design in #960 and
the ceiling design in #962. Recorded here because it reverses decisions this
epic had already built and shipped to the working branch.

## What the founder said

> I actually don't want any caps. I want to rely on Linkup's API options and
> have the AI model that is running it make their own decisions accordingly.
> I'm not concerned about pricing.

> I want 2 modes: Web (combines Search + Fetch), and Research. The button needs
> to cycle between Web, Research and Off.

> Ask AI cards should always default to fast, and auto adjust to standard or
> deep if required. Each of the options should be exposed as a tool with
> dynamic parameters and tool descriptions. The user should not need to choose
> the option. It should be task specific and handled autonomously by the LLM
> reasoning, and tool call ability of the Ask AI Card's selected LLM model.

> Warn before submitting only for the research endpoints. Do not warn for web
> mode.

## The control

One button in the Card foot, cycling **Off -> Web -> Research -> Off**. The
Quick / Deeper / Study picker is retired: it asked the user a question the model
is better placed to answer, which is the same rule that kept an engine picker
off the Card in ADR 0034. The button asks the one question the user genuinely
owns: how much of the web should this run be allowed to touch.

**Off** declares nothing. **Web** declares the two synchronous tools. **Research**
declares the research tool as well, because a research job runs for minutes and
cannot be stopped once submitted, which is a different kind of press.

### Where the state lives

`card.agentic` stays a boolean and keeps meaning "reach is on", so a Board saved
here still opens in a build that predates this work with its reach intact.
The mode rides in `card.meta.reachMode` as `'web' | 'research'`, the same
open-record escape hatch #960 proved: the persistence validator holds Cards to a
closed key set and fails the whole projection on a stranger, so a new top-level
field is a lost board rather than a lost setting. An absent or unrecognised
`reachMode` reads as `web`.

## The tools

Eido declares plain function tools and lets the model fill the parameters. This
is the reversal: the previous design fixed depth and output shape on the grounds
that they are cost levers and the model does not pay. Cost is no longer a
constraint, and the model choosing per call is strictly better retrieval than
Eido choosing per Card.

Eido still fixes what is not a retrieval decision. `outputType` is pinned to
`searchResults` for search, because Eido runs the loop and the model does the
synthesis: asking Linkup for a `sourcedAnswer` would pay a second model to write
prose that this model then rewrites. `structured` is not exposed, because
nothing downstream of the loop consumes fields.

### `search_web`

| Parameter | Type | Default | Model chooses |
| --- | --- | --- | --- |
| `query` | string | required | yes |
| `depth` | `fast` / `standard` / `deep` | `fast` | yes |
| `includeDomains` | string[] | absent | yes |
| `excludeDomains` | string[] | absent | yes |
| `fromDate` / `toDate` | ISO date | absent | yes |

`fast` is the default because the founder asked for it and because Linkup's own
guidance agrees: most lookups are one fact in a snippet, and `fast` returns in
under a second with no LLM in the path. The tool description carries the
three-question chain that moves a call up from `fast`, so "auto adjust to
standard or deep if required" is a decision the model makes with the rule in
front of it rather than a heuristic Eido guesses at.

The one hard rule the description must state, because it is the failure mode
Linkup names first: **`standard` cannot discover a URL and then scrape it in
the same call.** That needs `deep`, or a search followed by `fetch_page`.

### `fetch_page`

| Parameter | Type | Default | Model chooses |
| --- | --- | --- | --- |
| `url` | string | required | yes |
| `renderJs` | boolean | `true` | yes |
| `mode` | `standard` / `pro` | `standard` | yes |

`renderJs` defaults on against Linkup's own API default of off, following their
skill's advice: many sites render client-side and the latency is worth the
reliability. `pro` exists for pages that resist retrieval.

### `research`

Declared only in Research mode.

| Parameter | Type | Default | Model chooses |
| --- | --- | --- | --- |
| `query` | string | required | yes |
| `mode` | `answer` / `investigate` / `research` | none, model must choose | yes |
| `reasoningDepth` | `S` / `M` / `L` / `XL` | none, model must choose | yes |

Both are required rather than defaulted, because Linkup's guidance is explicit
that leaving them unset makes latency, cost, and output shape unpredictable, and
because a run the user has just been warned about should not then be vague about
what it is doing. `outputType` is pinned to `sourcedAnswer`.

Submit is `POST /v1/research`, then `GET /v1/research/{id}` polled with
exponential backoff starting at 2 seconds and capping at 10, never faster than
once per second. Failed jobs are not charged.

## The travelling brief

A compressed version of Linkup's query guidance goes into the prompt whenever
reach is on, in `eido-tool-brief.md`. It is paid for on every request of every
loop iteration, so it is short by construction: the request-shape chain, the
retrieval-plan framing, the `standard`-cannot-chain rule, and the bad-pattern
list. Everything else stays in `upstream/` as reference for humans.

Tool descriptions carry what belongs to one tool. The brief carries what spans
them: that a Linkup query is an instruction to a retrieval system rather than a
question, and that the query should name the fields to return.

## What has no cap any more

Retired on founder direction:

* the per-run call budget (was quick 8, deeper 15, study 3);
* the loop iteration guard derived from it;
* Eido fixing the search tier per Card depth.

The token reserve and the per-result character cap **stay**, and they are not
spending controls. A model context window is finite, the compiler already fills
most of it, and every loop iteration re-sends the whole conversation. One
uncapped 20 MB page does not cost more, it makes the provider reject the next
request and fails the run after the user has already paid for everything before
it. That is a container, not a ceiling.

**What replaces the runaway guard.** With no call budget, a tool that fails
repeatedly has nothing spending it down, so the rate-limit backoff from #961 is
now the only thing between a 429 and an unbounded spin. Backoff alone does not
terminate. The loop therefore keeps one guard that is about termination rather
than spend: consecutive failed calls with no successful call between them end
the loop and the model answers with what it has. A run that is making progress
is never stopped.

## The research warning

Founder: warn before submitting, for research only, never for web.

The warning fires on the **first research-mode Run press per Card per session**,
and that press is held: nothing is submitted until Run is pressed again.

An earlier draft fired it when the Card was armed into Research mode, arguing
that arming is the last user action before Run. That is true exactly once. The
mode persists in `card.meta`, so a Board reopened next week runs research on
every press having warned nobody, and "armed" and "about to spend minutes" stop
being the same moment the second time. The adversarial review caught it; the Run
press is both safer and closer to the founder's own sentence.

Holding the press rather than warning alongside it is the other half. A warning
that arrives while the money is already leaving is a receipt.

The note states two facts and then the way out: it runs for minutes, stopping
the run does not stop it or refund it, and pressing Run again starts it. The
third fact anyone reaches for here is a price, and cost is said once, in
Settings. Without the way out, a press that does nothing reads as a broken
button rather than a question.

It is not a modal. The Board, the globe, and every other Card stay live, and
cycling the globe away stands the warning down.

**Follow-ups never reach research, in any mode.** A follow-up builds its tool
set from the Card, so without a clamp a Card armed into Research hands every
reply in its thread a tool that submits an uncancellable job: a one-line reply
could start twenty minutes of work the user was warned about once, days ago,
about a different press. This restores a fix the epic made before the pivot and
lost in it. Someone who wants another investigation presses Run.

Cancel still stops the run and the polling at any point. The copy does not
pretend it stops the job.
