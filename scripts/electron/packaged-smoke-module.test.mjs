import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('packaged smoke source imports', () => {
  it('loads the Profile contract through the same plain Node seam as the smoke', () => {
    const contractUrl = pathToFileURL(resolve(
      'src/persistence/profileServiceContract.ts',
    )).href
    const loaded = spawnSync(
      process.execPath,
      ['-e', `import(${JSON.stringify(contractUrl)})`],
      { encoding: 'utf8' },
    )

    expect(loaded.status, loaded.stderr).toBe(0)
  })
})
