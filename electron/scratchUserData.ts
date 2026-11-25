import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SCRATCH_PREFIX = 'eido-shell-'

export function selectScratchUserData(suppliedPath?: string): string {
  if (suppliedPath === undefined) {
    return mkdtempSync(path.join(realpathSync(os.tmpdir()), SCRATCH_PREFIX))
  }
  try {
    return assertScratchPath(realpathSync(suppliedPath))
  } catch {
    throw new Error('Smoke userData path was denied')
  }
}

export function cleanupScratchUserData(directory: string): void {
  if (!existsSync(directory)) return
  const safeDirectory = assertScratchPath(realpathSync(directory))
  rmSync(safeDirectory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 })
}

function assertScratchPath(candidate: string): string {
  const temporaryRoot = realpathSync(os.tmpdir())
  const relative = path.relative(temporaryRoot, candidate)
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    path.dirname(candidate) !== temporaryRoot ||
    !path.basename(candidate).startsWith(SCRATCH_PREFIX)
  ) {
    throw new Error('Scratch userData path escaped the temporary root')
  }
  return candidate
}
