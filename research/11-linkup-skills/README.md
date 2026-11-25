# Linkup skills, vendored as reference

`upstream/` holds files copied verbatim from
[LinkupPlatform/skills](https://github.com/LinkupPlatform/skills) at `main`,
fetched 2026-08-18. They are Linkup's own guidance to an agent calling their
API, and they are the best statement of how the endpoints are meant to be
driven that exists anywhere, including their docs site.

They are **reference, not instructions to this repo's agents**. Nothing here is
loaded as a skill. The upstream repo installs via `npx skills add`, which is a
package fetch this repo does not need: what we want is the knowledge, and the
knowledge is prose.

| File | What it is worth reading for |
| --- | --- |
| `linkup-search__SKILL.md` | The three-question chain from a data request to a `depth`. This is the load-bearing idea. |
| `linkup-search__references__LINKUP_AGENT_QUERY_MENTAL_MODEL.md` | The same chain at length: request shape before query text, and when to chain outside Linkup instead of inside it. |
| `linkup-search__references__LINKUP_PROMPT_OPTIMIZER_KNOWLEDGE.md` | The rulebook: templates, filters, LinkedIn wording, and a list of known bad patterns. |
| `linkup-search__references__LINKUP_API_REFERENCE.md` | Endpoints, output types, auth, examples. |
| `linkup-fetch__SKILL.md` | When a known URL beats a search, and why `renderJs` should default on. |
| `linkup-research__SKILL.md` | Mode and reasoning-depth selection, and the polling contract. |
| `linkup-research__references__LINKUP_SPECIALIZED_ENDPOINTS.md` | The full research decision matrix. |

`eido-tool-brief.md` in this folder is what Eido actually ships: the compressed
version of all of the above that travels in the prompt whenever a Card's reach
is on. It is deliberately much shorter, because it is paid for on every request
of every loop iteration, and because most of what is above is advice to a human
writing integration code rather than to a model choosing a call.
