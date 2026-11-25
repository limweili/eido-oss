// End-to-end tests for scripts/maintenance/migrate-save-images.mjs on synthetic fixture
// saves in temp directories (never real user data). The
// browser compression step is replaced with the deterministic
// fixtures/fakeCompress.mjs via the script's --compress-module seam, so these
// run headless and deterministic in CI; pipeline policy behavior is covered by
// imageMigration.test.ts and imageCompression.test.ts.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { IdeaStore } from '../graph/storageMerge'
import {
  boardWithCards,
  cardWithAssets,
  fileAsset,
  imageAsset,
  storeWithBoards,
} from './imageMigrationFixtures'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const scriptPath = join(repoRoot, 'scripts', 'maintenance', 'migrate-save-images.mjs')
const fakeCompressPath = join(repoRoot, 'src', 'maintenance', 'fixtures', 'fakeCompress.mjs')

const BUDGET = 200 * 1024
const CLI_TIMEOUT = 120_000

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeSaveDir(store: IdeaStore): Promise<{ dir: string; saveFile: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'eido-migrate-cli-'))
  tempDirs.push(dir)
  const saveFile = join(dir, 'fixture-save.json')
  await writeFile(saveFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  return { dir, saveFile }
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'node',
      [scriptPath, ...args],
      { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr })
      },
    )
  })
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

async function backupsIn(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.includes('image-migration-backup'))
}

function mixedFixtureStore(): IdeaStore {
  return storeWithBoards({
    'board-a': boardWithCards([
      cardWithAssets('card-1', [
        imageAsset('asset-big', 'legacy-big.png', 400_000),
        imageAsset('asset-ok', 'small-ok.png', 50_000),
        imageAsset('asset-bad', 'undecodable-legacy.png', 250_000),
        fileAsset('asset-pdf', 'doc.pdf', 300_000),
      ]),
    ]),
    'board-b': boardWithCards([cardWithAssets('card-2', [imageAsset('asset-other', 'other.png', 40_000)])]),
  })
}

describe('migrate-save-images CLI', () => {
  it(
    'dry-run (the default) reports over-budget assets and writes nothing',
    async () => {
      const { dir, saveFile } = await makeSaveDir(mixedFixtureStore())
      const hashBefore = await sha256(saveFile)

      const result = await runCli(['--file', saveFile])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('over budget: 2')
      expect(result.stdout).toContain('legacy-big.png')
      expect(result.stdout).toContain('undecodable-legacy.png')
      expect(result.stdout).toContain('Dry run: nothing was written')
      expect(await sha256(saveFile)).toBe(hashBefore)
      expect(await backupsIn(dir)).toEqual([])
      // No stray temp files either.
      expect((await readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([])
    },
    CLI_TIMEOUT,
  )

  it(
    'apply writes a verified backup, migrates what fits, never drops what does not, and is idempotent',
    async () => {
      const { dir, saveFile } = await makeSaveDir(mixedFixtureStore())
      const originalRaw = await readFile(saveFile, 'utf8')
      const hashBefore = await sha256(saveFile)
      const originalStore = JSON.parse(originalRaw) as IdeaStore

      const result = await runCli(['--file', saveFile, '--apply', '--compress-module', fakeCompressPath])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Verified backup:')
      expect(result.stdout).toContain('[migrated]')
      expect(result.stdout).toContain('[kept-undecodable]')
      expect(result.stdout).toContain('Migrated save written:')

      // Backup is a byte-exact copy of the pre-migration save.
      const backups = await backupsIn(dir)
      expect(backups).toHaveLength(1)
      expect(await sha256(join(dir, backups[0]))).toBe(hashBefore)

      const migrated = JSON.parse(await readFile(saveFile, 'utf8')) as IdeaStore
      const assets = migrated.boards['board-a'].cards[0].assets!
      const originalAssets = originalStore.boards['board-a'].cards[0].assets!

      // Over-budget and decodable: rewritten under budget through the pipeline.
      expect(assets[0].id).toBe('asset-big')
      expect(assets[0].dataUrl.length).toBeLessThanOrEqual(BUDGET)
      expect(assets[0].compression).toBe('compressed')
      // Compliant image, undecodable image, and the PDF: byte-for-byte identical.
      expect(assets[1].dataUrl).toBe(originalAssets[1].dataUrl)
      expect(assets[2].dataUrl).toBe(originalAssets[2].dataUrl)
      expect(assets[3].dataUrl).toBe(originalAssets[3].dataUrl)
      expect(migrated.boards['board-b']).toEqual(originalStore.boards['board-b'])

      // Second run: the undecodable asset is retried and kept again, so the
      // save is untouched and no new backup is created.
      const hashAfterFirstApply = await sha256(saveFile)
      const secondRun = await runCli(['--file', saveFile, '--apply', '--compress-module', fakeCompressPath])

      expect(secondRun.code).toBe(0)
      expect(secondRun.stdout).toContain('[kept-undecodable]')
      expect(secondRun.stdout).toContain('nothing written, no backup needed')
      expect(await sha256(saveFile)).toBe(hashAfterFirstApply)
      expect(await backupsIn(dir)).toHaveLength(1)
    },
    CLI_TIMEOUT,
  )

  it(
    'a fully migrated save is recognized as already compliant on the next run',
    async () => {
      const store = storeWithBoards({
        'board-a': boardWithCards([cardWithAssets('card-1', [imageAsset('asset-big', 'legacy-big.png', 400_000)])]),
      })
      const { dir, saveFile } = await makeSaveDir(store)

      const firstRun = await runCli(['--file', saveFile, '--apply', '--compress-module', fakeCompressPath])
      expect(firstRun.code).toBe(0)
      expect(firstRun.stdout).toContain('Migrated save written:')

      const hashAfterFirstApply = await sha256(saveFile)
      const secondRun = await runCli(['--file', saveFile, '--apply', '--compress-module', fakeCompressPath])

      expect(secondRun.code).toBe(0)
      expect(secondRun.stdout).toContain('Already compliant: no assets to migrate, nothing written.')
      expect(await sha256(saveFile)).toBe(hashAfterFirstApply)
      expect(await backupsIn(dir)).toHaveLength(1)
    },
    CLI_TIMEOUT,
  )

  it(
    'aborts the whole migration and leaves the save untouched when the backup cannot be written',
    async () => {
      const { dir, saveFile } = await makeSaveDir(mixedFixtureStore())
      const hashBefore = await sha256(saveFile)
      // A regular file where the backup directory should go makes mkdir fail.
      const blocker = join(dir, 'blocker')
      await writeFile(blocker, 'not a directory', 'utf8')

      const result = await runCli([
        '--file',
        saveFile,
        '--apply',
        '--compress-module',
        fakeCompressPath,
        '--backup-dir',
        join(blocker, 'nested'),
      ])

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Backup could not be created and verified')
      expect(await sha256(saveFile)).toBe(hashBefore)
      expect(await backupsIn(dir)).toEqual([])
      expect((await readdir(dir)).filter((name) => name.includes('.tmp'))).toEqual([])
    },
    CLI_TIMEOUT,
  )

  it(
    'refuses to run against a save file inside the git repo',
    async () => {
      const result = await runCli(['--file', join(repoRoot, 'package.json')])

      expect(result.code).toBe(1)
      expect(result.stderr).toContain('inside the git repo')
    },
    CLI_TIMEOUT,
  )
})
