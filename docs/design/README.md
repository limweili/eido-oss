# Design Documentation

The approved design system is the authority for rendered UI. The remaining
folders preserve the prototypes, explorations, and reference material that
informed it.

| Path | Status | Purpose |
| --- | --- | --- |
| [`design-system/`](design-system/) | Current and authoritative | The whole canon: rule book, living reference rendering, approved function changes, implementation notes, and design brief. Start at its [`README.md`](design-system/README.md). |
| [`mods/`](mods/) | Supporting design records | Mod prompt mechanics, engine boundary, and the redesign session record. |
| [`explorations/`](explorations/) | Point-in-time exploration | Round-by-round Mod design investigations and syntheses. |
| [`prototypes/`](prototypes/) | Historical prototypes | Standalone interaction studies preserved for archaeology; nothing here is authoritative. |
| [`references/`](references/) | Source material | Visual references and their provenance. |

New production UI must follow `design-system/SYSTEM.md` and use named tokens
and roles. Token values have one machine source of truth, `src/ui/tokens.ts`
(see `design-system/README.md` for how changes propagate). Do not promote an
exploration or historical prototype to product authority without updating the
design system.
