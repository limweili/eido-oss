# Human interface — preserve owner attention

Give the owner outcomes and decisions, not coordination chores.

## Status

Use [../assets/scoreboard-template.md](../assets/scoreboard-template.md) when a
table helps. Lead with:

- what outcome has changed;
- what is active or blocked and why;
- the evidence boundary;
- what happens next without owner input;
- the rough remaining distance when it can be estimated honestly.

Regular concise updates make infrastructure silence distinguishable from
progress. A status request triggers a fresh audit of live work before reply.

## Escalation

Escalate only decisions the owner is uniquely positioned to make: product
behavior or taste, architecture meaning, real-data exposure, security posture,
irreversible loss, materially increased cost, or evidence-backed review
deadlock. State the observed facts, options, and recommendation first.

Resolve implementation mechanics, ordinary conflicts, stale state, retries,
and coordination replacement without asking the owner to relay technical
messages or inspect diffs.

## Blocker logging

When work hits a blocker that only the owner can resolve (credentials, external
setup, product taste, permissions, manual environment steps):

1. **Comment on the GitHub issue immediately.** Each comment should state:
   - what is blocked and in which lane/slice;
   - why it requires the owner (not something the agent can resolve);
   - recommended action or options if known.
2. **Continue working.** Skip or stub the blocked area; do not pause the run.
3. **Report at completion.** Collect all owner-dependent blocker comments from
   the issue(s) and present them as a single consolidated checklist so the
   owner can resolve everything in one session without losing track.
