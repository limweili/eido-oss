import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupScratchUserData, selectScratchUserData } from './scratchUserData'

const scratchDirectories: string[] = []

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) cleanupScratchUserData(directory)
})

describe('Electron scratch userData', () => {
  it('creates an ephemeral userData directory under the operating-system temp root', () => {
    const directory = selectScratchUserData()
    scratchDirectories.push(directory)

    expect(path.relative(realpathSync(os.tmpdir()), directory)).not.toMatch(/^\.\.(?:[\\/]|$)/)
    expect(path.basename(directory)).toMatch(/^eido-shell-/)
    expect(existsSync(directory)).toBe(true)
  })

  it('accepts only an existing smoke directory under temp and rejects broader paths', () => {
    const supplied = mkdtempSync(path.join(os.tmpdir(), 'eido-shell-smoke-'))
    scratchDirectories.push(supplied)

    expect(selectScratchUserData(supplied)).toBe(realpathSync(supplied))
    expect(() => selectScratchUserData(process.cwd())).toThrow('Smoke userData path was denied')
  })

  it('removes scratch data recursively', () => {
    const directory = selectScratchUserData()

    cleanupScratchUserData(directory)

    expect(existsSync(directory)).toBe(false)
  })
})
