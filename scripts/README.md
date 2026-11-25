# Repository Scripts

| Path | Purpose |
| --- | --- |
| [`ci/`](ci/) | CI policy, budget, and deterministic repository checks. |
| [`design/`](design/) | Design-system sync: regenerates the living reference's token region from `src/ui/tokens.ts` (`npm run design:sync`). |
| [`electron/`](electron/) | Packaged desktop build hooks and native smoke helpers. |
| [`maintenance/`](maintenance/) | Explicit maintenance and migration commands. |
| [`release/`](release/) | Release planning, promotion verification, maintenance checks, and manifest generation (`generate-update-manifest.mjs`). |
| [`release-signing/`](release-signing/) | Platform signing-smoke verification, plus update-manifest signing: `sign-update-manifest.mjs` (CI signing tool, key via environment only) and `generate-update-signing-key.mjs` (founder key ceremony, see `docs/release/update-signing-key-ceremony.md`). |
| [`vite/`](vite/) | Build-time Vite plugins; not browser application modules. |

User-facing commands remain in `package.json`; call scripts through those npm
scripts unless a runbook specifies an exact lower-level invocation.
