# The travelling brief

This is the text that goes into the prompt whenever a Card's reach is on. It is
the shipped artifact of this folder; everything in `upstream/` is the source it
was compressed from.

It is short on purpose. It is re-sent on every request of every loop iteration,
so a paragraph here is a paragraph billed ten times on a run that looks things
up ten times. Everything in it earns its place by changing a call the model
would otherwise get wrong.

What is deliberately **not** here, because a tool description carries it better:
per-parameter defaults, enums, and the shape of one call. The brief carries what
spans the tools.

## The text

> Web lookups here run through Linkup. A Linkup query is an instruction to a
> retrieval system, not a question to a person: say what to find, where, and
> which fields to return, then do the reasoning yourself.
>
> Choose the search depth from the job, not from how important it feels.
> Default to `fast`. Move up only for a reason:
>
> - `fast` for one fact that lives in a snippet. Sub-second, no interpretation.
>   Write it keyword-shaped. It ignores instructions, so never give it steps.
> - `standard` for several independent lookups that can all be planned now.
>   Name the separate facets so they run as separate searches.
> - `deep` when a later step needs an earlier step's result: find a page, then
>   read it; follow a link you have not seen yet; verify a claim across sources
>   you must discover first. Write it as ordered steps.
>
> `standard` cannot discover a URL and then scrape it in the same call. That is
> the most common way to get a thin answer. Use `deep`, or search and then fetch.
>
> When you already have the URL, fetch it rather than searching for it.
>
> Avoid: keyword soup with no named fields; rewording one search several ways
> instead of naming distinct facets; inventing a domain or a URL; asking for a
> whole page when you need three fields.
>
> Every claim you make from a lookup should be traceable to a source you were
> given. If nothing relevant came back, say so rather than filling the gap.

## Why each line is in

| Line | The failure it prevents |
| --- | --- |
| Instruction, not question | Linkup's first-named bad pattern. A question retrieves worse than a plan. |
| Default `fast`, move up for a reason | The founder's requirement, and the reason a run is not slow by default. |
| `fast` ignores instructions | A `fast` call with steps in it silently keyword-matches the steps. |
| `standard` names facets | Without it, `standard` fans out on its own guess instead of the caller's. |
| `deep` is ordered steps | `deep` follows ordering literally; unordered prose wastes its iterations. |
| `standard` cannot chain | Linkup names this first. It fails quietly, which is worse than failing. |
| Fetch a known URL | Cheaper, faster, and more reliable than searching for a page you have. |
| Bad-pattern list | Compressed from the upstream list, keeping only what a model in a loop does. |
| Traceable or say nothing | The epic exists because an answer that cannot show its sources is indistinguishable from one that has none. |

## What this is not

It is not a skill in the `.claude/skills` or `.agents/skills` sense. Nothing
loads it, no agent invokes it. It is product copy that happens to be addressed
to a model, and it lives under `src/` with the rest of the prompt text so it is
reviewed like prose and tested like code.
