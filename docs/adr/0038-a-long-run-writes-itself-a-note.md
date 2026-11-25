# ADR 0038: A Long Run Writes Itself A Note

Status: accepted

Extends: [ADR 0015](0015-context-budgets-compact-before-dropping.md), [ADR 0036](0036-eido-runs-the-tool-loop.md)

## Context

ADR 0036 gave Eido the tool loop. ADR 0036 also named the container it runs in:
a model window is finite, the compiler fills most of it before a lookup exists,
and every iteration re-sends the whole conversation. Its answer at the time was
a fixed prompt reserve, chosen at compile time, and a cap on each tool result.

Both are sizing decisions made before the run starts. Neither watches what
happens afterwards, and two things keep growing after it.

A Research run works for minutes across dozens of lookups, and its conversation
only grows: each assistant turn with its tool calls, each capped result, all of
it re-sent every turn. A reserve chosen in advance cannot know how many turns
there will be. Eventually the request is larger than the model accepts, the
provider refuses it outright, and the person loses the answer along with every
search and page they already paid for.

A Result Card grows the same way and for longer. Every follow-up re-sends the
whole of the card's context: the frozen run context it was made from, the
version text being discussed, and every turn of the discussion so far. That is
the surface a person actually lives in, and it is the one that outgrows a window
in ordinary use rather than only during research. It is also the surface where
new features land. Web mode, lookups, tool trails and whatever comes next all
end up in the same place, and a guard that had to be taught about each of them
in turn would be wrong on the day the next one shipped.

The obvious alternatives were considered and rejected:

**Cap the number of turns.** This is the spend ceiling #965 retired, wearing a
different hat. It stops runs that are working.

**Drop the oldest turns.** Cheap, and it destroys exactly the evidence the
answer rests on. A run that has read eleven pages and forgotten the first eight
cannot cite them, and does not know it cannot.

**Raise the reserve.** Every token reserved against a hypothetical long run is a
token the compiler cannot give to the person's own connected material on the
overwhelming majority of runs that are short. Sizing for the worst case taxes
the common one.

The harnesses that solved this in public converged on the same answer, and their
published failure modes were more instructive than their designs. Three points
recur: thresholds around 95% are too late, because the summariser needs room to
answer in; an open "summarise this" instruction reliably omits whichever part
the next turn needed, so the ask must be a fixed checklist; and repeated
compaction degrades quality, so anything that refills the window immediately
after compacting (re-reading files, restating context) turns one compaction into
a cascade.

## Decision

**Anything that is about to outgrow its window stops, writes itself a handoff
note, and continues from the note.**

**The measurement is of the Result Card's own context, not of any one thing that
feeds it.** The assembled instruction, the board's guidance, and the framing
around them, against the window of the model that will be sent it. Tool
declarations and the travelling brief on an agentic follow-up sit outside that
count, deliberately: they are a fixed lump of a few hundred tokens against a
six-figure threshold, and they live below the injection point this seam is not
allowed to see through. Nothing at this seam knows or cares what put the text
there. This is the load-bearing choice in the whole decision: a guard that
measured the web tool's output, or the research mode's transcript, or the tool
loop's conversation, would be a guard that has to be extended by every future
feature and will be forgotten by one of them. If it enters the card's context,
it is counted (founder decision, #1036).

Concretely, before every follow-up leaves a card:

**Only the discussion may be cut.** The frozen run context and the version text
are the card's identity, not its history. A summary of them would be a different
card, so they are sent verbatim however long the discussion gets.

**Cuts land between turns.** A question and everything answering it are one unit,
so a note can never strand a question without its answer.

**The note replaces those turns in the outgoing request only.** What the reader
sees on the card is untouched, and so is everything the thread feeds downstream.
Nobody loses a conversation because it got long.

**How much may be kept whole is a share of the room, never a constant.** The
freshest turns stay verbatim, but never at more than half the threshold, and the
minimum material worth a summarising call is never more than a quarter of it. On
an ordinary window the fixed numbers bind and nothing changes. On a small one
they are the whole budget: a 16k model has a 12,800 threshold, and a fixed
12,000 tail inside it means compaction fires, finds nothing it is allowed to
cut, and the card walks into the refusal anyway. Small windows are not
hypothetical, and a guard that silently stops working on them is worse than no
guard, because it looks like it is working.

**A note is written once and reused.** It is held against the messages it stands
in for and re-applied on the next follow-up. A thread that changed underneath it
drops it rather than sending a summary of turns that are no longer there, and a
window with room to spare stops applying it, because a note is a saving and not
a state the card is now stuck in.

**A card never pays to summarise its own summary.** What a cut is worth is
judged on what the summariser will actually be handed, which excludes a note it
is already given once and the trail row that records it. Without that, a card
whose frozen context alone sits near the threshold would find one large
summarisable turn every time, its own note, and buy a completion per follow-up
to rewrite it, each one a lossy generation further from what the reader said.
The cost of compaction is therefore proportional to new discussion, not to
questions asked.

**A note that is not smaller is not a compaction.** The summariser is told to be
complete rather than brief and given no length cap, so it can hand back more
than it was given. The rebuilt request is measured before it is sent, and a
larger one is discarded along with the note.

**And material that could not be shortened is not offered twice.** This was
observed rather than imagined: a discussion of a hundred dense points, each with
its own figures and its own web address, is already as short as it can be said,
and a summariser ordered to copy every number and address exactly returns a note
the size of what it replaced. Discarding it is right; paying for it again on the
next follow-up is not. So the messages that failed are remembered, and the
summariser is not asked about them again. The memory is of the material, not of
the card: once the discussion grows past what was declined, the question is a
different question and gets asked. This is deliberately narrower than latching
the card itself, which would let a card whose frozen context alone nearly fills
the window grow without limit into a refusal.

**Nothing weaker than a clean compaction stops the follow-up.** A discussion too
short to be worth cutting, a summariser that failed, a summariser that said
nothing: the instruction goes out unchanged in every one of those cases.
Refusing to send on Eido's own estimate would fail a follow-up that would have
worked.

And inside a single run, in the loop Eido owns:

**Measured before every request, never after a refusal.** Compacting early costs
one summarising call. Compacting late costs the run. The measurement is the
usage the provider reported for the last request, which is counted with the
model's own tokenizer and is authoritative for everything sent up to that point,
plus a QuadChars estimate of only what has been appended since. With no usage
reported the estimator covers the lot.

**At 80% of the window, not 95%.** The margin is not caution for its own sake:
it is the room the summariser needs to write in, plus the estimator's error on
the unmeasured tail.

**Cuts land between blocks, never inside one.** An assistant turn that called
tools and the tool messages answering it are one indivisible unit. A tool result
whose call has been summarised away is a malformed request, rejected by the
provider before the model sees it. This is the single most likely way to get
this wrong and the only one that fails loudly.

**The system framing, the travelling brief, and the person's compiled
instruction survive verbatim, forever.** That instruction is the task. A summary
of the task is a different task, and a run that compacts its own brief has
quietly changed what it was asked.

**The summariser is the run's own model.** A cheap small model is the obvious
saving and the wrong one: the conversation being summarised is by definition
near a large window, and a small model's window cannot hold it, so the saving
buys a call that fails exactly when it is needed.

**One note per run, not a stack.** Each compaction is given the previous note as
material and supersedes it. A run that compacts five times carries one note.

**The note is asked for as five fixed headings**, not as an open request: what
the run was asked for, what has been established and from which addresses, what
did not work, what is still open, what to do next.

**Nothing refills the window afterwards.** No re-reading, no restating. The
cascade the published failures describe is a consequence of automatic
re-hydration, and Eido has none to remove.

**When it cannot help, the run degrades truthfully, and only then.** If a cut
was made and the run is still over the threshold, the tools come off and the
model is told plainly that there is no room left, in words distinct from the
repeated-failure guard's. The run still ends in an answer, and the answer can say
what went unchecked.

Nothing weaker earns that degradation. A summariser that returned a 500 has
proved nothing about how much room the run has, and a conversation holding
nothing but its own instruction has nothing to prove it with. In both cases the
history stands, the tools stay, and the provider gets to be the one that says no:
a failed tidy-up is not a failed run. A summariser that fails twice running is
simply not asked again, because each attempt is a full-price call at the size of
the window.

**A refusal Eido did not predict is recoverable once.** The threshold is
measured against a window Eido believes the model has, and that belief can be
wrong. When a provider refuses a request as too long, Eido takes the number the
provider stated, compacts, and sends once more. It retries only when the
conversation actually changed: re-sending the same bytes buys a second refusal at
the price of a whole request. A second refusal in a row fails the run as before,
because length was not the problem.

The number taken from a refusal is treated with more suspicion than the rest of
this, because it is the only thing here that persists on the device across runs.
A refusal message is prose. When it states two numbers the smaller is the limit,
since the count that broke it is by definition larger. When it states four, the
smallest is not the limit at all: "maximum context length is 128000 tokens.
However, you requested 132000 tokens (116000 in the messages, 16000 in the
completion)" ends with the completion allowance, and taking it would record this
model as an eighth of its real size for as long as the device keeps the
correction. So a number the message says is part of the request is set aside
before the smallest-wins reading is applied. The numbers are set aside, not the
brackets around them, because some providers bracket the limit itself. A number touching the end
of the read body is discarded as a possible mid-digit clip. A number too small to
be anyone's window is discarded as a misparse. A correction may only ever shrink
the belief, because a refusal is evidence that the window is smaller and evidence
of nothing else. And a correction is dropped once the catalog's published number
for that model changes, because the model has been re-released and the old
refusal no longer describes it. A ceiling on the answer (`max_tokens`) is never
read as a ceiling on the conversation.

**It shows in the trail and nowhere else.** One row on the Result Card, in the
trail's existing plain voice, opening to the note that was written. It appears
whatever the card is armed to do: a plain discussion compacts exactly as an
Agentic Run does, and the reader is owed the same account of it. Nothing about
this reaches Settings. It is an engineering parameter, like every other context
budget tunable, and a person who has to configure their context window has been
handed the machine's problem.

## Consequences

Compaction is lossy, and the loss is now a property of the product rather than
an accident. The note is written by a model, from material a model produced, and
a detail it paraphrases is a detail the next turn no longer has exactly. The
five headings and the instruction to copy numbers, names, dates, quotations and
addresses verbatim are what make this survivable; they are not a formality.

A compacted run costs one extra completion at roughly the size of the window it
was filling. That is real money, and it is spent only by runs that would
otherwise have failed outright and refunded nothing.

The threshold now depends on believing the right window, and on estimating the
right fullness. Both were previously approximate in ways that did not matter and
now do.

The estimator is QuadChars, which runs 10-25% off a real tokenizer, and running
low is the dangerous direction: a card the estimator reads as 68% full while the
model reads it as 85% sails past the threshold and into the refusal this exists
to prevent. OpenRouter reports real usage on every completion, for bytes Eido
has already estimated, so the error is measurable for free. One ratio per model
now corrects every later estimate. Requests carrying an image or a file are not
sampled: the estimator sees a filename and the provider sees a picture, and that
gap is the attachment rather than the tokenizer, so using it would move the
threshold on every later text-only request for a reason unrelated to the text.
The ratio is held in memory only: it is relearned on the first turn of any
session at no cost, whereas a bad one written to the device would keep steering
every future run with nothing to correct it.

The window itself made the model catalog load-bearing for the first time. The per-model window cache had been
read by every budget calculation and written by nothing since it was added; it
is now filled from OpenRouter's published catalog, preferring the serving
provider's limit over the headline one where they disagree, and corrected by any
refusal that states a number.

Two guards now end a loop's tool use, for different reasons, and they must keep
their own words. "Your lookups keep failing" and "there is no room left" are not
the same message, and an answer written under the wrong one would misreport what
went unchecked.

The provider-owned harnesses are untouched. Codex and Claude Code run their own
loops and their own compaction; Eido asserts nothing new over the bridge, which
is the same boundary ADR 0033 drew and ADR 0036 kept.
