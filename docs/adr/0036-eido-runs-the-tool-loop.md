# ADR 0036: Eido Runs The Tool Loop

Status: accepted

Amends: [ADR 0033](0033-agentic-runs-delegate-tool-use-to-the-provider.md)

## Context

ADR 0033 settled that Eido never runs a tool loop, and gave a good reason:
delegation is less code, less state, and less to get wrong, and the provider is
better placed to run tools than a desktop app is. Epic #931 shipped on that
basis and the feature works.

Then a live capture of a real Agentic Run was recorded, 290 lines of the SSE
stream, and read line by line. It showed the model calling
`openrouter:web_fetch`, reading a page, and describing it accurately in the
answer. It showed nothing else. No annotation named the page. No event carried
the address. The tool ran, the model saw the result, and the caller was told
only that a tool had been used.

This is not a bug to file. It is the shape of the arrangement. When a provider
executes a tool server-side, what it chooses to report back is the whole of
what a caller can know. `openrouter:web_search` does return `url_citation`
annotations and so the search half of the trail is real; `web_fetch` returns
none and so the fetch half is a claim Eido cannot substantiate. A trail that is
right about half its rows and cannot tell you which half is worse than no trail,
because it invites a trust it has not earned.

Linkup changes the available options rather than the argument. It is a direct
HTTP API that Eido calls itself, from the renderer, over a network boundary
already widened for it. Eido holds the query it sent, the sources it got back,
and the markdown it fed the model, because Eido is the one that asked. The
delegation argument was never wrong; it was answering a question about cost,
and the honesty of the trail is a different question that was not on the table
when ADR 0033 was written.

## Decision

**Eido runs the tool loop when it can execute the tools itself.** Concretely,
when a Linkup key is present and the provider is OpenRouter: the model emits a
tool call, Eido runs it, appends the result in the shape the model expects, and
re-requests, streaming throughout. The loop ends when the model answers with no
further calls.

**The declared set splits by executor rather than growing.** Three paths, and
the split is what keeps this from becoming a general tool runtime:

- **Eido-executed**, with a Linkup key on OpenRouter: search, page fetch, and,
  in Research mode, the research endpoint, declared as ordinary function tools.
  The model chooses whether to call, what to call, and with which parameters:
  search tier, domain and date filters, fetch mode, research mode and reasoning
  depth. Eido pins only what is not a retrieval decision. `outputType` stays
  `searchResults`, because Eido runs the loop and this model does the synthesis,
  so buying a second model's prose from Linkup would be paying twice for one
  answer.

  An earlier draft of this ADR had Eido fixing depth and output shape, on the
  reasoning that they are cost levers and the model does not pay. The founder
  removed cost as a constraint on 2026-08-18, which removes the whole of that
  argument: what is left is a retrieval decision, and the model holds the
  question that decides it. Tool descriptions carry the selection rules, so the
  choice is made against Linkup's own guidance rather than against a guess.
- **Provider-executed**, with no Linkup key: today's OpenRouter server tools,
  unchanged. The fallback is the code that already shipped and already runs,
  not a dormant branch that rots until the day it is needed.
- **Harness-owned**, on any local CLI provider: nothing declared, nothing
  changed. Those harnesses own their loops by design and this ADR does not
  reach them.

**There is no cap on what a run may spend, and ADR 0033's no-cap clause
therefore stands rather than being retired.** An earlier draft of this ADR
retired it. The argument was that ADR 0033 justified having no cap by pointing
at provider-side spend the user could see and limit at the provider, and that
this justification died with the provider-side loop, since Linkup credit has no
limit surface inside Eido and every loop iteration re-bills the whole prompt.
The reasoning held. The founder overruled the conclusion on 2026-08-18: cost is
not a constraint on this product, and a ceiling chosen by Eido truncates exactly
the long investigations the feature exists for. That is the same argument ADR
0032 made, and it survives the change of who runs the loop.

What does not survive is the assumption underneath it, which is worth stating
because it is the part that bites. A call budget was doing two jobs, and only
one of them was about money. It also terminated a loop in which a tool kept
failing: told a tool failed, models retry, and rate-limit backoff delays a retry
without ever ending one. So a run against a host that is permanently down had no
exit once the budget went.

**The loop therefore keeps one guard, and it is about termination, not spend.**
Consecutive failed calls with no successful call between them end the loop, and
the model answers with what it has. A run that is making progress is never
stopped, however long it runs and however much it costs. This is not a ceiling
in disguise: it cannot be reached by a run that is working, only by one that is
not.

Cancel remains unchanged and immediate, and now reaches the in-flight tool call
as well as the model request. Research is the exception it cannot cover, and
ADR 0037 says so plainly rather than letting the stop button imply otherwise.

**The honesty claim is narrower than it looks, and is stated at its true
width.** The trail records every call Eido makes. It does not record every
request that reaches the open web, because Linkup's own deep search runs up to
ten server-side passes and its research endpoint reports no intermediate steps
at all. Eido's claim is provenance and spend for its own calls, which is what a
reader can act on: a step is a page they can open and a charge they paid. A
claim that the trail is complete would be the same overreach this ADR exists to
correct, one layer further down.

## Consequences

The transport takes a conversation rather than one instruction string, which
four callers see. That is the real cost of this decision and it lands in one
place rather than spreading.

The tool-activity reader becomes per request rather than per run, because tool
call indices restart at zero on every response and a reader reused across
iterations silently merges the second iteration's first call into the first
iteration's fragment.

Each tool result is capped before it enters the prompt, head-weighted, with the
model told it was cut. Linkup will return up to 20 MB of HTML and one large
modern page is easily tens of thousands of tokens. Uncapped, the first
oversized result makes the provider reject the next request mid-loop, after the
user has already paid for the search, the fetch, and every prior iteration.

This cap and the prompt reserve beside it survive the removal of every spending
cap, because they are not spending caps. They are the size of the container. A
model window is finite, the compiler fills most of it before a lookup exists,
and every iteration re-sends the whole conversation. Removing them does not let
a run reach further; it fails the run at the next request, having spent
everything up to that point. The distinction is worth keeping straight, because
the two kinds of limit look identical in a diff and only one of them was ever a
product decision.

The fallback path is exercised by every user without a Linkup key, which is the
property that makes it trustworthy. A fallback nobody runs is a fallback nobody
has tested.

Eido now owns a class of failure it did not own before: rate limits, oversized
pages, unreachable hosts, and exhausted credit are its problem to name rather
than the provider's problem to summarise. That is the price of holding the
answer, and it is paid in `src/brain/linkup.ts` and one line of plain words per
failure.
