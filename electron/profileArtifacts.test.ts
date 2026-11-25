import { describe, expect, it } from 'vitest'
import { isEidoProfileDatabaseArtifact } from './profileArtifacts'

describe('Eido Profile artifact classifier', () => {
  it('matches only reserved Eido Profile database basenames and their sidecars', () => {
    for (const artifact of [
      'eido-profile.db',
      'eido-profile.db-wal',
      'eido-profile.db-shm',
      'authority/eido-profile.sqlite',
      'authority/eido-profile.sqlite-wal',
      'authority/eido-profile.sqlite-shm',
      'authority/eido-profile.sqlite3',
    ]) {
      expect(isEidoProfileDatabaseArtifact(artifact), artifact).toBe(true)
    }
  })

  it('does not infer Eido authority from browser-owned directory or path substrings', () => {
    for (const artifact of [
      'Profile 1/DIPS-wal',
      'Profile 1/Cookies',
      'Default/eido-cache.db',
      'profile.sqlite',
      'eido-profile.json',
      'eido-profile.sqlite-journal',
      'not-eido-profile.db',
    ]) {
      expect(isEidoProfileDatabaseArtifact(artifact), artifact).toBe(false)
    }
  })
})
