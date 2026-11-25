# Coding-agent and README audit

Updated 2026-09-05 after the owner's simplification request.

## Current configuration

The internal project configuration selects GPT-6 Astra with low
reasoning effort. Agent role selection belongs to the `session-control` skill;
the duplicate repository routing policy and references to that file were removed.
Research fanout now distinguishes managed role assignments from its standalone
worker settings. This does not change Eido's in-app AI defaults or a running
coding task's model selection.

## Instruction cleanup

[AGENTS.md](../../AGENTS.md) is empty. The Working agreement, Product boundaries,
and entire Agent Skill Guide were deleted, including the skill-selection table,
sequences, and responsibility descriptions. The remaining Agent CLI and evidence
sections moved to [docs/README.md](../README.md). The introduction's active-app
location was already covered by the root README. Tracker, triage, and glossary
links remain available through the existing documentation indexes.

The previous audit's skill edits remain where the owner has retained those
files. Skill files deleted separately in the workspace were not restored.
No personal skills or external orchestration settings were changed.

## Root README findings resolved

| Finding | Correction | Evidence |
| --- | --- | --- |
| Listed the retired Gemini CLI provider. | Lists Claude Code, Codex, and Google Antigravity. | Integration guide's local AI section; current Settings wording in `src/shared/words.ts`. |
| Implied every provider model list travels with an Idea. | Distinguishes local-provider choices from the device-local OpenRouter catalog. | `codebase/INTEGRATIONS.md`, Local AI Harnesses. |
| Said release signing and updating were unfinished. | Links the active publication and certification runbook; keeps local smoke packages non-publishable. | `desktop-release-captain.md`; `.github/workflows/packaged-certification.yml`. |
| Claimed a roughly 35-second check catches nearly everything required CI catches. | Names what the local check covers and explains CI's additional checks without a timing guarantee. | `package.json`; `scripts/ci/required.mjs`. |
| Directed browser development to plain `npm run dev`, which can use an existing save. | Provides unique disposable data-file examples for POSIX and PowerShell. | `scripts/vite/storagePlugin.ts` selects `EIDO_DATA_FILE` or its legacy default. |
| Put extensive packaged-proof internals in the startup guide. | Links the testing and release runbooks. | Existing owned documentation. |
| Omitted UI, persistence, the control-plane backend, and the public site from the layout. | Adds those directories and corrects token ownership. | Repository directories; `package.json`; `codebase/STRUCTURE.md`. |
| Used plain-code paths for navigation. | Makes the documentation and layout links clickable. | Local link check. |

## Verification and limits

The project TOML, changed Markdown links, documented npm commands and layout
paths, research skill metadata, and whitespace diff were checked. The removed
policy filename has no remaining references in repository files, including the
two historical records that named its path. Their historical findings remain.

The audit used source, manifests, and current runbooks. It did not start Eido,
read a real Profile, run application tests, contact AI providers, or verify a
live release. The PowerShell example was inspected but not executed on this
macOS host. Detailed integration and release documents may contain independent
drift; they were read for the README's claims, not exhaustively re-audited.

The initial migration used the [official Astra guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)
and [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
The supplied X post was unavailable and did not support any findings.
