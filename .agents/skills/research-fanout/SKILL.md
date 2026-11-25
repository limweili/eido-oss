---
name: research-fanout
description: Fan out a substantial research question across cost-conscious Luna subagents, then synthesize an evidence-grounded visual teaching report. Use for substantial parallel research and a visual teaching report with a configured coordinator and bounded research workers; not for single-source lookups or implementation.
---

# Research fanout

Run a hub-and-spoke investigation: the main task owns scope, lane design,
integration, and delivery; subagents own bounded evidence legwork. Token scarcity
is an operating constraint, so every lane must earn its cost and produce a
durable artifact that the coordinator can synthesize without repeating the
research.

## Lock the model topology

Use the current session as coordinator. The `session-control` skill owns
model selection when this research is part of a managed session. Otherwise,
use the standalone worker bindings below. All fixed worker settings in this
skill describe that standalone mode; managed sessions use their approved role
assignments. Honor explicit user model choices;
a default-model upgrade does not require restarting the coordinator.

For standalone research, spawn every subagent, including any reviewer, with:

```text
model: gpt-5.6-luna
reasoning_effort: xhigh
fork_turns: none
```

`fork_turns: none` is deliberate: full-history forks inherit the coordinator
model and cannot accept the Luna override. Put all necessary context in each
task brief. Tell every subagent not to spawn children. Use the same worker settings for follow-ups; a managed session follows its
approved role assignments.

Use this exact spawn shape, varying only the task name and brief:

```text
spawn_agent({
  task_name: "<bounded-lane>",
  fork_turns: "none",
  model: "gpt-5.6-luna",
  reasoning_effort: "xhigh",
  message: "<self-contained lane brief>"
})
```

## Establish the research boundary

Inspect the repository's research convention, then create one new,
topic-specific folder using its next unused numeric prefix, for example
`research/16-provider-routing/`. The coordinator owns shared files. Create a
`README.md` with the question and `Status: active`, then record in
`00-goal-and-lanes.md`:

- the decision or learning outcome the research must support;
- scope, exclusions, and freshness requirements;
- the evidence standard and primary artifacts already available;
- the lane map, file ownership, and why each lane is independent;
- known token constraints and the stopping rule.

Do not modify production code as part of the research. Recommendations may name
future changes, but implementation or ticket publication requires separate user
authority. Do not invoke paid external AI APIs or harnesses merely to gather
evidence unless the user separately authorizes that expense; prefer source,
installed-artifact inspection, and provided research tools.

Complete this phase when the folder and active README exist, the question can be
answered from the planned lanes, and no two agents own the same output file.

## Design a lean fanout

Start with the fewest independent lanes that cover the question. Three to five
researchers is the normal range; add a sixth only for a named evidence gap.
Reserve an adversarial synthesis reviewer for consequential architecture or
product conclusions. Do not fill concurrency slots merely because they exist.

Prefer orthogonal lanes such as:

- source architecture and provider adapters;
- installation, discovery, authentication, and environment behavior;
- request routing, session lifecycle, streaming, cancellation, and recovery;
- failure modes, tests, observability, and security boundaries;
- the local product's corresponding architecture and gaps;
- upstream harness contracts or time-sensitive external facts.

Collapse lanes when the source set is small. Split one only when its artifacts,
skills, or evidence sources are genuinely different.

Complete this phase when every material question has one owner and removing any
lane would leave a named gap.

## Brief every Luna agent completely

Spawn lanes in parallel with `gpt-5.6-luna`, `xhigh`, and `fork_turns: none`.
Each brief must include:

```text
You own one bounded research lane. Do not spawn subagents.

Question:
<one falsifiable lane question>

Scope and sources:
<specific repositories, installed artifacts, official docs, or APIs>

Output:
Write only <research-folder>/<owned-file>.md.
Include: scope inspected, source-grounded findings, mechanism, uncertainties,
failure cases, implications for the parent question, and precise citations or
file/line evidence. Distinguish fact, inference, and recommendation.

Cost boundary:
Avoid broad background explanation and duplicated context. Prefer primary
sources. Produce a dense note, normally 800-1,500 words plus citations. Stop
when the lane question is answered or a concrete blocker is proven.

Coordination:
Do not edit shared indexes, synthesis, or report files. Preserve unrelated
worktree changes. Send the coordinator a concise completion message naming the
artifact and any unresolved high-impact gap.
```

For time-sensitive or web research, require authoritative first-party sources
and dates. For local architecture research, require exact paths and line-level
or symbol-level evidence. For installed-app forensics, require a clear boundary
between observed behavior and inference.

Complete this phase when all lane tasks are running with the exact model
settings and each has a disjoint output contract.

## Orchestrate without duplicating legwork

While agents work, the coordinator may inspect repository topology, maintain
the goal file, and prepare the synthesis frame. Do not redo a lane's deep
reading. Use long waits rather than repeated polling.

As results arrive:

1. Read each artifact and map its claims back to the parent question.
2. Reconcile contradictions against primary evidence.
3. Send a targeted Luna/xhigh follow-up to the owning agent when one material
   gap remains; do not restart the whole lane.
4. Spawn a new lane only when synthesis discovers a question no existing lane
   can answer.

Default to one follow-up per lane. Exceed that only when the unresolved point
could reverse a recommendation. The coordinator owns integration judgments;
subagent consensus is evidence, not authority.

Complete this phase when every consequential synthesis claim is supported,
qualified, or visibly marked unknown.

## Synthesize and challenge

Write a concise synthesis in the research folder. Preserve source notes as the
audit trail rather than copying all their prose. Explain:

- the governing mental model;
- how the system works end to end;
- what the comparison teaches the local product;
- which patterns transfer, which do not, and why;
- recommended next moves ordered by leverage and reversibility;
- evidence limits and open questions.

For consequential conclusions, spawn one final `gpt-5.6-luna`/`xhigh` reviewer
with only the goal, lane artifacts, and draft synthesis. Ask it to identify
unsupported claims, missing alternatives, false equivalences, and costly
recommendations. It must write a separate review note and must not rewrite the
synthesis. Resolve the review in the coordinator task.

Complete this phase when the synthesis survives the evidence audit and any
adversarial findings are resolved or retained as visible limits.

## Teach with `explain-work-visually`

Invoke `$explain-work-visually` for the final deliverable and follow that skill's
canonical template, evidence, salience, chassis, runtime, and rendered-review
contracts. Save the self-contained HTML report inside the new research folder.

Make the explanation visual-first without decorative padding. Most substantive
sections should use an evidence-grounded diagram, flow map, comparison,
annotated screenshot, or other visual form when it materially shortens the
explanation. Use a simple analogy and plain-language layer first, then provide
the rigorous evidence path underneath. Define unavoidable jargon, keep one
idea per diagram, and give every visual a text alternative reaching the same
conclusion. “ELI5” means accessible, not imprecise.

Update the folder `README.md` and the repository research index when its
convention requires one. Deliver links to the HTML report and synthesis, plus a
short statement of the main learning, the strongest recommendation, and the
largest remaining uncertainty.

Completion means the new research folder contains the goal and lane map,
source-grounded lane notes, resolved adversarial review when warranted,
synthesis, and a validated annotatable visual report; the main task used the configured coordinator,
every subagent used the research worker tier, and no production implementation was smuggled
into the research session.
