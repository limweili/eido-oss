# Backlog triage — turn a queue into decisions

Triage every open change against current intent, source, dependencies, review,
and required proof. Give each item one disposition:

- **Ready:** sound and currently provable; place in dependency order.
- **Repairable:** valuable, with a bounded mechanical or implementation fix.
- **Superseded:** another landed or stronger change covers it; salvage unique
  value before closure.
- **Reframe:** the intent remains valuable but the implementation is no longer
  an efficient path; preserve the lesson and create a replacement outcome.
- **Decision needed:** product, safety, or cost ambiguity prevents a responsible
  disposition.

Classify landing risk from consequence, shared fan-out, reversibility, data
exposure, and deployment impact. Use risk to choose review and proof depth, not
to create fixed ceremony.

Do not delete branches, workspaces, or artifacts during triage. Closure and
resource destruction are separate decisions with their own live-state checks.

Triage is complete when every open item has one evidence-backed disposition,
the landing order reflects real dependencies, and the owner sees only the
decisions that require owner judgment.
