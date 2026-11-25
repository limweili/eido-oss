# ADR 0034: One Provider Key Is The Product Default

Status: accepted

Amended by: [ADR 0037](0037-a-second-key-buys-a-better-reach.md)

## Context

Ticket #927 added a second user credential, a Tavily search key, stored beside
the OpenRouter key in the same account-private local file. The reasoning was
sound for the mechanism it served: pre-flight research called Tavily directly
from the renderer, so it needed its own key, and Tavily's recurring free tier
made that the cheapest first month for a bring-your-own-key desktop app.

ADR 0033 removes the mechanism. On OpenRouter, search and fetch are executed
server-side and billed to the OpenRouter key already in Settings. On the local
harnesses, the CLI's own authenticated session pays. In both cases the Tavily
key is no longer on the path.

That leaves a question this ADR settles rather than leaves implicit: does Eido
keep asking users to configure a second key at all?

Founder direction (2026-08-16) is explicit: users should not need to configure
anything else, and must never choose a search option at run time.

There is a second, load-bearing reason that outlives this epic. Eido's
monetisation work, in progress elsewhere and out of scope here, is being built
directly on the OpenRouter key. Every capability routed through that key is a
capability the commercial path already covers; every capability routed around
it is one that path must later be extended to reach. Web reach is the first
test of that rule, and it should not be the exception.

## Decision

**One key runs the product.** A user who has configured their AI provider has
configured web reach. There is no second credential to obtain, no second signup,
and no second thing that can be missing when a run fails. Turning on Agent on an
Ask AI card is sufficient and complete.

**One key is the only key.** There is no fallback search credential. The
Settings search key added by #927 is removed, and `searchWeb` (Tavily) goes with
it.

This is a correction, taken on founder direction (2026-08-16) after review. The
first draft of this ADR kept the direct providers as a Settings-only fallback,
on the reasoning that an escape hatch costs one field and one branch. Review
established that the branch does not exist: ADR 0033 deletes pre-flight
research, which was the only machinery capable of putting Tavily output into a
run, and forbids the client-side loop that would be the alternative. The
"fallback" was therefore a credential with nothing behind it. Rather than
rebuild the rejected mechanism to keep a spare for it, it is removed.

`readPage` (Jina Reader) stays, because it is not a fallback: it is the engine
behind pasting a URL onto the canvas to make a Web Note, which is a shipped
capability with a real user and needs no key.

The reversal path for ADR 0033 is Git history plus a retrieval module that is
still built and still tested, not a dormant runtime branch. A dormant branch
with no default user does not survive contact with time; it rots quietly and
fails exactly when it is needed. Rebuilding from a known-good commit under
pressure is the more honest cost, and it is a cost we only pay if OpenRouter
disappoints.

**Provider selection is never a run-time choice.** The Ask AI card offers one
web-search toggle (a globe, no word) and no engine picker, no search-depth
control, and no result-count control. Anything tunable lives in Settings with a
working default, or does not exist. A card face that asks the user to pick a
search engine has moved the product's complexity onto the person least equipped
to resolve it.

**Cost is disclosed once, in Settings, not per run.** OpenRouter charges for
server-side tools on top of tokens (roughly $4 per 1,000 web results at the
time of writing, engine-dependent). Settings says so plainly beside the
web-search explanation. The card does not price each run, because a per-run price tag
would make people avoid the feature rather than understand it.

## Considered Options

- **Keep the Tavily key as a required second credential.** Rejected: it is now
  a redundant obstacle. Every user would configure a key that the default path
  never calls.
- **Keep the direct providers as a Settings-only fallback.** This was the first
  draft's decision, reversed on review. Rejected because the fallback had no
  execution path left: the mechanism that could have run it is deleted by ADR
  0032, and its replacement is forbidden by the same ADR. Keeping the field
  would have advertised a capability the product could not perform.
- **Rebuild a narrow pre-flight path, used only when the active provider cannot
  reach the web.** Rejected: it resurrects, in a corner and off by default,
  exactly the mechanism the founder rejected, and it would need its own tests,
  its own failure copy, and its own place in the run record for a path almost
  nobody takes.
- **Keep the search key but point it at Web Notes instead of runs.** Rejected:
  a search box that produces Notes is the Web panel again under a different
  name.
- **Let the card choose an engine per run.** Rejected on the founder's explicit
  direction, and on the general rule that a control which cannot be answered
  well by a user should not be shown to them.
- **Charge-visible-per-run UI.** Rejected: it prices attention rather than
  informing a decision, and the decision has already been made by the time the
  card is running.

## Consequences

- Onboarding is one key again. The README's "optional web search" section and
  the Settings copy both shrink to a single sentence about what Agent costs.
- Eido's cost per web result is higher than calling Tavily directly. That is
  paid deliberately: a recurring free tier that a user must go and claim is
  cheaper in dollars and more expensive in abandonment.
- Settings holds one AI credential again. A search key already stored by an
  existing user is removed from the keychain and dropped from settings at load,
  rather than left orphaned where a later feature might silently adopt it.

  Amended 2026-08-20: the retired `search` slot is no longer addressable at all.
  It was kept on the `eido:keychain:v1` wire purely so the renderer could ask for
  the leftover key to be cleared. That cleanup is now a startup file removal in
  the main process (`removeRetiredSearchCredential`), so an obsolete secret is
  still deleted from an existing user's disk while nothing in the running app can
  name, read, or write that slot. Tavily appears nowhere in the codebase; the only
  remaining mentions are this ADR and ADR 0037, which are records.
- The keychain work from #927, including the per-credential routing across the
  `eido:keychain:v1` bridge, is retained unchanged. It was built to hold more
  than one credential and still can; it simply holds one today. Removing the
  routing would be the expensive mistake, because the next credential is a
  matter of when, not whether.
- If OpenRouter's server tools prove unreliable, slow, or badly priced, the
  correction is a fresh ADR and a rebuild from the commit that removed
  `searchWeb`, not a switch. That is accepted deliberately, and it raises the
  stakes on the spike that opens this epic: it is now the only place where
  OpenRouter's behaviour is measured before we commit to it.
