// Regenerates the living reference CSS from
// src/ui/tokens.ts — the one token authority that also feeds the app's CSS
// (virtual:eido-design-tokens.css) and the canvas painter palettes.
//
//   node scripts/design/sync-design-reference.mjs           # rewrite in place
//   node scripts/design/sync-design-reference.mjs --check   # CI: fail if stale
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REFERENCE_PATH = 'docs/design/design-system/eido-design-system.html'
const BEGIN_MARKER = '/* == BEGIN GENERATED DESIGN TOKENS (npm run design:sync) == */'
const END_MARKER = '/* == END GENERATED DESIGN TOKENS == */'

async function renderGeneratedTargets(root = process.cwd()) {
  const { renderDesignTokenCss } = await import(
    new URL('src/ui/tokens.ts', `file://${root}/`).href
  )
  const generatedCss = renderDesignTokenCss()
  const referencePath = resolve(root, REFERENCE_PATH)
  const referenceCurrent = readFileSync(referencePath, 'utf8')

  const begin = referenceCurrent.indexOf(BEGIN_MARKER)
  const end = referenceCurrent.indexOf(END_MARKER)
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`${REFERENCE_PATH} is missing its generated-token markers.`)
  }

  const referenceSynced =
    referenceCurrent.slice(0, begin + BEGIN_MARKER.length) +
    '\n' +
    generatedCss +
    referenceCurrent.slice(end)

  return [
    {
      label: REFERENCE_PATH,
      path: referencePath,
      current: referenceCurrent,
      synced: referenceSynced,
    },
  ]
}

export async function renderReference(root = process.cwd()) {
  const [reference] = await renderGeneratedTargets(root)
  return reference
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const check = process.argv.includes('--check')
  const targets = await renderGeneratedTargets()
  for (const { label, path, current, synced } of targets) {
    if (current === synced) {
      console.log(`PASS ${label} tokens match src/ui/tokens.ts`)
    } else if (check) {
      console.error(
        `FAIL ${label} token region is stale against src/ui/tokens.ts.\n` +
          'Run: npm run design:sync',
      )
      process.exitCode = 1
    } else {
      writeFileSync(path, synced)
      console.log(`Synced ${label} from src/ui/tokens.ts`)
    }
  }
}
