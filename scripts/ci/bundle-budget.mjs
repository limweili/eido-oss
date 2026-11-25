import { readdir, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const assetsDirectory = path.resolve('dist/assets')
// This guard catches a disaster, not drift.
//
// Its own history is the argument. Ten commits have ever touched this file:
// nine raised the ceiling so the feature that tripped it could pass, and none
// ever made the bundle smaller. A limit that has only ever been paid, never
// enforced, is not a gate. It is a toll on whoever happens to arrive when the
// number runs out, and the last arrivals paid it for wording changes.
//
// The old reasoning was that gzip is what ships over the wire. That is not true
// of this product. Eido ships as a signed DMG and EXE; R2 hosts the installers,
// and this JavaScript is read from local disk inside the packaged app. None of
// it is ever transferred. What size actually costs a person here is startup
// parse and execute, where the distance between 505 and 511 KiB is far below
// anything anyone can perceive. Blocking a merge over 0.04% of that measured a
// number nobody feels, at a precision the number cannot support.
//
// It could not support it literally. Exact bdacbf79 measures 509.8 KiB gzip in
// CI and 527.3 KiB from a local production build of the same commit, because
// the bundler splits chunks differently between installs. The old 511 KiB
// ceiling left 1.2 KiB of headroom against a figure that moves 17.5 KiB with
// the machine reading it, so it answered a question about the build host and
// reported the answer as a verdict on the code.
//
// The thresholds below sit where crossing one means something really went
// wrong: code splitting collapsed and the app ships as a single monolith that
// delays first paint, or a heavy dependency was admitted by accident.
// Everything under them passes and is still printed per chunk, so growth stays
// attributable to anyone reading the log or bisecting later. That trade is
// deliberate: this must fire rarely enough to be believed and investigated when
// it does, instead of raised. If it fires, find the cause. Do not move the
// number.
//
// Measured on exact main at bdacbf79 (2026-08-20) in CI: 509.8 KiB total gzip,
// 801.0 KiB raw in the largest chunk. Collapsing the split would put roughly
// 1,600 KiB raw into one chunk, which 1,100 catches well before it ships.
//
// Superseded rationale, kept only as the record of what was measured when:
// On 2026-07-23, exact main measured 460.0 KiB total
// gzip and the integrated #711 production bundle measured 471.8 KiB. The
// 11.8 KiB delta is the required Agent run, live-authority, and mutation-barrier
// runtime rather than an accidental vendor or editor dependency; 478 KiB keeps
// the audited ~1.3% ceiling. The 2026-07-29 Result follow-up refinement measured
// 478.1 KiB after adding immediate shared-tooltip confirmation and continuous
// streaming draft input. The 2026-08-05 v5 release line measured 482.4 KiB
// against exact main at 478.2 KiB; module attribution places the 4.2 KiB delta
// in the expanded v5 Agent command contracts, delegated-run/session handling,
// and renderer authority rather than vendor/editor drift. Historical main at
// 1e8fd139 measured
// 484.2 KiB on 2026-08-14. The reviewed local AI provider feature measures
// 487.1 KiB; its 2.9 KiB delta is the provider router, per-provider model state, minimal
// Settings controls, error/cancellation mapping, and persisted run provenance.
// 488 KiB leaves about 0.9 KiB of headroom without admitting any harness CLI or
// main-process child-process implementation into the renderer bundle. The
// 2026-08-18 Title card type fit measures 488.5 KiB against exact main at
// 487.1 KiB; the 1.4 KiB delta is the shared fit rule, the editor's refit hook,
// and the canvas text painter that replaces the kind's low-detail stand-in, all
// of it board rendering rather than a new dependency. Exact main at 8352bb65
// measured 487.1 KiB on 2026-08-17. Agentic Runs measure 490.5 KiB;
// the 3.4 KiB delta is the Agent toggle and its per-provider reach routing, the
// OpenRouter server-tool declaration and citation reader, the tool trail on the
// Result Card, and pasted-address page reads, net of the deleted Web panel and
// search client. 491 KiB was deliberately tight, and the Linkup epic is the
// change that had to say why. It spends renderer weight in four places, all of
// which land inside one ceiling move rather than four: the Linkup boundary
// (search, page fetch, and the failure mapping), the tool loop in the
// OpenRouter boundary, the depth menu on the Ask AI Card, and the second key
// field in Settings. 497 KiB is a 6 KiB allowance against a branch measuring
// 490.7, chosen so four parallel lanes do not each fail on the headroom the
// first one spent. It is not a new floor: the vendor SDK is still refused in
// favour of plain fetch, and no main-process dependency is admitted here.
// That 497 was spent to the byte: the integrated epic measures 497.0 KiB, nine
// bytes clear, which is a gate that fails the next lane for existing. The
// pivot is what spent it, and spent it on things that had to exist: the model
// now chooses depth and parameters per call, so the tool declarations carry
// their own selection rules, and a brief travels in the prompt teaching the
// rules that span them. Both are strings, and strings are most of what a
// renderer bundle weighs. Three lanes are still to land against it: the
// research executor and its polling, the thinking rows and the expandable
// trail they need, and the words that say which reach a Card is on. 503 KiB is
// a 6 KiB allowance against that measured 497.0, sized the same way and for
// the same reason as the 497 was: so parallel lanes do not each fail on
// headroom the first one spent. The refusals behind it are unchanged, the
// vendor SDK is still declined in favour of plain fetch, and no main-process
// dependency is admitted here.
// Recalibrate only from a measured main baseline and a documented product reason.
// 2026-08-18: the two guards stopped running out together. The three lanes the
// 503 KiB allowance was sized for landed, plus Board Info's wire record, and
// the branch measures 499.6 KiB total gzip with 3.4 KiB still to spend, while
// its one big chunk measures 772.6 KiB raw and has none. The 770 was set on a
// roughly 3:1 raw-to-gzip assumption; this chunk now measures 3.29:1, because
// what these lanes added is mostly prose and repeated identifiers, which gzip
// takes better than the average of what came before. 784 KiB is that ratio
// applied to the gzip that is actually left (3.4 x 3.29, about 11 KiB), so the
// single-chunk guard once again expires with the total rather than ahead of
// it. The total gzip budget stays the binding constraint, and the refusals
// behind both are unchanged.
// 2026-08-18, integrating main: the epic and main's Title card type fit meet
// here, and neither budget was set knowing about the other. Main raised the
// total to 489 KiB for its own 1.4 KiB of board rendering; the epic raised it
// to 503 for its own lanes. Together the merged branch measures 503.1 KiB
// total gzip, one tenth of a KiB over a ceiling that no longer describes what
// is in the bundle, and 780.1 KiB raw in its one big chunk. 505 KiB is the
// sum stated honestly, with roughly 2 KiB of headroom; 787 KiB keeps the
// single-chunk guard expiring with it at the 3.29:1 ratio this chunk
// measures. Nothing new is admitted: no vendor SDK, no main-process
// dependency, no editor drift.
// 2026-08-19: automatic context compaction (#1036). Exact main at 8f36e7d7
// measures 504.0 KiB total gzip and 783.2 KiB raw in its one big chunk, so the
// 505 was already spent to within 1 KiB before this branch touched it. The
// branch measures 509.0 KiB gzip and 797.9 KiB raw. The 5.0 KiB delta is
// renderer text and renderer logic in equal measure, and all of it had to
// exist: the two compaction seams (a Result Card's discussion and the agentic
// tool loop) with their planning and re-assembly, the summariser system
// prompts and the four-heading instruction they carry, the phrase tables that
// tell a length refusal apart from every other 400 and read the limit out of
// its prose, the per-model window cache and its corrections, and the estimator
// calibration. Prompts are strings, and strings are most of what a renderer
// bundle weighs. 511 KiB is that measurement stated honestly with roughly
// 2 KiB of headroom; 804 KiB keeps the single-chunk guard expiring with it at
// the 3.28:1 raw-to-gzip ratio this chunk now measures. Nothing new is
// admitted: no vendor SDK, no tokenizer library (the estimator still corrects
// QuadChars from what the provider reports), and no main-process dependency.
const maximumSingleJavaScriptBytes = 1_100 * 1024
const maximumTotalGzipJavaScriptBytes = 700 * 1024

let assetNames
try {
  assetNames = await readdir(assetsDirectory)
} catch {
  console.error('Bundle budget cannot run: dist/assets is missing. Run npm run build first.')
  process.exit(1)
}

const javaScriptNames = assetNames.filter((name) => name.endsWith('.js')).sort()
if (javaScriptNames.length === 0) {
  console.error('Bundle budget cannot run: dist/assets contains no JavaScript bundles.')
  process.exit(1)
}

const bundles = await Promise.all(
  javaScriptNames.map(async (name) => {
    const contents = await readFile(path.join(assetsDirectory, name))
    return { name, rawBytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength }
  }),
)

const totalGzipBytes = bundles.reduce((sum, bundle) => sum + bundle.gzipBytes, 0)
const oversizedBundles = bundles.filter((bundle) => bundle.rawBytes > maximumSingleJavaScriptBytes)

for (const bundle of bundles) {
  console.log(
    `${bundle.name}: ${(bundle.rawBytes / 1024).toFixed(1)} KiB raw, ${(bundle.gzipBytes / 1024).toFixed(1)} KiB gzip`,
  )
}
console.log(
  `JavaScript total: ${(totalGzipBytes / 1024).toFixed(1)} KiB gzip / ${maximumTotalGzipJavaScriptBytes / 1024} KiB budget`,
)

if (oversizedBundles.length > 0 || totalGzipBytes > maximumTotalGzipJavaScriptBytes) {
  for (const bundle of oversizedBundles) {
    console.error(
      `${bundle.name} exceeds the ${(maximumSingleJavaScriptBytes / 1024).toFixed(0)} KiB single-bundle budget.`,
    )
  }
  if (totalGzipBytes > maximumTotalGzipJavaScriptBytes) {
    console.error('The total gzipped JavaScript bundle exceeds its budget.')
  }
  // The ceilings carry enough head room that ordinary growth never reaches
  // them, so arriving here means a dependency or a chunking change, not a
  // feature. Say so at the point of failure, because the file comment saying
  // it is not what the person staring at a red gate is reading.
  console.error(
    'These limits are set to catch an accidental heavy dependency or collapsed code splitting, not normal growth. Find what was added. Raising the number is the wrong fix.',
  )
  process.exit(1)
}
