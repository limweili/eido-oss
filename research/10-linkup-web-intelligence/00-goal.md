# 00: The Goal

Status: active. Written 2026-08-18. This is the durable intent for the Linkup
epic. It outlives the plan, the tickets, and the branch. When execution
contradicts the method below, keep the destination, the product truths, and the
definition of done, and change the path.

## Destination

**A Card that reaches the web shows its work.** When Eido answers using the
open web, the reader can see what was asked, what was read, and where it came
from, in the reader's own words, and can go and check any of it. The material
the model read is available as markdown the reader can keep.

Eido gets there by calling a search provider directly instead of asking a model
gateway to search on its behalf. Linkup becomes the primary reach for search,
page fetch, and long-form research. The OpenRouter server tools that ship today
become the fallback for a user who has not pasted a Linkup key.

## Why this matters

Epic #931 shipped web reach through OpenRouter's server-side tools, then
measured what came back. A live capture of a real run showed the model
fetching a page, describing it accurately, and returning nothing at all that
named it. `openrouter:web_fetch` reports to the model and not to the caller.
The only caller-visible signal was a count of tool calls.

An answer that cannot show what it read is indistinguishable from an answer
that read nothing. ADR 0033 accepted that trade knowingly, in exchange for
never running a tool loop. The measurement changed the price: what looked like
a simplification turned out to cost the product its provenance.

Calling the provider directly fixes it at the root. The caller that makes the
request is the caller that holds the answer. There is nothing to infer, nothing
to reverse-engineer from a stream, and no dependence on what a middleman
chooses to disclose.

The second reason is depth. Linkup does multi-hop search, page navigation, and
research synthesis on their infrastructure and returns ready-to-read markdown.
Eido gets a materially stronger capability for roughly the same integration
cost as the weaker one it has.

## Product truths that must hold

1. **The Board is the user's thinking.** Web material becomes Cards only when
   the user makes it so. A run may read a hundred pages and add nothing to the
   canvas by itself.
2. **The Card is honest about what it did.** Every tool the run used gets a
   line. A step nobody recognises still gets a truthful line rather than being
   hidden. Nothing is dropped silently.
3. **No engine choice on the Card face.** One toggle. No depth picker, no
   result-count control, no provider selector. Anything tunable lives in
   settings with a working default, or does not exist. A control a user cannot
   answer well should not be shown to them.
4. **Reach degrades visibly, never silently.** A user without a Linkup key gets
   the OpenRouter path and the Card says so. A weaker run that looks identical
   to a stronger one is the failure this whole epic exists to correct.
5. **A run's cost is never a surprise.** The existing rule is that cost is
   disclosed once, in settings, not priced per run. That rule was written for
   half-cent calls. It must be re-decided, not assumed, for any call that can
   spend dollars.
6. **The design system governs the surface.** Components name tokens and roles,
   never raw values. New surfaces obey `docs/design/design-system/SYSTEM.md`.
7. **Provenance survives a version skew.** A Run recorded by a newer build must
   still open in an older one. The recorded tool vocabulary stays open; the
   declared one stays closed and small.

## Safety boundaries

- **The founder is the final tester.** Nothing from this work reaches `main`
  without them. Landing on the shared working branch is expected and needed to
  unblock dependent lanes; landing on `main` is theirs to authorize.
- **Widening the network boundary is a deliberate, visible act.** The packaged
  app allows exactly one external host today, pinned by a proof gate. Any new
  host is its own reviewed change, never a side effect of another one.
- **Credentials are never read, echoed, logged, or written to a test fixture.**
  Proof runs use disposable roots and synthetic data, never the founder's
  Profile.
- **A user's query text leaves their machine.** That is a second vendor and a
  second disclosure, and the product says so plainly where the key is pasted.
- **No spend without intent.** Nothing in this work may cause a paid call the
  user did not ask for, and cancel stays immediate.

## Definition of done

Judged by observation, not by reading a progress log.

- A run with a Linkup key shows a trail naming every search query and every
  page opened, streaming as it happens, with page links that open away from the
  Board. What the model read is checkable by the reader.
- A run without a Linkup key still works, through the OpenRouter path, and the
  difference is stated rather than hidden.
- A run on a local CLI harness is unchanged.
- Search, page fetch, and research each reach the user as a capability, or are
  explicitly and visibly deferred with the reason recorded.
- Failures reach the user as plain words: no key, out of credit, rate limited,
  page unreadable. Each is distinguishable from the others, and each says what
  the user can do.
- The packaged build proves the new network boundary. A renderer-side reach is
  only proven by a packaged run, never by a dev one.
- The epic's decisions are recorded as ADRs, including the two reversals this
  work requires: that Eido now runs a tool loop, and that a second credential
  now exists.
- Documentation, glossary, and the design system reference agree with the code.
- The tracker and the delivery state agree, and every loose end has an owner or
  a deliberate disposition.

## Authority and escalation

Decide mechanics without the founder: slicing, sequencing, worktrees, conflict
resolution, review routing, test shape, failure triage, cleanup.

Escalate only these:

- **money made visible**: whether a Card that can spend dollars per press gets
  a price on its face, and what caps exist;
- **product behaviour the founder has an opinion about**: the shape of a
  research surface that runs for minutes rather than seconds;
- **anything touching real Profile data or a live credential**;
- **anything irreversible**, including a merge to `main`.

A concern raised once and reaffirmed is settled. Proceed with the full request
and record the assumption.

## Evidence philosophy

Proof answers one question: would more of it change what we do next?

- **Provider behaviour is proven by capture, never by documentation.** This
  epic exists because documented behaviour and observed behaviour differed.
  Every claim about what Linkup or OpenRouter returns is settled by one live
  request, once, at the boundary that owns it.
- **The network boundary is proven where it binds**, which is the packaged
  build, not the dev server.
- **Shared behaviour is proven once at its authoritative seam** and reused.
  The tool trail is finished, proven work; steps from a new executor are the
  same steps and do not earn a second suite.
- **Prefer few broad tests at real product seams** over many narrow ones pinned
  to internals.
- Stop and reslice when the evidence machinery starts to rival the change it
  validates, when a failing check says more about the host than the code, or
  when proof is being rebuilt for a head that has not semantically changed.

Tests serve the product's direction. A test failing because behaviour was
deliberately retired is a deletion, not a blocker.
