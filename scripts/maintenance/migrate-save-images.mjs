#!/usr/bin/env node
// Lane E of #247 (#283): opt-in recompression of legacy image assets in an
// existing Eido save through the same pipeline that gates newly pasted images
// (src/shared/imageCompression.ts). This script is the only surface — it never
// runs automatically, and without --apply it is a read-only preflight.
//
// Safety discipline for this legacy browser-JSON maintenance command:
//   - dry-run by default; --apply is required for any mutation
//   - a sha256-verified full backup is written before the first write; the
//     migration aborts if the backup cannot be created and verified
//   - the backup is never deleted by tooling
//   - the rewritten save is verified (parse + structure + never-drop) in a
//     temp file before it atomically replaces the original
//
// The compression pipeline needs real canvas APIs, so --apply bundles
// src/shared/imageCompression.ts with vite and runs compressImage inside a
// headless Chromium page (Playwright). Tests inject a deterministic
// implementation via --compress-module instead of launching a browser.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_SAVE = path.join(os.homedir(), '.eido', 'eido-v3-ideas.json')

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return 0
  }

  const saveFile = path.resolve(args.file ?? process.env.EIDO_DATA_FILE ?? DEFAULT_SAVE)
  if (!existsSync(saveFile)) throw new Error(`Save file does not exist: ${saveFile}`)
  if (isInside(saveFile, findRepoRoot())) {
    throw new Error(`Refusing to touch private Eido data inside the git repo: ${saveFile}`)
  }

  const rawBytes = await fsp.readFile(saveFile)
  const store = parseStore(rawBytes, saveFile)

  if (existsSync(`${saveFile}.boards`)) {
    console.warn(`Warning: sidecar board files in ${saveFile}.boards are NOT migrated by this script.`)
  }

  const core = await loadCoreBundle()
  const plan = core.planImageMigration(store)
  console.log(core.formatMigrationPlan(plan))
  console.log(`Save file: ${saveFile}`)

  if (!args.apply) {
    console.log('\nDry run: nothing was written. Re-run with --apply to migrate (close Eido first).')
    return 0
  }

  if (plan.overBudgetAssetCount === 0) {
    console.log('\nAlready compliant: no assets to migrate, nothing written.')
    return 0
  }

  const provider = args.compressModule
    ? await loadCompressModule(args.compressModule)
    : await makeBrowserCompressProvider()

  let migrated
  let report
  try {
    // Compression happens purely in memory; the save file is not touched yet.
    ;({ save: migrated, report } = await core.migrateSaveImages(store, {
      compress: provider.compress,
      now: () => new Date().toISOString(),
    }))
  } finally {
    await provider.close?.()
  }

  console.log(`\n${core.formatMigrationReport(report)}`)

  if (!report.changed) {
    console.log('\nNo asset could be improved; nothing written, no backup needed.')
    return 0
  }

  // Mandatory verified backup before the save file is mutated.
  const backupFile = await writeVerifiedBackup(saveFile, rawBytes, args.backupDir)
  console.log(`\nVerified backup: ${backupFile}`)

  await writeStoreVerified(saveFile, rawBytes, store, migrated)
  console.log(`Migrated save written: ${saveFile}`)
  console.log(`Backup kept (never deleted by tooling): ${backupFile}`)
  return 0
}

// ---- CLI plumbing -----------------------------------------------------------

function parseArgs(argv) {
  const parsed = { apply: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--file') parsed.file = expectValue(argv, index++, arg)
    else if (arg === '--backup-dir') parsed.backupDir = expectValue(argv, index++, arg)
    else if (arg === '--compress-module') parsed.compressModule = expectValue(argv, index++, arg)
    else if (arg === '--apply') parsed.apply = true
    else if (arg === '--dry-run') parsed.apply = false
    else if (arg === '--help' || arg === '-h') parsed.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return parsed
}

function expectValue(argv, index, name) {
  const value = argv[index + 1]
  if (!value) throw new Error(`${name} needs a value`)
  return value
}

function printHelp() {
  console.log(`Usage: npm run migrate:images -- [--file PATH] [--apply] [--backup-dir DIR]

Recompresses legacy over-budget image assets in an Eido save through the
paste-image compression pipeline. Read-only preflight by default.

  --file PATH         save to migrate (default: EIDO_DATA_FILE or ${DEFAULT_SAVE})
  --dry-run           preflight report only (this is already the default)
  --apply             write a verified backup, migrate, and rewrite the save
  --backup-dir DIR    where the backup goes (default: alongside the save)
  --compress-module   test seam: node module exporting compress(file) used
                      instead of the real headless-browser pipeline

Close Eido (dev server/app) before running with --apply.`)
}

function parseStore(rawBytes, saveFile) {
  let store
  try {
    store = JSON.parse(rawBytes.toString('utf8'))
  } catch (error) {
    throw new Error(`Save file is not valid JSON: ${saveFile} (${error.message})`)
  }
  if (!store || typeof store !== 'object') throw new Error('Save file is not a JSON object.')
  if (store.version !== 1) throw new Error(`Unsupported save version ${String(store.version)}; expected 1.`)
  if (!Array.isArray(store.ideas)) throw new Error('Save file has no ideas array.')
  if (!store.boards || typeof store.boards !== 'object') throw new Error('Save file has no boards object.')
  return store
}

// ---- Backup -----------------------------------------------------------------

async function writeVerifiedBackup(saveFile, rawBytes, backupDir) {
  const dir = backupDir ? path.resolve(backupDir) : path.dirname(saveFile)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = path.join(dir, `${path.basename(saveFile)}.image-migration-backup.${stamp}.json`)
  try {
    await fsp.mkdir(dir, { recursive: true })
    if (existsSync(backupFile)) throw new Error(`backup already exists: ${backupFile}`)
    // Write the exact bytes we read (and will migrate), not a fresh copy of a
    // file that could have changed underneath us.
    await fsp.writeFile(backupFile, rawBytes, { flag: 'wx' })
    const reread = await fsp.readFile(backupFile)
    if (reread.length !== rawBytes.length || sha256(reread) !== sha256(rawBytes)) {
      throw new Error(`backup does not match the save after re-reading: ${backupFile}`)
    }
  } catch (error) {
    throw new Error(
      `Backup could not be created and verified — aborting before any migration. ${error.message}`,
    )
  }
  return backupFile
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

// ---- Verified atomic write ---------------------------------------------------

async function writeStoreVerified(saveFile, originalRawBytes, originalStore, migratedStore) {
  // Match the browser-development storage plugin's serialization so a migrated save
  // diffs cleanly against app-written saves.
  const serialized = `${JSON.stringify(migratedStore, null, 2)}\n`
  const tempFile = `${saveFile}.${process.pid}.${Date.now()}.image-migration.tmp`
  await fsp.writeFile(tempFile, serialized, 'utf8')
  try {
    const reread = JSON.parse(await fsp.readFile(tempFile, 'utf8'))
    assertNothingDropped(originalStore, reread)
    const current = await fsp.readFile(saveFile)
    if (sha256(current) !== sha256(originalRawBytes)) {
      throw new Error('save file changed on disk while migrating (is Eido running?)')
    }
    await fsp.rename(tempFile, saveFile)
  } catch (error) {
    await fsp.rm(tempFile, { force: true })
    throw new Error(`Migrated save failed verification; original left untouched. ${error.message}`)
  }
}

// The file-level never-drop check: every idea, board, card, and asset that
// existed before the migration must still exist after it.
function assertNothingDropped(before, after) {
  if (after.ideas.length !== before.ideas.length) {
    throw new Error(`idea count changed: ${before.ideas.length} → ${after.ideas.length}`)
  }
  const beforeBoards = Object.keys(before.boards)
  for (const boardId of beforeBoards) {
    const beforeBoard = before.boards[boardId]
    const afterBoard = after.boards[boardId]
    if (!afterBoard) throw new Error(`board ${boardId} missing after migration`)
    if (afterBoard.cards.length !== beforeBoard.cards.length) {
      throw new Error(`board ${boardId} card count changed`)
    }
    const afterAssetIds = new Set(
      afterBoard.cards.flatMap((card) => (card.assets ?? []).map((asset) => asset.id)),
    )
    for (const card of beforeBoard.cards) {
      for (const asset of card.assets ?? []) {
        if (!afterAssetIds.has(asset.id)) {
          throw new Error(`asset ${asset.id} (${asset.name}) missing after migration`)
        }
      }
    }
  }
}

// ---- Loading the TypeScript core in node -------------------------------------

async function loadCoreBundle() {
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'eido-image-migration-core-'))
  await viteBuild({
    entry: path.join(repoRoot, 'src/maintenance/imageMigration.ts'),
    formats: ['es'],
    fileName: 'imageMigration.mjs',
    outDir,
  })
  return import(pathToFileURL(path.join(outDir, 'imageMigration.mjs')).href)
}

async function viteBuild({ entry, formats, fileName, name, outDir }) {
  const { build } = await import('vite')
  await build({
    configFile: false,
    root: repoRoot,
    logLevel: 'error',
    build: {
      lib: { entry, formats, name, fileName: () => fileName },
      outDir,
      emptyOutDir: true,
      minify: false,
      target: 'esnext',
    },
  })
}

// ---- Compression providers ----------------------------------------------------

async function loadCompressModule(modulePath) {
  const mod = await import(pathToFileURL(path.resolve(modulePath)).href)
  if (typeof mod.compress !== 'function') {
    throw new Error(`--compress-module ${modulePath} does not export a compress(file) function`)
  }
  return { compress: mod.compress, close: mod.close }
}

// Runs the real pipeline — compressImage with the browser codec — inside a
// headless Chromium page, one asset at a time so memory stays bounded.
async function makeBrowserCompressProvider() {
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'eido-image-migration-browser-'))
  await viteBuild({
    entry: path.join(repoRoot, 'src/shared/imageCompression.ts'),
    formats: ['iife'],
    name: 'EidoImageCompression',
    fileName: 'imageCompression.iife.js',
    outDir,
  })

  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('about:blank')
  await page.addScriptTag({ path: path.join(outDir, 'imageCompression.iife.js') })

  const compress = async (file) => {
    const payload = {
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
      name: file.name,
      type: file.type,
    }
    const result = await page.evaluate(async ({ base64, name, type }) => {
      try {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        const compressed = await window.EidoImageCompression.compressImage(
          new File([bytes], name, { type }),
        )
        return { ok: true, compressed }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }, payload)
    if (!result.ok) throw new Error(result.message)
    return result.compressed
  }

  return { compress, close: () => browser.close() }
}

// ---- Repo guard ---------------------------------------------------------------

function findRepoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return repoRoot
  }
}

function isInside(file, root) {
  if (!root) return false
  const relative = path.relative(root, file)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}
