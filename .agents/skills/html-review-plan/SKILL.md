---
name: html-review-plan
description: Create or update a detailed, skimmable, standalone HTML review for a completed or ongoing epic, program, major feature, migration, or multi-PR delivery. Use when a founder, product owner, or decision-maker needs an executive summary, measurable and qualitative impact, delivery evidence, plain-language technical teaching, retrospective and collaboration analysis, diagrams, and inline comments that can be saved into the HTML and returned for agent action.
---

# HTML Review Plan

Produce an evidence-backed review that lets a non-specialist understand what changed, why it matters, what remains uncertain, and how delivery can improve. Optimize for two reading modes: five-minute executive scanning and optional technical depth. Adapt the content and emphasis to the delivery under review; the bundled structure is a starting point, not a mandatory outline.

## Workflow

1. Re-derive the source state before writing. Inspect the canonical epic/spec, merged changes, tracker state, CI/release proof, architecture decisions, research, implementation docs, live retro, final retro, and unresolved follow-ups. Never infer completion from stale session memory.
2. Read [references/review-content.md](references/review-content.md) before choosing claims or structure.
3. Create a report from the bundled scaffold:

   ```bash
   python3 scripts/new_review.py \
     --title "<review title>" \
     --epic "<epic or program label>" \
     --source-state "<date, branch, commit, release, or other provenance>" \
     --output "<absolute output path>.html"
   ```

4. Replace every scaffold placeholder with source-grounded content. Reorder or merge sections when that improves comprehension; preserve the review lenses, not a rigid outline.
5. Use these evidence labels consistently:
   - **MEASURED** — directly observed or deterministically calculated, with provenance.
   - **DECIDED** — an approved conclusion based on evidence.
   - **ENABLED** — a capability or implementation path made possible, but not yet realized by users.
   - **EXPECTED** — a future effect with a stated validation gate.
   - **NOT YET PROVEN** — an explicit limitation, never encoded as zero or success.
6. Make the impact chain visible: evidence → decision/delivery change → enabled capability → user/business effect. Separate impact already delivered from impact dependent on future rollout.
7. Teach technical work in plain language without erasing the real contracts, trade-offs, or limitations. Use a small diagram when it explains a dependency, sequence, state transition, architecture, or cost stack more clearly than prose.
8. Keep detail available but subordinate. Put the executive summary and impact first; collapse ledgers, exhaustive PR tables, glossary material, raw CI identities, and forensic retro evidence behind native `<details>` disclosures.
9. Preserve the bundled comment system. Every reviewable section needs a stable `id`, `data-review-anchor`, and `data-anchor-label`. Read [references/comment-protocol.md](references/comment-protocol.md) before changing or consuming comments.
10. When browser tooling is available, run one proportional interaction pass: desktop width, mobile reflow, highlight → **Comment here** → add/edit/resolve/delete, save commented HTML, reopen the returned file, and confirm no console errors. Do not turn report QA into a CPU-heavy test program.
11. Deliver the standalone file and explain the return loop in one sentence: highlight wording or use a section button, add comments, press **Save commented HTML**, then return that saved file.

## Non-negotiable review truths

- Lead with the outcome, impact, and boundary between shipped value and future value.
- Distinguish product impact from delivery/process impact.
- Include quantitative measures when defensible and qualitative improvements when they are the honest evidence.
- State what was intentionally not done and what remains risky.
- Explain owner or leadership interventions candidly: what they improved, what they disrupted, and how timing or framing could improve next time.
- Make agent/team accountability explicit; do not attribute every delay to tools or the owner.
- Preserve accessibility, search, copy, security, storage, compatibility, and rollout limitations as measured risks rather than silent sacrifices.
- Use synthetic/privacy-safe evidence unless real data access is separately authorized.
- Keep the report full-width on desktop, responsive to 320px, keyboard accessible, theme-aware, and standalone.

## Returned commented reports

Extract machine-readable comments with:

```bash
python3 scripts/extract_comments.py "<returned commented report>.html" --format markdown
```

Treat every open comment whose `authorRole` is `FOUNDER_REVIEW_COMMENT` and `requiresAgentResponse` is `true` as an item to address. Respond comment-by-comment with disposition: answered, changed, declined with reason, or requires decision. Preserve comment IDs when producing a revised report.

## Bundled resources

- `assets/report-template.html` — standalone shell.
- `assets/content-scaffold.html` — adaptable decision-maker review structure.
- `assets/report.css` — full-width responsive presentation.
- `assets/comment-system.js` — inline selection and section comment engine.
- `scripts/new_review.py` — deterministic scaffold generator.
- `scripts/extract_comments.py` — returned-comment extractor.
